import { useEffect, useState } from "react";
import {
  Plus, Check, X, Store, Users, Truck, Lock, Unlock, Send, Ban,
  ChefHat, AlertTriangle, Receipt, CircleDollarSign, History, ChevronDown, ChevronUp
} from "lucide-react";
import { api, type Session } from "../api";
import type { Ctx } from "../App";
import {
  Btn, Docket, Eyebrow, Field, Line, Money, Sheet, Stamp, Tear, inputCls, CopyBlock
} from "../ui";

export default function Today({ ctx }: { ctx: Ctx }) {
  const { t, cur, me, isAdmin, session, restaurants, users, run, flash, goto, lang } = ctx;
  const [newOpen, setNewOpen] = useState(false);
  const [sheetText, setSheetText] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function openSheet() {
    if (!session) return;
    const r = await run(() => api.kitchenSheet(session.id));
    if (r) setSheetText(r.text);
  }

  if (!session) {
    return (
      <>
        <Docket className="p-8 text-center">
          <Receipt size={30} className="mx-auto text-stone-300 mb-3" />
          <p className="font-semibold mb-1">{t.noSession}</p>
          <p className="text-xs text-stone-500 mb-5">{t.noSessionSub}</p>
          {isAdmin ? (
            <Btn variant="primary" onClick={() => setNewOpen(true)}>
              <Plus size={15} />{t.startSession}
            </Btn>
          ) : null}
        </Docket>
        <PastSessions ctx={ctx} />
        <NewSession ctx={ctx} open={newOpen} onClose={() => setNewOpen(false)} />
      </>
    );
  }

  const editable = session.status === "OPEN";
  const pending = session.orders.filter((o) => o.status === "PENDING");
  const belowMin =
    session.restaurant && session.restaurant.minOrder > 0 &&
    session.totals.itemsTotal < session.restaurant.minOrder;

  const setStatus = (status: Session["status"]) =>
    run(() => api.updateSession(session.id, { status }));

  return (
    <div className="space-y-3">
      <Docket>
        <Eyebrow right={
          <span className="text-[10px] uppercase tracking-widest font-bold text-stone-900 bg-amber-300 px-2 py-0.5 rounded">
            {t["st_" + session.status as keyof typeof t] as string}
          </span>
        }>
          {new Date(session.orderDate + "Z").toLocaleDateString(lang === "ar" ? "ar-SY" : "en-GB",
            { day: "2-digit", month: "short" })}
        </Eyebrow>

        <div className="px-4 pb-3">
          <div className="flex items-center gap-2">
            <Store size={16} className="text-stone-400 shrink-0" />
            <span className="font-semibold text-lg tracking-tight truncate">
              {session.restaurant?.name || "—"}
            </span>
          </div>
          {session.restaurant?.phone ? (
            <a href={`tel:${session.restaurant.phone}`} dir="ltr"
              className="text-xs text-stone-500 mt-0.5 inline-block underline">
              {session.restaurant.phone}
            </a>
          ) : null}
        </div>

        <Tear />
        <div className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs text-stone-500">
          <span className="flex items-center gap-1.5"><Users size={13} />{session.totals.approvedCount} {t.participants}</span>
          <span className="flex items-center gap-1.5"><Truck size={13} />
            {session.splitMode === "EQUAL" ? t.equal : t.proportional}</span>
          <span className="flex items-center gap-1.5 truncate"><CircleDollarSign size={13} />{session.payerName}</span>
        </div>
        <Tear />

        <div className="py-2">
          <Line label={t.subtotal} value={session.totals.itemsTotal} cur={cur} />
          <Line label={t.delivery} value={session.totals.deliveryFee} cur={cur} />
          <Line label={t.grandTotal} value={session.totals.grandTotal} cur={cur} strong />
        </div>

        {belowMin ? (
          <div className="mx-4 mb-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{t.minOrderWarn} — <Money v={session.restaurant!.minOrder} cur={cur} /></span>
          </div>
        ) : null}

        <div className="px-4 pb-4 flex flex-wrap gap-2">
          <Btn variant="primary" size="sm" onClick={() => goto("menu")} disabled={!editable}>
            <Plus size={14} />{t.myOrder}
          </Btn>
          <Btn size="sm" onClick={openSheet}><ChefHat size={14} />{t.kitchenSheet}</Btn>
          {isAdmin ? (
            <>
              {session.status === "OPEN" ? <Btn size="sm" onClick={() => setStatus("LOCKED")}><Lock size={14} />{t.lockOrders}</Btn> : null}
              {session.status === "LOCKED" ? <Btn size="sm" onClick={() => setStatus("OPEN")}><Unlock size={14} />{t.reopen}</Btn> : null}
              {session.status === "LOCKED" ? <Btn variant="dark" size="sm" onClick={() => setStatus("PLACED")}><Send size={14} />{t.markPlaced}</Btn> : null}
              {session.status === "PLACED" ? <Btn variant="good" size="sm" onClick={() => setStatus("SETTLED")}><Check size={14} />{t.markSettled}</Btn> : null}
              <Btn variant="bad" size="sm" onClick={() => setStatus("CANCELLED")}><Ban size={14} />{t.cancelSession}</Btn>
            </>
          ) : null}
        </div>
      </Docket>

      {isAdmin && pending.length > 0 ? (
        <Docket className="border-amber-300">
          <Eyebrow right={
            <Btn size="sm" variant="good" onClick={() => run(() => api.approveAll(session.id))}>
              <Check size={13} />{t.approveAll}
            </Btn>
          }>{t.approvals} · {pending.length}</Eyebrow>
          <div className="px-4 pb-4 space-y-3">
            {pending.map((o) => (
              <div key={o.id} className="border border-stone-200 rounded p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-semibold text-sm truncate">{o.userName}</span>
                  <Money v={o.subtotal} cur={cur} className="text-sm shrink-0" />
                </div>
                <ul className="text-xs text-stone-600 space-y-0.5 mb-3">
                  {o.items.map((i) => (
                    <li key={i.id}>
                      <span className="font-mono">{i.qty}×</span> {i.name}
                      {i.note ? <span className="text-stone-400"> — {i.note}</span> : null}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Btn size="sm" variant="good" onClick={() => run(() => api.decide(o.id, "APPROVED"))}>
                    <Check size={13} />{t.approve}
                  </Btn>
                  <Btn size="sm" variant="bad" onClick={() => { setRejecting(o.id); setReason(""); }}>
                    <X size={13} />{t.reject}
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        </Docket>
      ) : null}

      <Docket>
        <Eyebrow right={<span className="text-[10px] text-stone-400">{t.approvedOnly}</span>}>{t.today}</Eyebrow>
        {session.orders.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-stone-400">{t.nothingYet}</p>
        ) : (
          <div className="pb-2">
            {session.orders.map((o) => (
              <div key={o.id} className="px-4 py-2.5 border-t border-stone-100">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm truncate">{o.userName}</span>
                    {o.userId === me.id ? <span className="text-[10px] text-stone-400 shrink-0">({t.you})</span> : null}
                    <Stamp status={o.status} t={t} />
                  </div>
                  <Money v={o.counted ? o.due : o.subtotal} cur={cur}
                    className={"text-sm shrink-0 " + (o.counted ? "font-semibold" : "text-stone-400")} />
                </div>
                <div className="text-xs text-stone-500 mt-0.5 truncate">
                  {o.items.map((i) => `${i.qty}× ${i.name}`).join(lang === "ar" ? "، " : ", ")}
                </div>
                {o.status === "REJECTED" && o.reason ? (
                  <div className="text-xs text-red-600 mt-1">{o.reason}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Docket>

      <PastSessions ctx={ctx} />

      <Sheet open={sheetText !== null} onClose={() => setSheetText(null)} title={t.kitchenSheet}>
        {sheetText !== null ? <CopyBlock text={sheetText} t={t} flash={flash} /> : null}
      </Sheet>

      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={t.reject}
        footer={
          <Btn variant="primary" size="lg" disabled={!reason.trim()}
            onClick={async () => {
              await run(() => api.decide(rejecting!, "REJECTED", reason.trim()));
              setRejecting(null);
            }}>{t.confirm}</Btn>
        }>
        <Field label={t.rejectReason}>
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Sheet>
    </div>
  );
}

function PastSessions({ ctx }: { ctx: Ctx }) {
  const { t, cur } = ctx;
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Session[] | null>(null);

  useEffect(() => {
    if (open && !rows) api.sessions(15).then(setRows).catch(() => setRows([]));
  }, [open, rows]);

  const past = (rows || []).filter((s) => s.status === "SETTLED" || s.status === "CANCELLED");

  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white border border-stone-200 rounded text-sm text-stone-600">
        <span className="flex items-center gap-2"><History size={15} />{t.history}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {past.length === 0 ? (
            <p className="text-xs text-stone-400 px-1">—</p>
          ) : past.map((s) => (
            <Docket key={s.id} className="px-4 py-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{s.restaurant?.name || "—"}</div>
                <div className="text-[11px] text-stone-400">
                  {new Date(s.orderDate + "Z").toLocaleDateString()} · {s.totals.approvedCount} {t.participants}
                </div>
              </div>
              <Money v={s.totals.grandTotal} cur={cur} className="text-sm shrink-0" />
            </Docket>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NewSession({ ctx, open, onClose }: { ctx: Ctx; open: boolean; onClose: () => void }) {
  const { t, cur, me, restaurants, users, run, lang } = ctx;
  const [restaurantId, setRid] = useState("");
  const [fee, setFee] = useState("0");
  const [splitMode, setSplit] = useState<"EQUAL" | "PROPORTIONAL">("EQUAL");
  const [payerId, setPayer] = useState(me.id);
  const [step, setStep] = useState("100");
  const [cashStep, setCash] = useState("0");

  useEffect(() => {
    if (open && restaurants.length && !restaurantId) {
      setRid(restaurants[0].id);
      setFee(String(restaurants[0].deliveryFee));
    }
  }, [open, restaurants, restaurantId]);

  async function create() {
    if (!restaurantId) return;
    const r = await run(() => api.createSession({
      restaurantId, deliveryFee: Number(fee) || 0, splitMode, payerId,
      roundingStep: Number(step) || 100, cashStep: Number(cashStep) || 0
    }));
    if (r) onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={t.startSession}
      footer={<Btn variant="primary" size="lg" onClick={create} disabled={!restaurantId}>{t.create}</Btn>}>
      {restaurants.length === 0 ? (
        <p className="text-sm text-stone-500">{t.noRestaurants}</p>
      ) : (
        <>
          <Field label={t.pickRestaurant}>
            <select className={inputCls} value={restaurantId}
              onChange={(e) => {
                setRid(e.target.value);
                const r = restaurants.find((x) => x.id === e.target.value);
                if (r) setFee(String(r.deliveryFee));
              }}>
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label={`${t.deliveryFee} (${cur})`}>
            <input className={inputCls} dir="ltr" inputMode="numeric" value={fee}
              onChange={(e) => setFee(e.target.value.replace(/[^0-9]/g, ""))} />
          </Field>
          <Field label={t.splitMode}>
            <div className="grid grid-cols-2 gap-2">
              {([["EQUAL", t.equal], ["PROPORTIONAL", t.proportional]] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setSplit(v)}
                  className={`text-sm rounded border px-3 py-2.5 ${
                    splitMode === v ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-600"
                  }`}>{l}</button>
              ))}
            </div>
          </Field>
          <Field label={t.payer}>
            <select className={inputCls} value={payerId} onChange={(e) => setPayer(e.target.value)}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.roundTo}>
              <select className={inputCls} value={step} onChange={(e) => setStep(e.target.value)}>
                {["1", "50", "100", "500", "1000"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label={t.cashRound}>
              <select className={inputCls} value={cashStep} onChange={(e) => setCash(e.target.value)}>
                <option value="0">{t.none}</option>
                {["100", "500", "1000", "5000"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          </div>
          <p className="text-[11px] text-stone-400 leading-relaxed">
            {lang === "ar"
              ? "الحصص بتنحسب بطريقة أكبر باقي: مجموع الحصص بيساوي أجرة التوصيل بالضبط."
              : "Shares use largest-remainder allocation, so they always sum to the fee exactly."}
          </p>
        </>
      )}
    </Sheet>
  );
}
