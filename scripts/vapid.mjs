// Generates a VAPID key pair for Web Push notifications.
// Put the public key in wrangler.jsonc (vars.VAPID_PUBLIC_KEY) and the private key in a secret:
//   npx wrangler secret put VAPID_PRIVATE_KEY
const { webcrypto: crypto } = await import("node:crypto");
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64url");
const { d } = await crypto.subtle.exportKey("jwk", kp.privateKey);
console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
