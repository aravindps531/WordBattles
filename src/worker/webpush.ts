/**
 * Minimal Web Push sender for Cloudflare Workers, using only WebCrypto.
 *  - Payload encryption: RFC 8291 (aes128gcm content coding, RFC 8188).
 *  - Sender authentication: RFC 8292 (VAPID, ES256 JWT).
 */

export interface PushSubscriptionKeys { endpoint: string; p256dh: string; auth: string }

export interface VapidKeys {
  publicKey: string;  // base64url, 65-byte uncompressed P-256 point
  privateKey: string; // base64url, 32-byte private scalar "d"
  subject: string;    // "mailto:..." or "https://..."
}

type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();

export function b64urlEncode(buf: ArrayBuffer | Bytes): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** JWK for a P-256 key from a raw uncompressed public point (and optional d). */
function p256Jwk(publicRaw: Bytes, d?: Bytes): JsonWebKey {
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error("Bad P-256 public key");
  return {
    kty: "EC", crv: "P-256",
    x: b64urlEncode(publicRaw.slice(1, 33)),
    y: b64urlEncode(publicRaw.slice(33, 65)),
    ...(d ? { d: b64urlEncode(d) } : {}),
    ext: true,
  };
}

export interface EncryptOptions {
  /** For tests only: fixed salt and sender key pair. */
  salt?: Bytes;
  senderPrivate?: Bytes;
  senderPublic?: Bytes;
}

/** Encrypts a payload for a subscription (RFC 8291). Returns the request body. */
export async function encryptPayload(
  payload: Bytes, p256dh: string, authSecret: string, opts: EncryptOptions = {},
): Promise<Bytes> {
  const uaPublic = b64urlDecode(p256dh);
  const auth = b64urlDecode(authSecret);

  let asPrivate: CryptoKey;
  let asPublic: Bytes;
  if (opts.senderPrivate && opts.senderPublic) {
    asPrivate = await crypto.subtle.importKey(
      "jwk", p256Jwk(opts.senderPublic, opts.senderPrivate), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"],
    );
    asPublic = opts.senderPublic;
  } else {
    const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPrivate = kp.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  }

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as EcdhKeyDeriveParams, asPrivate, 256),
  );

  // IKM = HKDF(auth, ecdh_secret, "WebPush: info\0" || ua_public || as_public, 32)
  const prkKey = await hmac(auth, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = await hmac(prkKey, keyInfo);

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plaintext = concat(payload, new Uint8Array([2])); // 0x02 = last record, no padding
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));

  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/** Builds the VAPID Authorization header value for an endpoint (RFC 8292). */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject,
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "jwk", p256Jwk(b64urlDecode(vapid.publicKey), b64urlDecode(vapid.privateKey)),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  // WebCrypto ECDSA output is raw r||s, which is exactly the JWS ES256 format.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

export interface PushResult { ok: boolean; status: number; gone: boolean }

export async function sendPush(
  sub: PushSubscriptionKeys, message: unknown, vapid: VapidKeys, ttlSeconds = 7 * 24 * 3600,
): Promise<PushResult> {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlSeconds),
      Urgency: "normal",
    },
    body,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
