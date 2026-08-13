/*
 * What the app nudges you about, and when.
 *
 * Web Push is unavailable on this network (no HTTPS, so no secure context, so
 * no service worker). Rather than fake it, this does the three things a page
 * that is actually open can do honestly: an in-app banner, a badge on the tab
 * when it is in the background, and — where the browser permits it, which on a
 * plain-HTTP LAN address is nowhere — a real desktop notification.
 *
 * The rules are deliberately conservative. A reminder you have already acted on
 * is nagging, so nothing fires once you have ordered, and each alert fires once
 * per session and is remembered across reloads.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "./api";
import type { T } from "./i18n";
import { setBadge, desktopNotify } from "./notify";

export type AlertKind = "session_open" | "cutoff_soon" | "cutoff_imminent";

export interface Alert {
  kind: AlertKind;
  text: string;
  urgent: boolean;
}

/* Two thresholds: a gentle heads-up, then a real warning. */
const SOON_MS = 15 * 60_000;
const IMMINENT_MS = 5 * 60_000;

/* Remembering what we've already said, so a refresh is not a re-announcement.
   Keyed by session so a new lunch starts with a clean slate. */
const SEEN_KEY = "oo:alerts-seen";

function loadSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
  } catch {
    return {};
  }
}
function markSeen(key: string) {
  const seen = loadSeen();
  seen[key] = Date.now();
  // Keep this from growing forever on a phone that never clears storage.
  const entries = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 40);
  localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(entries)));
}
function wasSeen(key: string) {
  return key in loadSeen();
}

export function useAlerts({ session, me, t, clockOffset }: {
  session: Session | null;
  me: User | null;
  t: T;
  clockOffset: number;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const notified = useRef(new Set<string>());

  /* Re-evaluate on a timer: the cutoff thresholds are time-based, so without
     this the banner would only appear when something else caused a render. */
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 20_000);
    return () => clearInterval(id);
  }, []);

  const iOrdered = useMemo(() => {
    if (!session || !me) return false;
    const mine = session.orders.find((o) => o.userId === me.id);
    // A rejected order means you still have something to do.
    return !!mine && mine.status !== "REJECTED";
  }, [session, me]);

  const pendingForAdmin = useMemo(() => {
    if (!session || me?.role !== "ADMIN") return 0;
    return session.orders.filter((o) => o.status === "PENDING").length;
  }, [session, me]);

  /* The one alert worth showing right now, if any. */
  const alert: Alert | null = useMemo(() => {
    if (!session || !me) return null;
    if (session.status !== "OPEN") return null;
    if (iOrdered) return null; // you've done your bit — nothing to nag about

    const msLeft = session.cutoffAt
      ? Date.parse(session.cutoffAt) - (Date.now() + clockOffset)
      : null;

    if (msLeft !== null && msLeft > 0 && msLeft <= IMMINENT_MS) {
      return { kind: "cutoff_imminent", text: t.alertCutoffImminent, urgent: true };
    }
    if (msLeft !== null && msLeft > 0 && msLeft <= SOON_MS) {
      return { kind: "cutoff_soon", text: t.alertCutoffSoon, urgent: false };
    }
    return { kind: "session_open", text: t.alertSessionOpen, urgent: false };
  }, [session, me, iOrdered, clockOffset, t]);

  const alertKey = session && alert ? `${session.id}:${alert.kind}` : null;

  /*
   * Badge the tab only while it is in the background. A badge on a tab you are
   * looking at is just noise — the banner is right there.
   */
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === "visible") {
        void setBadge(0);
        return;
      }
      const count = (alert ? 1 : 0) + pendingForAdmin;
      void setBadge(count);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [alert, pendingForAdmin]);

  // Clear the badge on the way out, so a closing tab doesn't leave one behind.
  useEffect(() => () => { void setBadge(0); }, []);

  /*
   * The desktop notification, where it is allowed at all. Only when the tab is
   * hidden — if they are looking at the page, the banner already told them.
   */
  useEffect(() => {
    if (!alertKey || !alert) return;
    if (document.visibilityState === "visible") return;
    if (notified.current.has(alertKey) || wasSeen(alertKey)) return;
    notified.current.add(alertKey);
    if (desktopNotify(t.appName, alert.text)) markSeen(alertKey);
  }, [alertKey, alert, t]);

  const dismiss = useCallback(() => {
    if (alertKey) {
      setDismissed(alertKey);
      markSeen(alertKey);
    }
  }, [alertKey]);

  /*
   * An urgent alert comes back even after a dismissal: "five minutes left and
   * you have not ordered" is worth interrupting for a second time.
   */
  const visible = alert && alertKey && dismissed !== alertKey ? alert : null;

  return { alert: visible, dismiss, iOrdered, pendingForAdmin };
}
