/*
 * Notifications, within what an air-gapped HTTP LAN actually allows.
 *
 * There is no HTTPS here and no certificate authority to get one from, so the
 * page is not a secure context. That rules out service workers and Web Push
 * outright — `navigator.serviceWorker` is not even defined on the target
 * origin. What is left, in descending order of reliability:
 *
 *   1. An in-app banner.            Always works. This is the real mechanism.
 *   2. Title + favicon badge.       Always works, including when backgrounded.
 *   3. The Notification API.        A bonus, and on the deployment origin it is
 *                                   already denied before we ask. See below.
 *
 * Measured on the real deployment origin (http://<lan-ip>:3001):
 *   isSecureContext   false
 *   'Notification'    present  ← so testing for it is not enough
 *   permission        "denied" ← pre-denied, requesting can never grant it
 *
 * That last point is why canNotify() checks isSecureContext rather than just
 * feature-detecting: offering a toggle that silently cannot work is worse than
 * not offering it.
 */

/*
 * The favicon, drawn as a docket: amber card, white receipt, torn bottom edge.
 * Kept in sync by hand with web/public/favicon.svg, which covers the moment
 * before this module runs. Inlined rather than fetched so there is no race
 * between the first paint and the badge.
 */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="7" fill="#fbbf24"/>
<path d="M8 7h16v15l-2.7-1.8L18.7 22 16 20.2 13.3 22l-2.6-1.8L8 22z" fill="#fffbeb"/>
<rect x="11" y="10.5" width="10" height="2" rx="1" fill="#1c1917"/>
<rect x="11" y="14.5" width="7" height="2" rx="1" fill="#57534e"/>
</svg>`;

let baseTitle = "";
let iconEl: HTMLLinkElement | null = null;
let plainIcon: string | null = null;
const badgedCache = new Map<string, string>();

function linkEl(): HTMLLinkElement {
  if (iconEl && document.head.contains(iconEl)) return iconEl;
  iconEl =
    document.querySelector<HTMLLinkElement>('link[rel="icon"][data-dynamic]') ||
    (() => {
      const el = document.createElement("link");
      el.rel = "icon";
      el.type = "image/png";
      el.setAttribute("data-dynamic", "");
      document.head.appendChild(el);
      return el;
    })();
  return iconEl;
}

/**
 * Render the favicon to a PNG data URL, optionally with an unread dot.
 *
 * Drawn rather than shipped as two files so the dot can be composited at the
 * device's pixel ratio, and so there is one source of truth for the mark.
 */
function renderIcon(withDot: boolean): Promise<string> {
  const key = withDot ? "dot" : "plain";
  const cached = badgedCache.get(key);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const size = 64;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve("");
      ctx.drawImage(img, 0, 0, size, size);

      if (withDot) {
        // Punch a transparent ring first so the dot reads against the amber.
        const cx = size - size * 0.26;
        const cy = size * 0.26;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.245, 0, Math.PI * 2);
        ctx.fillStyle = "#1c1917";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.19, 0, Math.PI * 2);
        ctx.fillStyle = "#dc2626";
        ctx.fill();
      }

      const url = canvas.toDataURL("image/png");
      badgedCache.set(key, url);
      resolve(url);
    };
    img.onerror = () => resolve("");
    img.src = "data:image/svg+xml;base64," + btoa(FAVICON_SVG);
  });
}

export function initNotify() {
  if (!baseTitle) baseTitle = document.title;
  void renderIcon(false).then((url) => {
    if (url) {
      plainIcon = url;
      linkEl().href = url;
    }
  });
}

/**
 * Show `count` as a badge on the tab.
 *
 * Only ever called while the tab is hidden — a badge on a tab the user is
 * already looking at is noise, and the banner has said it already.
 */
export async function setBadge(count: number) {
  if (!baseTitle) baseTitle = document.title;

  if (count > 0) {
    document.title = `(${count}) ${baseTitle}`;
    const url = await renderIcon(true);
    if (url) linkEl().href = url;
  } else {
    document.title = baseTitle;
    const url = plainIcon || (await renderIcon(false));
    if (url) linkEl().href = url;
  }
}

/* ------------------------------------------------------------------ */
/*  the optional bonus                                                 */
/* ------------------------------------------------------------------ */

export type NotifyState = "unsupported" | "insecure" | "default" | "granted" | "denied";

/**
 * What the browser will actually let us do, distinguishing "you said no" from
 * "this origin can never do this". Setup shows a different message for each.
 */
export function notifyState(): NotifyState {
  if (typeof Notification === "undefined") return "unsupported";
  // The decisive check. On http://<lan-ip> the object exists and permission is
  // already "denied"; asking is pointless and the UI should say why.
  if (!window.isSecureContext) return "insecure";
  return Notification.permission as NotifyState;
}

export const canNotify = () => notifyState() === "granted";

/** Must be called from a user gesture, or browsers ignore it. */
export async function askNotifyPermission(): Promise<NotifyState> {
  if (notifyState() !== "default") return notifyState();
  try {
    return (await Notification.requestPermission()) as NotifyState;
  } catch {
    // Older Safari throws instead of returning a rejected promise.
    return "denied";
  }
}

/**
 * Fire a desktop notification if we are allowed to. Never throws: on Android
 * `new Notification()` is an illegal constructor without a service worker, and
 * a lunch reminder must not be able to take down the page.
 */
export function desktopNotify(title: string, body: string): boolean {
  if (!canNotify()) return false;
  try {
    const n = new Notification(title, { body, tag: "office-order", icon: plainIcon || undefined });
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch {
    return false;
  }
}
