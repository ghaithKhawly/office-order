import { ReactNode, useEffect, useRef, useState } from "react";
import { X, Timer, Printer } from "lucide-react";
import type { OrderStatus } from "./api";
import type { T } from "./i18n";

export const n = (v: number) => new Intl.NumberFormat("en-US").format(Math.round(v || 0));

export function Money({ v, cur, className = "" }: { v: number; cur?: string; className?: string }) {
  return (
    <span dir="ltr" className={"inline-block font-mono tabular-nums " + className}>
      {n(v)}
      {cur ? <span className="text-stone-400 text-xs ms-1">{cur}</span> : null}
    </span>
  );
}

type BtnProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "dark" | "ghost" | "quiet" | "good" | "bad";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
};
export function Btn({ children, onClick, variant = "ghost", size = "md", disabled, className = "" }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded font-medium transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 disabled:opacity-40 disabled:pointer-events-none";
  const sizes = { sm: "text-xs px-2.5 py-1.5", md: "text-sm px-3.5 py-2.5", lg: "text-base px-4 py-3 w-full" };
  const kinds = {
    primary: "bg-amber-400 text-stone-900 hover:bg-amber-300 active:bg-amber-500",
    dark: "bg-stone-900 text-stone-50 hover:bg-stone-800",
    ghost: "bg-white text-stone-700 border border-stone-300 hover:bg-stone-50",
    quiet: "text-stone-500 hover:text-stone-900 hover:bg-stone-200",
    good: "bg-emerald-600 text-white hover:bg-emerald-500",
    bad: "bg-white text-red-700 border border-red-300 hover:bg-red-50"
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`${base} ${sizes[size]} ${kinds[variant]} ${className}`}>
      {children}
    </button>
  );
}

export const inputCls =
  "w-full bg-white border border-stone-300 rounded px-3 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-900";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-[11px] uppercase tracking-widest text-stone-500 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export function Sheet({ open, onClose, title, children, footer, size = "md" }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
  footer?: ReactNode;
  /* "wide" is for the menu editor, which puts the photo beside the grid. */
  size?: "md" | "wide";
}) {
  if (!open) return null;
  const width = size === "wide" ? "sm:max-w-5xl" : "sm:max-w-lg";
  const height = size === "wide" ? "h-[94vh] sm:h-[90vh]" : "max-h-[92vh]";
  return (
    /* print-shell: see index.css — printing has to escape the modal's fixed,
       centred, scroll-clipped layout or long sheets come out truncated. */
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center print-shell">
      <div className="absolute inset-0 bg-stone-900/50 no-print" onClick={onClose} />
      <div className={`relative w-full ${width} bg-stone-50 rounded-t-xl sm:rounded-xl ${height} flex flex-col shadow-xl print-shell`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 shrink-0 no-print">
          <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-stone-200 text-stone-500">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4 grow print-shell">{children}</div>
        {footer ? <div className="px-4 py-3 border-t border-stone-200 shrink-0 no-print">{footer}</div> : null}
      </div>
    </div>
  );
}

/* The docket: a paper order ticket. Dashed tear lines, money in a mono column. */
export function Docket({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={"bg-white border border-stone-200 rounded shadow-sm " + className}>{children}</div>;
}
export function Tear() {
  return <div className="border-t border-dashed border-stone-300 mx-4" />;
}
export function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
      <span className="text-[10px] uppercase tracking-[0.18em] text-stone-400 font-semibold">{children}</span>
      {right}
    </div>
  );
}
export function Line({ label, value, cur, strong, muted }: {
  label: string; value: number; cur?: string; strong?: boolean; muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-1.5">
      <span className={"text-sm truncate " + (strong ? "font-semibold text-stone-900" : muted ? "text-stone-500" : "text-stone-700")}>
        {label}
      </span>
      <span className={"text-sm shrink-0 " + (strong ? "font-semibold text-stone-900" : "text-stone-700")}>
        <Money v={value} cur={cur} />
      </span>
    </div>
  );
}
export function Stamp({ status, t }: { status: OrderStatus; t: T }) {
  const map: Record<OrderStatus, string> = {
    PENDING: "border-amber-500 text-amber-700 bg-amber-50",
    APPROVED: "border-emerald-600 text-emerald-700 bg-emerald-50",
    REJECTED: "border-red-500 text-red-700 bg-red-50"
  };
  const label = { PENDING: t.o_PENDING, APPROVED: t.o_APPROVED, REJECTED: t.o_REJECTED }[status];
  return (
    <span className={`text-[10px] uppercase tracking-widest font-bold border rounded px-1.5 py-0.5 shrink-0 ${map[status]}`}>
      {label}
    </span>
  );
}

/**
 * Live countdown to the cutoff.
 *
 * `offsetMs` corrects for the phone's clock: the server is the thing that
 * actually locks the session, so the number on screen has to agree with the
 * server rather than with a handset that is four minutes fast.
 *
 * Goes visually urgent under five minutes, and calls `onExpire` once when it
 * reaches zero so the caller can refetch — the auto-lock job runs on its own
 * schedule, and without this the docket would sit at 00:00 looking stuck.
 */
export function Countdown({ target, offsetMs = 0, onExpire, className = "" }: {
  target: string;
  offsetMs?: number;
  onExpire?: () => void;
  className?: string;
}) {
  const [left, setLeft] = useState(() => Date.parse(target) - (Date.now() + offsetMs));
  const fired = useRef(false);

  useEffect(() => {
    fired.current = false;
    const tick = () => {
      const ms = Date.parse(target) - (Date.now() + offsetMs);
      setLeft(ms);
      if (ms <= 0 && !fired.current) {
        fired.current = true;
        onExpire?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target, offsetMs, onExpire]);

  const done = left <= 0;
  const urgent = !done && left < 5 * 60_000;

  const total = Math.max(0, Math.floor(left / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;

  return (
    <span dir="ltr"
      className={`inline-flex items-center gap-1 font-mono tabular-nums ${
        done ? "text-stone-400" : urgent ? "text-red-600 font-bold" : "text-stone-700"
      } ${urgent ? "animate-pulse" : ""} ${className}`}>
      <Timer size={13} className="shrink-0" />
      {text}
    </span>
  );
}

export function CopyBlock({ text, t, flash, printable }: {
  text: string; t: T; flash: (s: string) => void;
  /* Marks this block as the thing to print — see the @media print rules in
     index.css. Used for the kitchen sheet, which goes to a LAN printer. */
  printable?: boolean;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      flash(t.copied);
    } catch {
      flash(t.copyManual);
    }
  }
  return (
    <div className={printable ? "print-sheet" : undefined}>
      <pre dir="auto" className="bg-stone-900 text-stone-100 text-xs leading-relaxed rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono select-all mb-3">
        {text}
      </pre>
      <div className="flex gap-2 no-print">
        <Btn variant="primary" size="lg" onClick={copy}>{t.copy}</Btn>
        {printable ? (
          <Btn size="lg" onClick={() => window.print()}>
            <Printer size={15} />{t.print}
          </Btn>
        ) : null}
      </div>
    </div>
  );
}
