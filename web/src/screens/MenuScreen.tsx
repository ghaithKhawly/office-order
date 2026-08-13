import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, Store, Lock, Send, RefreshCw, ShoppingBag } from "lucide-react";
import { api } from "../api";
import type { Ctx } from "../App";
import { Btn, Docket, Eyebrow, Field, Line, Money, Sheet, Tear, inputCls } from "../ui";

interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  price: number;
  qty: number;
  note: string;
}

export default function MenuScreen({ ctx }: { ctx: Ctx }) {
  const { t, cur, me, session, restaurants, run, flash, goto, lang } = ctx;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [q, setQ] = useState("");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteVal, setNoteVal] = useState("");
  const seeded = useRef<string | null>(null);

  const restaurant = session ? restaurants.find((r) => r.id === session.restaurant?.id) : undefined;
  const myOrder = session ? session.orders.find((o) => o.userId === me.id) : undefined;

  // Seed the cart from my existing order once per session, then leave it alone
  // so live refreshes don't stomp on what the user is currently building.
  useEffect(() => {
    if (!session) return;
    if (seeded.current === session.id) return;
    seeded.current = session.id;
    setCart(
      myOrder
        ? myOrder.items.map((i) => ({
            key: i.id, menuItemId: i.menuItemId || "", name: i.name,
            price: i.unitPrice, qty: i.qty, note: i.note
          }))
        : []
    );
  }, [session, myOrder]);

  const items = useMemo(() => {
    if (!restaurant) return [];
    const needle = q.trim().toLowerCase();
    return restaurant.menu.filter(
      (i) => i.available && (!needle || i.name.toLowerCase().includes(needle))
    );
  }, [restaurant, q]);

  const cats = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
  const cartTotal = cart.reduce((a, i) => a + i.price * i.qty, 0);
  const qtyOf = (id: string) => cart.filter((c) => c.menuItemId === id).reduce((a, c) => a + c.qty, 0);

  if (!session) {
    return (
      <Docket className="p-8 text-center">
        <ShoppingBag size={28} className="mx-auto text-stone-300 mb-3" />
        <p className="text-sm text-stone-500">{t.noSession}</p>
      </Docket>
    );
  }
  if (!restaurant) {
    return <Docket className="p-6 text-sm text-stone-500">{t.noRestaurants}</Docket>;
  }

  const editable = session.status === "OPEN";

  function bump(itemId: string, name: string, price: number, delta: number) {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.menuItemId === itemId && !c.note);
      const next = [...prev];
      if (idx >= 0) {
        const q2 = next[idx].qty + delta;
        if (q2 <= 0) next.splice(idx, 1);
        else next[idx] = { ...next[idx], qty: q2 };
      } else if (delta > 0) {
        next.push({ key: crypto.randomUUID(), menuItemId: itemId, name, price, qty: 1, note: "" });
      }
      return next;
    });
  }

  async function repeatLast() {
    const all = await run(() => api.sessions(15));
    if (!all) return;
    const prior = all
      .filter((s) => s.id !== session!.id && s.restaurant?.id === restaurant!.id)
      .flatMap((s) => s.orders.filter((o) => o.userId === me.id && o.status === "APPROVED"))[0];
    if (!prior) { flash(t.noPrevious); return; }
    const live = new Map(restaurant!.menu.filter((m) => m.available).map((m) => [m.id, m]));
    const rebuilt = prior.items
      .filter((i) => i.menuItemId && live.has(i.menuItemId))
      .map((i) => {
        const m = live.get(i.menuItemId!)!;
        return { key: crypto.randomUUID(), menuItemId: m.id, name: m.name, price: m.price, qty: i.qty, note: i.note };
      });
    if (rebuilt.length === 0) { flash(t.noPrevious); return; }
    setCart(rebuilt);
  }

  async function submit() {
    if (cart.length === 0) return;
    const r = await run(() =>
      api.submitOrder(session!.id, cart.map((c) => ({ menuItemId: c.menuItemId, qty: c.qty, note: c.note })))
    );
    if (r) { flash(myOrder ? t.updateOrder : t.sendOrder); goto("today"); }
  }

  return (
    <div className="space-y-3">
      <Docket className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Store size={15} className="text-stone-400 shrink-0" />
            <span className="font-semibold truncate">{restaurant.name}</span>
          </div>
          <Btn size="sm" onClick={repeatLast} disabled={!editable}>
            <RefreshCw size={13} />{t.repeatLast}
          </Btn>
        </div>
      </Docket>

      {!editable ? (
        <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2.5">
          <Lock size={14} />{t.lockedNotice}
        </div>
      ) : null}

      <input className={inputCls} placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} />

      {items.length === 0 ? (
        <Docket className="p-6 text-sm text-stone-500 text-center">{t.noItems}</Docket>
      ) : (
        cats.map((c) => (
          <Docket key={c || "_"}>
            {c ? <Eyebrow>{c}</Eyebrow> : <div className="pt-2" />}
            {items.filter((i) => i.category === c).map((i) => {
              const count = qtyOf(i.id);
              return (
                <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-stone-100">
                  <div className="min-w-0">
                    <div className="text-sm text-stone-800 truncate">{i.name}</div>
                    <Money v={i.price} cur={cur} className="text-xs text-stone-500" />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {count > 0 ? (
                      <>
                        <button type="button" disabled={!editable}
                          onClick={() => bump(i.id, i.name, i.price, -1)}
                          className="w-8 h-8 rounded border border-stone-300 bg-white flex items-center justify-center text-stone-600 disabled:opacity-40">
                          <Minus size={14} />
                        </button>
                        <span className="w-6 text-center font-mono text-sm">{count}</span>
                      </>
                    ) : null}
                    <button type="button" disabled={!editable}
                      onClick={() => bump(i.id, i.name, i.price, 1)}
                      className="w-8 h-8 rounded bg-amber-400 hover:bg-amber-300 flex items-center justify-center text-stone-900 disabled:opacity-40">
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </Docket>
        ))
      )}

      <Docket className="border-stone-900">
        <Eyebrow right={
          cart.length ? (
            <button type="button" onClick={() => setCart([])}
              className="text-[11px] text-stone-400 underline">{t.clearCart}</button>
          ) : null
        }>{t.myOrder}</Eyebrow>

        {cart.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-stone-400">{t.emptyCart}</p>
        ) : (
          <>
            <div className="pb-1">
              {cart.map((c) => (
                <div key={c.key} className="px-4 py-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm truncate">
                      <span className="font-mono text-stone-500">{c.qty}×</span> {c.name}
                    </span>
                    <Money v={c.price * c.qty} cur={cur} className="text-sm shrink-0" />
                  </div>
                  <button type="button" disabled={!editable}
                    onClick={() => { setNoteFor(c.key); setNoteVal(c.note); }}
                    className="text-[11px] text-stone-400 hover:text-stone-700 underline disabled:no-underline">
                    {c.note || t.noteLabel}
                  </button>
                </div>
              ))}
            </div>
            <Tear />
            <Line label={t.subtotal} value={cartTotal} cur={cur} strong />
            <div className="px-4 py-3">
              <Btn variant="primary" size="lg" onClick={submit} disabled={!editable}>
                <Send size={15} />{myOrder ? t.updateOrder : t.sendOrder}
              </Btn>
            </div>
          </>
        )}
      </Docket>

      <Sheet open={!!noteFor} onClose={() => setNoteFor(null)} title={t.noteLabel}
        footer={
          <Btn variant="primary" size="lg" onClick={() => {
            setCart((prev) => prev.map((c) => (c.key === noteFor ? { ...c, note: noteVal.trim() } : c)));
            setNoteFor(null);
          }}>{t.save}</Btn>
        }>
        <Field label={t.noteLabel}>
          <input className={inputCls} value={noteVal} placeholder={t.notePh}
            onChange={(e) => setNoteVal(e.target.value)} />
        </Field>
      </Sheet>
    </div>
  );
}
