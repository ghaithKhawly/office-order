import { useCallback, useEffect, useRef, useState } from "react";

/*
 * The wall display.
 *
 * Designed for an old monitor across a room, so: no interaction, very large
 * type, and the docket language inverted to light-on-dark. Same stone palette,
 * same amber accent, same mono money column, same dashed tear lines — a bright
 * white page is glare on a wall and burns a static layout into an old panel.
 *
 * Two hard constraints shape the code more than the design:
 *
 *  1. It runs for weeks without anyone touching it. Every timer and every
 *     stream is cleaned up, nothing accumulates, and the reconnect logic backs
 *     off instead of hammering a server that is down.
 *  2. It is a public screen. It shows who has ordered and what the order comes
 *     to in total, and never what any one person owes.
 */

interface BoardPerson { name: string; pending: boolean }
interface BoardSession {
  id: string;
  status: "OPEN" | "LOCKED" | "PLACED";
  restaurant: { name: string } | null;
  cutoffAt: string | null;
  ordered: BoardPerson[];
  waiting: BoardPerson[];
  itemsTotal: number;
  deliveryFee: number;
  grandTotal: number;
  approvedCount: number;
  minOrder: number;
  minOrderMet: boolean;
}
interface BoardData {
  session: BoardSession | null;
  currency: string;
  serverNow: string;
}

const nf = new Intl.NumberFormat("en-US");
const token = new URLSearchParams(window.location.search).get("token") || "";

/* Slow safety-net poll, always running. Even with a healthy stream this
   guarantees the board is never more than a minute stale. */
const BACKGROUND_POLL_MS = 60_000;
/* Faster poll used while the stream is down. */
const FALLBACK_POLL_MS = 10_000;

