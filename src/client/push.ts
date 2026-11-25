import type { Api } from "./api";

export type PushState =
  | "unsupported"     // browser can't do web push at all
  | "ios-install"     // iPhone/iPad Safari: must Add to Home Screen first
  | "unconfigured"    // server has no VAPID keys
  | "default"         // can ask
  | "denied"          // user blocked notifications
  | "granted";        // permission granted (subscription may still need syncing)

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

let cachedKey: string | null | undefined;
async function serverKey(): Promise<string | null> {
  if (cachedKey === undefined) {
    const r = await fetch("/api/push/key").then((r) => r.json()).catch(() => ({ publicKey: null }));
    cachedKey = (r as { publicKey: string | null }).publicKey || null;
  }
  return cachedKey;
}

export async function pushState(): Promise<PushState> {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return isIOS() && !isStandalone() ? "ios-install" : "unsupported";
  if (!(await serverKey())) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") return "granted";
  return "default";
}

function keyBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Must be called from a tap/click handler (browsers require a user gesture). */
export async function enablePush(api: Api): Promise<PushState> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "default";
  await syncSubscription(api);
  return "granted";
}

/** Makes sure the server has this device's current subscription. */
export async function syncSubscription(api: Api): Promise<boolean> {
  const key = await serverKey();
  if (!key || Notification.permission !== "granted") return false;
  const reg = (await registerServiceWorker()) && (await navigator.serviceWorker.ready);
  if (!reg) return false;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key) as BufferSource,
    });
  }
  await api.subscribe(sub.toJSON());
  return true;
}
