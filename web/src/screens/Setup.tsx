import { useEffect, useState } from "react";
import {
  Plus, Pencil, Trash2, Crown, LogOut, AlertTriangle, KeyRound
} from "lucide-react";
import { api, type Restaurant, type MenuItem } from "../api";
import type { Ctx } from "../App";
import { Btn, Docket, Eyebrow, Field, Money, Sheet, inputCls } from "../ui";

export default function SetupScreen({ ctx, onSignOut }: { ctx: Ctx; onSignOut: () => void }) {
  const { t, cur, me, isAdmin, restaurants, users, run, flash } = ctx;
  const [editing, setEditing] = useState<Restaurant | null>(null);
  const [creating, setCreating] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [currency, setCurrency] = useState(cur);

  useEffect(() => setCurrency(cur), [cur]);

  const staleDays = (r: Restaurant) =>
    Math.floor((Date.now() - new Date(r.menuUpdatedAt.replace(" ", "T") + "Z").getTime()) / 86400000);

  return (
    <div className="space-y-3">
      <Docket className="px-4 py-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{me.name}</div>
          <div className="text-[11px] text-stone-400">
            @{me.username}{me.role === "ADMIN" ? ` · ${t.admin}` : ""}{me.trusted ? ` · ${t.trusted}` : ""}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Btn size="sm" onClick={() => setPwOpen(true)}><KeyRound size={13} /></Btn>
          <Btn size="sm" onClick={onSignOut}><LogOut size={13} />{t.signOut}</Btn>
        </div>
      </Docket>

      <Docket>
        <Eyebrow right={
          isAdmin ? (
            <Btn size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={13} />{t.addRestaurant}
            </Btn>
          ) : undefined
        }>{t.restaurants}</Eyebrow>
        {restaurants.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-stone-400">{t.noRestaurants}</p>
        ) : (
          <div className="pb-2">
            {restaurants.map((r) => {
              const d = staleDays(r);
              return (
                <div key={r.id} className="px-4 py-2.5 border-t border-stone-100 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{r.name}</div>
                    <div className="text-[11px] text-stone-400">
                      {r.menu.length} {t.itemsCount} · {t.delivery} <Money v={r.deliveryFee} />
                    </div>
                    {d >= 30 ? (
                      <div className="text-[11px] text-amber-700 mt-0.5 flex items-center gap-1">
                        <AlertTriangle size={11} />{t.staleMenu} {d} {t.day} — {t.verifyPrices}
                      </div>
                    ) : null}
                  </div>
                  {isAdmin ? (
                    <Btn size="sm" onClick={() => setEditing(r)}><Pencil size={13} />{t.edit}</Btn>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Docket>

      <Docket>
        <Eyebrow right={
          isAdmin ? (
            <Btn size="sm" onClick={() => setAddingPerson(true)}><Plus size={13} />{t.addPerson}</Btn>
          ) : undefined
        }>{t.people} · {users.length}</Eyebrow>
        <div className="pb-2">
          {users.map((u) => (
            <div key={u.id} className="px-4 py-2.5 border-t border-stone-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm truncate">{u.name}</span>
                {u.role === "ADMIN" ? <Crown size={12} className="text-amber-500 shrink-0" /> : null}
              </div>
              {isAdmin ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button type="button"
                    onClick={() => run(() => api.updateUser(u.id, { trusted: !u.trusted }))}
                    className={`text-[10px] uppercase tracking-widest border rounded px-2 py-1 ${
                      u.trusted ? "border-emerald-500 text-emerald-700 bg-emerald-50" : "border-stone-300 text-stone-400"
                    }`}>{t.trusted}</button>
                  <button type="button"
                    onClick={() => run(() => api.updateUser(u.id, { role: u.role === "ADMIN" ? "MEMBER" : "ADMIN" }))}
                    className={`text-[10px] uppercase tracking-widest border rounded px-2 py-1 ${
                      u.role === "ADMIN" ? "border-amber-500 text-amber-700 bg-amber-50" : "border-stone-300 text-stone-400"
                    }`}>{t.admin}</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {isAdmin ? (
          <p className="px-4 pb-3 text-[11px] text-stone-400">{t.autoApproveHint}</p>
        ) : null}
      </Docket>

      {isAdmin ? (
        <Docket className="px-4 py-3">
          <Field label={t.currency}>
            <div className="flex gap-2">
              <input className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)} />
              <Btn onClick={() => run(() => api.saveSettings(currency))}>{t.save}</Btn>
            </div>
          </Field>
        </Docket>
      ) : null}

      {creating ? (
        <NewRestaurant ctx={ctx} onClose={() => setCreating(false)} />
      ) : null}
      {editing ? (
        <MenuEditor ctx={ctx} restaurant={editing} onClose={() => setEditing(null)} />
      ) : null}
      {addingPerson ? (
        <NewPerson ctx={ctx} onClose={() => setAddingPerson(false)} />
      ) : null}

      <PasswordSheet ctx={ctx} open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function NewRestaurant({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const { t, cur, run } = ctx;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fee, setFee] = useState("0");
  const [min, setMin] = useState("0");
  return (
    <Sheet open onClose={onClose} title={t.addRestaurant}
      footer={
        <Btn variant="primary" size="lg" disabled={!name.trim()}
          onClick={async () => {
            const r = await run(() => api.createRestaurant({
              name: name.trim(), phone, deliveryFee: Number(fee) || 0, minOrder: Number(min) || 0
            }));
            if (r) onClose();
          }}>{t.create}</Btn>
      }>
      <Field label={t.rName}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t.phone}>
        <input className={inputCls} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${t.deliveryFee} (${cur})`}>
          <input className={inputCls} dir="ltr" inputMode="numeric" value={fee}
            onChange={(e) => setFee(e.target.value.replace(/[^0-9]/g, ""))} />
        </Field>
        <Field label={`${t.minOrder} (${cur})`}>
          <input className={inputCls} dir="ltr" inputMode="numeric" value={min}
            onChange={(e) => setMin(e.target.value.replace(/[^0-9]/g, ""))} />
        </Field>
      </div>
    </Sheet>
  );
}

function MenuEditor({ ctx, restaurant, onClose }: { ctx: Ctx; restaurant: Restaurant; onClose: () => void }) {
  const { t, cur, run } = ctx;
  const [name, setName] = useState(restaurant.name);
  const [phone, setPhone] = useState(restaurant.phone);
  const [fee, setFee] = useState(String(restaurant.deliveryFee));
  const [min, setMin] = useState(String(restaurant.minOrder));
  const [menu, setMenu] = useState<MenuItem[]>(restaurant.menu.map((m) => ({ ...m })));
  const [pct, setPct] = useState("");

  const setItem = <K extends keyof MenuItem>(id: string, k: K, v: MenuItem[K]) =>
    setMenu((prev) => prev.map((m) => (m.id === id ? { ...m, [k]: v } : m)));

  async function save() {
    await run(() => api.updateRestaurant(restaurant.id, {
      name: name.trim(), phone, deliveryFee: Number(fee) || 0, minOrder: Number(min) || 0
    }));
    const r = await run(() => api.saveMenu(restaurant.id, menu.filter((m) => m.name.trim())));
    if (r) onClose();
  }

  return (
    <Sheet open onClose={onClose} title={restaurant.name}
      footer={
        <div className="flex gap-2">
          <Btn variant="primary" size="lg" onClick={save}>{t.save}</Btn>
          <Btn variant="bad" onClick={async () => {
            const r = await run(() => api.deleteRestaurant(restaurant.id));
            if (r) onClose();
          }}><Trash2 size={15} /></Btn>
        </div>
      }>
      <Field label={t.rName}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.phone}>
          <input className={inputCls} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={`${t.deliveryFee} (${cur})`}>
          <input className={inputCls} dir="ltr" inputMode="numeric" value={fee}
            onChange={(e) => setFee(e.target.value.replace(/[^0-9]/g, ""))} />
        </Field>
      </div>
      <Field label={`${t.minOrder} (${cur})`}>
        <input className={inputCls} dir="ltr" inputMode="numeric" value={min}
          onChange={(e) => setMin(e.target.value.replace(/[^0-9]/g, ""))} />
      </Field>

      <div className="border-t border-dashed border-stone-300 my-4" />

      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] uppercase tracking-widest text-stone-500">
          {t.menuItems} · {menu.length}
        </span>
        <div className="flex items-center gap-1.5">
          <input className="w-16 bg-white border border-stone-300 rounded px-2 py-1 text-xs" dir="ltr"
            placeholder="+10" value={pct} onChange={(e) => setPct(e.target.value)} />
          <Btn size="sm" onClick={() => {
            const p = Number(pct);
            if (!p) return;
            setMenu((prev) => prev.map((m) => ({ ...m, price: Math.round(m.price * (1 + p / 100)) })));
            setPct("");
          }}>{t.bulkPct}</Btn>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        {menu.map((m) => (
          <div key={m.id} className="border border-stone-200 rounded p-2 bg-white">
            <div className="flex gap-2 mb-2">
              <input className={inputCls + " flex-1"} placeholder={t.name} value={m.name}
                onChange={(e) => setItem(m.id, "name", e.target.value)} />
              <input className="w-24 bg-white border border-stone-300 rounded px-2 py-2.5 text-sm" dir="ltr"
                inputMode="numeric" placeholder={t.price} value={String(m.price)}
                onChange={(e) => setItem(m.id, "price", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} />
            </div>
            <div className="flex gap-2 items-center">
              <input className="flex-1 bg-white border border-stone-300 rounded px-2 py-1.5 text-xs"
                placeholder={t.category} value={m.category}
                onChange={(e) => setItem(m.id, "category", e.target.value)} />
              <button type="button" onClick={() => setItem(m.id, "available", !m.available)}
                className={`text-[10px] uppercase tracking-widest border rounded px-2 py-1.5 ${
                  m.available ? "border-emerald-500 text-emerald-700 bg-emerald-50" : "border-stone-300 text-stone-400"
                }`}>{m.available ? t.available : t.unavailable}</button>
              <button type="button" onClick={() => setMenu((p) => p.filter((x) => x.id !== m.id))}
                className="p-1.5 text-red-500 hover:bg-red-50 rounded">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Btn size="lg" onClick={() =>
        setMenu((p) => [...p, {
          id: crypto.randomUUID(), name: "", price: 0, category: "", available: true
        }])}>
        <Plus size={15} />{t.addItem}
      </Btn>
    </Sheet>
  );
}

function NewPerson({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const { t, run } = ctx;
  const [username, setU] = useState("");
  const [name, setName] = useState("");
  const [password, setP] = useState("");
  const [created, setCreated] = useState<{ username: string; tempPassword: string } | null>(null);

  return (
    <Sheet open onClose={onClose} title={t.addPerson}
      footer={
        created ? (
          <Btn variant="primary" size="lg" onClick={onClose}>{t.save}</Btn>
        ) : (
          <Btn variant="primary" size="lg" disabled={!username.trim() || !name.trim()}
            onClick={async () => {
              const r = await run(() => api.createUser({
                username: username.trim().toLowerCase(), name: name.trim(),
                password: password.trim() || undefined
              }));
              if (r) setCreated({ username: r.user.username, tempPassword: r.tempPassword });
            }}>{t.create}</Btn>
        )
      }>
      {created ? (
        <div className="text-sm space-y-2">
          <p className="text-stone-600">{t.tempPassword}</p>
          <div className="bg-stone-900 text-stone-100 rounded p-3 font-mono text-sm" dir="ltr">
            {created.username} / {created.tempPassword}
          </div>
        </div>
      ) : (
        <>
          <Field label={t.username}>
            <input className={inputCls} dir="ltr" autoCapitalize="none" value={username}
              onChange={(e) => setU(e.target.value)} placeholder="ghaith" />
          </Field>
          <Field label={t.name}>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t.password}>
            <input className={inputCls} dir="ltr" value={password} onChange={(e) => setP(e.target.value)} />
          </Field>
        </>
      )}
    </Sheet>
  );
}

function PasswordSheet({ ctx, open, onClose }: { ctx: Ctx; open: boolean; onClose: () => void }) {
  const { t, run, flash } = ctx;
  const [current, setC] = useState("");
  const [next, setN] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title={t.changePassword}
      footer={
        <Btn variant="primary" size="lg" disabled={!current || next.length < 4}
          onClick={async () => {
            const r = await run(() => api.changePassword(current, next));
            if (r) { flash(t.passwordChanged); setC(""); setN(""); onClose(); }
          }}>{t.save}</Btn>
      }>
      <Field label={t.currentPassword}>
        <input className={inputCls} dir="ltr" type="password" value={current} onChange={(e) => setC(e.target.value)} />
      </Field>
      <Field label={t.newPassword}>
        <input className={inputCls} dir="ltr" type="password" value={next} onChange={(e) => setN(e.target.value)} />
      </Field>
    </Sheet>
  );
}