export default function Board() {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);

  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/board?token=${encodeURIComponent(token)}`);
      if (!mounted.current) return;
      if (res.status === 401) { setError("token"); return; }
      if (!res.ok) { setError("server"); return; }
      const json = (await res.json()) as BoardData;
      if (!mounted.current) return;
      setData(json);
      setClockOffset(Date.parse(json.serverNow) - Date.now());
      setError(null);
    } catch {
      if (mounted.current) setError("offline");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /*
   * Live updates, with the stream as the fast path and polling as the floor.
   *
   * EventSource reconnects on its own, but not after the server goes away for
   * a while — and this machine gets restarted. So the board owns the retry: on
   * error it closes the stream, polls faster, and rebuilds the connection with
   * a backoff that tops out at 30s rather than hammering a rebooting box.
   */
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: number | undefined;
    let fallback: number | undefined;
    let attempt = 0;
    let stopped = false;

    const clearFallback = () => {
      if (fallback !== undefined) { clearInterval(fallback); fallback = undefined; }
    };
    const startFallback = () => {
      if (fallback === undefined) fallback = window.setInterval(() => { void refresh(); }, FALLBACK_POLL_MS);
    };

    const connect = () => {
      if (stopped) return;
      es = new EventSource(`/api/board/stream?token=${encodeURIComponent(token)}`);

      es.onopen = () => {
        attempt = 0;
        setLive(true);
        clearFallback();
        void refresh(); // catch up on anything missed while disconnected
      };
      es.onmessage = () => { void refresh(); };
      es.onerror = () => {
        setLive(false);
        es?.close();
        es = null;
        startFallback();
        if (stopped) return;
        attempt++;
        const wait = Math.min(30_000, 2000 * 2 ** Math.min(attempt, 4));
        retry = window.setTimeout(connect, wait);
      };
    };

    connect();
    const slow = window.setInterval(() => { void refresh(); }, BACKGROUND_POLL_MS);

    return () => {
      stopped = true;
      es?.close();
      clearTimeout(retry);
      clearFallback();
      clearInterval(slow);
    };
  }, [refresh]);

  /*
   * A browser left open for weeks accumulates, whatever this code does. Reload
   * during the small hours, and only when no session is running, so it can
   * never blank the screen mid-lunch.
   */
  const hasSession = useRef(false);
  hasSession.current = !!data?.session;

  useEffect(() => {
    const opened = Date.now();
    // Reads the session through a ref on purpose. Depending on `data` would
    // tear down and rebuild this interval on every poll, so the ten-minute
    // check would never actually come round and the reload would never happen.
    const id = window.setInterval(() => {
      const hour = new Date().getHours();
      const stale = Date.now() - opened > 20 * 3600_000;
      if (stale && hour >= 2 && hour < 5 && !hasSession.current) window.location.reload();
    }, 600_000);
    return () => clearInterval(id);
  }, []);

  if (error === "token") {
    return (
      <Shell>
        <p className="text-5xl font-bold text-amber-400 mb-4">؟</p>
        <p className="text-3xl text-stone-300">هذا الرابط غير صالح</p>
        <p className="text-xl text-stone-500 mt-3">This board link is not valid — ask an admin for a new one.</p>
      </Shell>
    );
  }

  if (!data) {
    return <Shell><p className="text-3xl text-stone-500">…</p></Shell>;
  }

  if (!data.session) {
    return (
      <Shell>
        <p className="text-6xl font-bold text-stone-100 mb-5">ما في طلبية اليوم</p>
        <p className="text-3xl text-stone-500">No order running right now</p>
        <StatusDot live={live} error={error} />
      </Shell>
    );
  }

  const s = data.session;
  const pct = s.minOrder > 0 ? Math.min(100, Math.round((s.itemsTotal / s.minOrder) * 100)) : 0;

  return (
    <div className="min-h-full bg-stone-900 text-stone-100 p-[2vw] flex flex-col">
      {/* header: restaurant + countdown */}
      <div className="flex items-start justify-between gap-6 mb-[1.5vh]">
        <div className="min-w-0">
          <p className="text-[1.6vw] uppercase tracking-[0.3em] text-stone-500 mb-1">طلبية اليوم</p>
          <h1 className="text-[4.5vw] leading-none font-bold truncate">{s.restaurant?.name || "—"}</h1>
        </div>
        <div className="text-end shrink-0">
          {s.status === "OPEN" && s.cutoffAt ? (
            <BoardCountdown target={s.cutoffAt} offsetMs={clockOffset} />
          ) : (
            <span className="inline-block text-[2.4vw] font-bold uppercase tracking-widest px-[1.5vw] py-[0.5vh] rounded bg-stone-800 text-amber-400 border-2 border-amber-500">
              {s.status === "OPEN" ? "مفتوحة" : s.status === "LOCKED" ? "مقفلة" : "تم الطلب"}
            </span>
          )}
        </div>
      </div>

      <div className="border-t-2 border-dashed border-stone-700 mb-[2vh]" />

      {/* the two columns that matter: who is in, who is missing */}
      <div className="grid grid-cols-2 gap-[3vw] grow min-h-0">
        <section className="min-w-0">
          <h2 className="text-[1.8vw] uppercase tracking-[0.2em] text-emerald-400 mb-[1.5vh]">
            طلبوا · {s.ordered.length}
          </h2>
          <ul className="space-y-[0.8vh]">
            {s.ordered.map((p) => (
              <li key={p.name} className="text-[2.6vw] leading-tight flex items-center gap-3 truncate">
                <span className="text-emerald-400 shrink-0">✓</span>
                <span className="truncate">{p.name}</span>
                {p.pending ? <span className="text-[1.3vw] text-amber-400 uppercase tracking-widest shrink-0">?</span> : null}
              </li>
            ))}
            {s.ordered.length === 0 ? <li className="text-[2vw] text-stone-600">—</li> : null}
          </ul>
        </section>

        <section className="min-w-0">
          <h2 className="text-[1.8vw] uppercase tracking-[0.2em] text-amber-400 mb-[1.5vh]">
            لسا ما طلبوا · {s.waiting.length}
          </h2>
          <ul className="space-y-[0.8vh]">
            {s.waiting.map((p) => (
              <li key={p.name} className="text-[2.6vw] leading-tight text-stone-400 truncate">{p.name}</li>
            ))}
            {s.waiting.length === 0 ? (
              <li className="text-[2vw] text-emerald-400">الكل طلب 🎉</li>
            ) : null}
          </ul>
        </section>
      </div>

      {/* min-order progress, only when the restaurant has one */}
      {s.minOrder > 0 ? (
        <div className="mt-[2vh]">
          <div className="flex items-baseline justify-between text-[1.5vw] text-stone-400 mb-1">
            <span>الحد الأدنى</span>
            <span className="font-mono tabular-nums">
              {nf.format(s.itemsTotal)} / {nf.format(s.minOrder)}
            </span>
          </div>
          <div className="h-[1.6vh] rounded bg-stone-800 overflow-hidden">
            <div
              className={`h-full transition-[width] duration-700 ${s.minOrderMet ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="border-t-2 border-dashed border-stone-700 mt-[2vh] mb-[1.5vh]" />

      {/* totals only — never a per-person figure on a public screen */}
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-[1.6vw] uppercase tracking-[0.25em] text-stone-500">
          {s.approvedCount} مشارك
        </span>
        <span className="text-[4vw] leading-none font-bold font-mono tabular-nums" dir="ltr">
          {nf.format(s.grandTotal)}
          <span className="text-[1.6vw] text-stone-500 ms-3">{data.currency}</span>
        </span>
      </div>

      <StatusDot live={live} error={error} />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-stone-900 text-stone-100 flex flex-col items-center justify-center text-center p-[4vw]">
      {children}
    </div>
  );
}

/* Deliberately tiny: a maintenance detail, not information for the room. */
function StatusDot({ live, error }: { live: boolean; error: string | null }) {
  const colour = error ? "bg-red-500" : live ? "bg-emerald-500" : "bg-amber-500";
  return (
    <div className="fixed bottom-2 end-3 flex items-center gap-1.5 opacity-40">
      <span className={`w-2 h-2 rounded-full ${colour}`} />
    </div>
  );
}

/*
 * Counts against the server's clock, not the panel's. A kiosk PC that has
 * never synced time is common, and a countdown disagreeing with the lock it is
 * predicting is worse than no countdown.
 */
function BoardCountdown({ target, offsetMs }: { target: string; offsetMs: number }) {
  const [left, setLeft] = useState(() => Date.parse(target) - (Date.now() + offsetMs));

  useEffect(() => {
    const tick = () => setLeft(Date.parse(target) - (Date.now() + offsetMs));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target, offsetMs]);

  const over = left <= 0;
  const urgent = !over && left < 5 * 60_000;
  const total = Math.max(0, Math.floor(left / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const text = over
    ? "انتهى الوقت"
    : (h > 0 ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(sec).padStart(2, "0")}`;

  return (
    <div className="text-end">
      <p className="text-[1.4vw] uppercase tracking-[0.25em] text-stone-500 mb-1">بيسكّر بعد</p>
      <p
        className={`text-[5vw] leading-none font-bold font-mono tabular-nums ${
          over ? "text-stone-500" : urgent ? "text-red-400 animate-pulse" : "text-amber-400"
        }`}
        dir="ltr"
      >
        {text}
      </p>
    </div>
  );
}
