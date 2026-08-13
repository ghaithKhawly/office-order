import { useState } from "react";
import { Check, Copy, Wallet } from "lucide-react";
import { api } from "../api";
import type { Ctx } from "../App";
import { Btn, CopyBlock, Docket, Eyebrow, Line, Money, Sheet, Tear, n } from "../ui";

export default function MoneyScreen({ ctx }: { ctx: Ctx }) {
  const { t, cur, me, isAdmin, session, balances, run, flash } = ctx;
  const [shareOpen, setShare] = useState(false);

  const summary = session
    ? [
        `${session.restaurant?.name || ""} · ${new Date(session.orderDate + "Z").toLocaleDateString()}`,
        "─".repeat(26),
        ...session.orders
          .filter((o) => o.counted)
          .map((o) => `${o.userName}: ${n(o.due)} ${cur}${o.paid ? " ✓" : ""}`),
        "─".repeat(26),
        `${t.delivery}: ${n(session.totals.deliveryFee)} ${cur}`,
        `${t.grandTotal}: ${n(session.totals.grandTotal)} ${cur}`,
        `${session.payerName} ${t.paidBy}`
      ].join("\n")
    : "";

  return (
    <div className="space-y-3">
      {session ? (
        <Docket>
          <Eyebrow right={
            <Btn size="sm" onClick={() => setShare(true)}><Copy size={13} />{t.copy}</Btn>
          }>
            {session.restaurant?.name || "—"} · {t.due}
          </Eyebrow>

          {session.orders.filter((o) => o.counted).length === 0 ? (
            <p className="px-4 pb-4 text-sm text-stone-400">{t.nothingYet}</p>
          ) : (
            <div className="pb-2">
              {session.orders.filter((o) => o.counted).map((o) => (
                <div key={o.id} className="px-4 py-2.5 border-t border-stone-100">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">
                      {o.userName}
                      {o.userId === session.payerId ? (
                        <span className="text-[10px] text-amber-600 mx-1.5 uppercase tracking-widest">
                          {t.paidBy}
                        </span>
                      ) : null}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Money v={o.due} cur={cur}
                        className={"text-sm font-semibold " + (o.paid ? "text-emerald-600" : "")} />
                      {isAdmin ? (
                        <button type="button" aria-label={t.markPaid}
                          onClick={() => run(() => api.setPaid(o.id, !o.paid))}
                          className={`w-7 h-7 rounded border flex items-center justify-center ${
                            o.paid ? "bg-emerald-600 border-emerald-600 text-white" : "border-stone-300 text-stone-400"
                          }`}>
                          <Check size={14} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-[11px] text-stone-400 mt-0.5">
                    {t.subtotal} <Money v={o.subtotal} /> · {t.delivery} <Money v={o.deliveryShare} />
                    {o.cashRounding > 0 ? <> · {t.kitty} <Money v={o.cashRounding} /></> : null}
                  </div>
                </div>
              ))}
              <Tear />
              <div className="pt-2">
                <Line label={t.collected} value={session.totals.collected} cur={cur} muted />
                <Line label={t.outstanding} value={session.totals.outstanding} cur={cur} strong />
                {session.totals.kitty > 0 ? (
                  <Line label={t.kitty} value={session.totals.kitty} cur={cur} muted />
                ) : null}
              </div>
            </div>
          )}
        </Docket>
      ) : null}

      <Docket>
        <Eyebrow>{t.balances}</Eyebrow>
        {balances.length === 0 ? (
          <div className="px-4 pb-5 pt-1 text-center">
            <Wallet size={22} className="mx-auto text-stone-300 mb-2" />
            <p className="text-sm text-stone-400">{t.allSquare}</p>
          </div>
        ) : (
          <div className="pb-2">
            {balances.map((b) => (
              <div key={b.userId} className="flex items-center justify-between gap-2 px-4 py-2 border-t border-stone-100">
                <span className="text-sm truncate">
                  {b.name}{b.userId === me.id ? ` (${t.you})` : ""}
                </span>
                <span className={"text-sm font-semibold shrink-0 " + (b.balance > 0 ? "text-emerald-600" : "text-red-600")}>
                  <Money v={Math.abs(b.balance)} cur={cur} />
                  <span className="text-[10px] uppercase tracking-widest mx-1.5 font-normal">
                    {b.balance > 0 ? t.owed : t.owes}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Docket>

      <Sheet open={shareOpen} onClose={() => setShare(false)} title={t.copy}>
        <CopyBlock text={summary} t={t} flash={flash} />
      </Sheet>
    </div>
  );
}
