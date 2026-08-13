import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus, Pencil, Trash2, Crown, LogOut, AlertTriangle, KeyRound,
  ClipboardPaste, Upload, Download, ImagePlus, ZoomIn, ZoomOut,
  Copy, MonitorPlay, RefreshCw
} from "lucide-react";
import {
  api, type Restaurant, type MenuItem, type ParsedRow, type ParsedMenu, type Photo
} from "../api";
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

      {isAdmin ? <BoardPanel ctx={ctx} /> : null}

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

/*
 * The wall display link and the join QR code.
 *
 * The QR is generated on the server from its own LAN address, so it always
 * points somewhere a phone on this network can actually reach. Print it and
 * tape it by the door — that is the whole onboarding flow for a new colleague.
 */
function BoardPanel({ ctx }: { ctx: Ctx }) {
  const { t, run, flash } = ctx;
  const [info, setInfo] = useState<{ token: string; boardPath: string; joinUrl: string; joinQr: string } | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => { api.boardInfo().then(setInfo).catch(() => {}); }, []);

  if (!info) return null;
  const boardUrl = info.joinUrl + info.boardPath;

  return (
    <Docket>
      <Eyebrow>{t.board}</Eyebrow>
      <div className="px-4 pb-4">
        <p className="text-[11px] text-stone-400 mb-3 leading-relaxed">{t.boardHint}</p>

        <div className="grid sm:grid-cols-[auto_minmax(0,1fr)] gap-4 items-start">
          {/* The SVG comes from the server; it is our own QR of our own address. */}
          <div className="w-32 h-32 bg-white rounded border border-stone-200 p-1.5 shrink-0"
            dangerouslySetInnerHTML={{ __html: info.joinQr }} />

          <div className="min-w-0">
            <span className="block text-[10px] uppercase tracking-widest text-stone-400 mb-1">{t.joinUrl}</span>
            <code dir="ltr" className="block text-xs font-mono bg-stone-100 rounded px-2 py-1.5 mb-3 select-all break-all">
              {info.joinUrl}
            </code>

            <span className="block text-[10px] uppercase tracking-widest text-stone-400 mb-1">{t.boardLink}</span>
            <code dir="ltr" className="block text-[10px] font-mono bg-stone-100 rounded px-2 py-1.5 mb-2 select-all break-all">
              {boardUrl}
            </code>

            <div className="flex gap-2 flex-wrap">
              <Btn size="sm" onClick={async () => {
                try {
                  await navigator.clipboard.writeText(boardUrl);
                  flash(t.copied);
                } catch { flash(t.copyManual); }
              }}><Copy size={13} />{t.copy}</Btn>
              <Btn size="sm" onClick={() => window.open(info.boardPath, "_blank")}>
                <MonitorPlay size={13} />{t.openBoard}
              </Btn>
              <Btn size="sm" variant="bad" onClick={() => setConfirmRotate(true)}>
                <RefreshCw size={13} />{t.rotateToken}
              </Btn>
            </div>
          </div>
        </div>
      </div>

      <Sheet open={confirmRotate} onClose={() => setConfirmRotate(false)} title={t.rotateToken}
        footer={
          <Btn variant="primary" size="lg" onClick={async () => {
            const r = await run(() => api.rotateBoardToken());
            if (r) {
              const fresh = await api.boardInfo();
              setInfo(fresh);
              setConfirmRotate(false);
              flash(t.rotated);
            }
          }}>{t.confirm}</Btn>
        }>
        <p className="text-sm text-stone-600">{t.rotateWarn}</p>
      </Sheet>
    </Docket>
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

/*
 * Menu editor.
 *
 * Built around one measurement: a 40-item Arabic menu should be typeable in
 * under six minutes, from a photo, without touching the mouse. That drives
 * three things — a grid where Tab walks name → price → category and Enter
 * makes the next row, a paste box that reads a whole menu at once, and the
 * photo pinned beside the grid so nobody is looking away from the screen.
 */
function MenuEditor({ ctx, restaurant, onClose }: { ctx: Ctx; restaurant: Restaurant; onClose: () => void }) {
  const { t, cur, run, flash, lang } = ctx;
  const [name, setName] = useState(restaurant.name);
  const [phone, setPhone] = useState(restaurant.phone);
  const [fee, setFee] = useState(String(restaurant.deliveryFee));
  const [min, setMin] = useState(String(restaurant.minOrder));
  const [menu, setMenu] = useState<MenuItem[]>(restaurant.menu.map((m) => ({ ...m })));
  const [pct, setPct] = useState("");
  const [pasting, setPasting] = useState(false);
  const [showPhotos, setShowPhotos] = useState(true);

  const setItem = <K extends keyof MenuItem>(id: string, k: K, v: MenuItem[K]) =>
    setMenu((prev) => prev.map((m) => (m.id === id ? { ...m, [k]: v } : m)));

  async function save() {
    await run(() => api.updateRestaurant(restaurant.id, {
      name: name.trim(), phone, deliveryFee: Number(fee) || 0, minOrder: Number(min) || 0
    }));
    const r = await run(() => api.saveMenu(restaurant.id, menu.filter((m) => m.name.trim())));
    if (r) onClose();
  }

  async function exportMenu() {
    const data = await run(() => api.exportMenu(restaurant.id));
    if (!data) return;
    // Build the file in the browser: the export route needs an auth header, so
    // a plain link to it would download a 401.
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${restaurant.name.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importMenu(file: File) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      flash(t.err_malformed_json);
      return;
    }
    const res = await run(() =>
      api.importMenu(parsed as never, { restaurantId: restaurant.id })
    );
    if (!res) return;
    flash(
      res.rejected.length
        ? `${t.importedOk}: ${res.imported} · ${res.rejected.length} ${t.importRejected}`
        : `${t.importedOk}: ${res.imported}`
    );
    if (res.restaurant) setMenu(res.restaurant.menu.map((m) => ({ ...m })));
  }

  return (
    <Sheet open onClose={onClose} title={restaurant.name} size="wide"
      footer={
        <div className="flex gap-2">
          <Btn variant="primary" size="lg" onClick={save}>{t.save}</Btn>
          <Btn variant="bad" onClick={async () => {
            const r = await run(() => api.deleteRestaurant(restaurant.id));
            if (r) onClose();
          }}><Trash2 size={15} /></Btn>
        </div>
      }>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem] gap-4 h-full">
        {/* ---- the grid ---- */}
        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.rName}>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t.phone}>
              <input className={inputCls} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label={`${t.deliveryFee} (${cur})`}>
              <input className={inputCls} dir="ltr" inputMode="numeric" value={fee}
                onChange={(e) => setFee(e.target.value.replace(/[^0-9]/g, ""))} />
            </Field>
            <Field label={`${t.minOrder} (${cur})`}>
              <input className={inputCls} dir="ltr" inputMode="numeric" value={min}
                onChange={(e) => setMin(e.target.value.replace(/[^0-9]/g, ""))} />
            </Field>
          </div>

          <div className="border-t border-dashed border-stone-300 my-4" />

          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-widest text-stone-500">
              {t.menuItems} · {menu.length}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Btn size="sm" onClick={() => setPasting(true)}>
                <ClipboardPaste size={13} />{t.pasteMenu}
              </Btn>
              <label className="inline-flex items-center justify-center gap-2 rounded font-medium text-xs px-2.5 py-1.5 bg-white text-stone-700 border border-stone-300 hover:bg-stone-50 cursor-pointer">
                <Upload size={13} />{t.importMenu}
                <input type="file" accept="application/json,.json" className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void importMenu(f);
                  }} />
              </label>
              <Btn size="sm" onClick={exportMenu}><Download size={13} />{t.exportMenu}</Btn>
            </div>
          </div>

          <div className="flex items-center gap-1.5 mb-3">
            <input className="w-16 bg-white border border-stone-300 rounded px-2 py-1 text-xs" dir="ltr"
              placeholder="+10" value={pct} onChange={(e) => setPct(e.target.value)} />
            <Btn size="sm" onClick={() => {
              const p = Number(pct);
              if (!p) return;
              setMenu((prev) => prev.map((m) => ({ ...m, price: Math.round(m.price * (1 + p / 100)) })));
              setPct("");
            }}>{t.bulkPct}</Btn>
          </div>

          <MenuGrid ctx={ctx} menu={menu} setMenu={setMenu} setItem={setItem} />
        </div>

        {/* ---- the photo, beside the grid ---- */}
        <div className="min-w-0 lg:border-s lg:border-stone-200 lg:ps-4">
          <button type="button" onClick={() => setShowPhotos((v) => !v)}
            className="lg:hidden w-full mb-2 text-xs text-stone-500 underline">
            {showPhotos ? t.hidePhoto : t.showPhoto}
          </button>
          <div className={showPhotos ? "" : "hidden lg:block"}>
            <PhotoPane ctx={ctx} restaurantId={restaurant.id} />
          </div>
        </div>
      </div>

      {pasting ? (
        <PasteMenuSheet ctx={ctx} onClose={() => setPasting(false)}
          onApply={(rows) => {
            setMenu((prev) => [
              ...prev,
              ...rows.map((r) => ({
                id: crypto.randomUUID(), name: r.name, price: r.price,
                category: r.category, available: true
              }))
            ]);
            setPasting(false);
            flash(`${rows.length} ${t.parsedRows}`);
          }} />
      ) : null}
    </Sheet>
  );
}

/*
 * The grid. Tab order is exactly name → price → category → next row's name,
 * which is why the availability toggle and the delete button carry
 * tabIndex={-1}: with them in the sequence, typing 40 items means 120 extra
 * Tab presses past controls nobody touches while transcribing. Both stay
 * clickable, and Ctrl+Delete removes a row from the keyboard.
 */
function MenuGrid({ ctx, menu, setMenu, setItem }: {
  ctx: Ctx;
  menu: MenuItem[];
  setMenu: React.Dispatch<React.SetStateAction<MenuItem[]>>;
  setItem: <K extends keyof MenuItem>(id: string, k: K, v: MenuItem[K]) => void;
}) {
  const { t } = ctx;
  const nameRefs = useRef(new Map<string, HTMLInputElement>());
  const [focusId, setFocusId] = useState<string | null>(null);

  // Focus the row we just created, once React has actually put it in the DOM.
  // Refs are attached during commit, so by the time this effect runs the new
  // input exists.
  useEffect(() => {
    if (!focusId) return;
    nameRefs.current.get(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const blank = (category = "") => ({
    id: crypto.randomUUID(), name: "", price: 0, category, available: true
  });

  /*
   * Build the row first, then call the two setters separately. Setting focus
   * state from inside the setMenu updater is an update dispatched during
   * another update — React drops it, and Enter silently does nothing.
   */
  function addAfter(index: number) {
    // Inherit the category above — menus are typed one section at a time.
    const row = blank(menu[index]?.category ?? "");
    setMenu((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, row);
      return next;
    });
    setFocusId(row.id);
  }

  function duplicateAbove(index: number) {
    const above = menu[index - 1];
    if (!above) return;
    setMenu((prev) => prev.map((m, i) =>
      i === index ? { ...m, name: above.name, price: above.price, category: above.category } : m
    ));
  }

  function onKeyDown(e: React.KeyboardEvent, index: number, id: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      addAfter(index);
    } else if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      duplicateAbove(index);
    } else if (e.key === "Delete" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const target = menu[index + 1]?.id ?? menu[index - 1]?.id ?? null;
      setMenu((prev) => prev.filter((m) => m.id !== id));
      if (target) setFocusId(target);
    }
  }

  return (
    <>
      <p className="text-[11px] text-stone-400 mb-2">{t.gridHint}</p>

      <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_6rem_8rem_auto] gap-2 px-1 pb-1">
        {[t.name, t.price, t.category, ""].map((h, i) => (
          <span key={i} className="text-[10px] uppercase tracking-widest text-stone-400">{h}</span>
        ))}
      </div>

      <div className="space-y-1.5 mb-3">
        {menu.map((m, i) => (
          <div key={m.id}
            className="grid grid-cols-[minmax(0,1fr)_5rem] sm:grid-cols-[minmax(0,1fr)_6rem_8rem_auto] gap-2 items-center">
            <input
              ref={(el) => { if (el) nameRefs.current.set(m.id, el); else nameRefs.current.delete(m.id); }}
              className={inputCls} placeholder={t.name} value={m.name}
              onChange={(e) => setItem(m.id, "name", e.target.value)}
              onKeyDown={(e) => onKeyDown(e, i, m.id)} />
            <input
              className="w-full bg-white border border-stone-300 rounded px-2 py-2.5 text-sm font-mono tabular-nums"
              dir="ltr" inputMode="numeric" placeholder={t.price} value={m.price ? String(m.price) : ""}
              onChange={(e) => setItem(m.id, "price", Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
              onKeyDown={(e) => onKeyDown(e, i, m.id)} />
            <input
              className="col-span-2 sm:col-span-1 w-full bg-white border border-stone-300 rounded px-2 py-2.5 text-sm"
              placeholder={t.category} value={m.category}
              onChange={(e) => setItem(m.id, "category", e.target.value)}
              onKeyDown={(e) => onKeyDown(e, i, m.id)} />
            <div className="col-span-2 sm:col-span-1 flex items-center gap-1 justify-end">
              <button type="button" tabIndex={-1} onClick={() => setItem(m.id, "available", !m.available)}
                title={m.available ? t.available : t.unavailable}
                className={`text-[10px] uppercase tracking-widest border rounded px-2 py-1.5 ${
                  m.available ? "border-emerald-500 text-emerald-700 bg-emerald-50" : "border-stone-300 text-stone-400"
                }`}>{m.available ? t.available : t.unavailable}</button>
              <button type="button" tabIndex={-1}
                onClick={() => setMenu((p) => p.filter((x) => x.id !== m.id))}
                className="p-1.5 text-red-500 hover:bg-red-50 rounded shrink-0">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Btn size="lg" onClick={() => {
        const row = blank(menu[menu.length - 1]?.category ?? "");
        setMenu((prev) => [...prev, row]);
        setFocusId(row.id);
      }}>
        <Plus size={15} />{t.addItem}
      </Btn>
    </>
  );
}

/*
 * Paste a menu, check it, then commit.
 *
 * Nothing is written until the admin presses the button at the bottom. The
 * parse runs on the server so the preview and the eventual save come from the
 * same code, and rows the parser was unsure about are flagged rather than
 * quietly guessed — a price of 15 might mean 15,000, but it might mean 15.
 */
function PasteMenuSheet({ ctx, onClose, onApply }: {
  ctx: Ctx; onClose: () => void; onApply: (rows: ParsedRow[]) => void;
}) {
  const { t, run } = ctx;
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [stats, setStats] = useState<ParsedMenu["stats"] | null>(null);

  async function parse() {
    const out = await run(() => api.parseMenu(text));
    if (!out) return;
    setRows(out.rows);
    setStats(out.stats);
  }

  const edit = (i: number, patch: Partial<ParsedRow>) =>
    setRows((prev) => prev && prev.map((r, x) => (x === i ? { ...r, ...patch } : r)));

  const flagLabel = (f: string) =>
    ({ no_price: t.f_no_price, implausible_price: t.f_implausible_price, duplicate: t.f_duplicate } as Record<string, string>)[f] || f;

  return (
    <Sheet open onClose={onClose} title={t.pasteMenu} size="wide"
      footer={
        rows ? (
          <div className="flex gap-2">
            <Btn variant="primary" size="lg" disabled={rows.length === 0}
              onClick={() => onApply(rows.filter((r) => r.name.trim()))}>
              {t.applyRows} · {rows.filter((r) => r.name.trim()).length}
            </Btn>
            <Btn onClick={() => { setRows(null); setStats(null); }}>{t.cancel}</Btn>
          </div>
        ) : (
          <Btn variant="primary" size="lg" onClick={parse} disabled={!text.trim()}>{t.parseIt}</Btn>
        )
      }>
      {!rows ? (
        <>
          <p className="text-xs text-stone-500 mb-2">{t.pasteMenuHint}</p>
          <textarea
            className={inputCls + " font-mono text-xs leading-relaxed h-72 resize-none"}
            dir="auto" placeholder={t.pastePlaceholder}
            value={text} onChange={(e) => setText(e.target.value)} />
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap text-xs text-stone-500 mb-3">
            <span><b className="text-stone-900">{rows.length}</b> {t.parsedRows}</span>
            {stats?.categories ? <span>· {stats.categories} {t.category}</span> : null}
            {stats?.flagged ? (
              <span className="text-amber-700">· {stats.flagged} {t.flaggedRows}</span>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-stone-400">{t.nothingParsed}</p>
          ) : (
            <div className="space-y-1.5">
              {rows.map((r, i) => (
                <div key={i}
                  className={`grid grid-cols-[minmax(0,1fr)_6rem_7rem] gap-2 items-center p-1.5 rounded border ${
                    r.flags.length ? "border-amber-300 bg-amber-50/60" : "border-transparent"
                  }`}>
                  <input className={inputCls} dir="auto" value={r.name}
                    onChange={(e) => edit(i, { name: e.target.value })} />
                  <input className="w-full bg-white border border-stone-300 rounded px-2 py-2.5 text-sm font-mono tabular-nums"
                    dir="ltr" inputMode="numeric" value={r.price ? String(r.price) : ""}
                    onChange={(e) => edit(i, { price: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })} />
                  <input className="w-full bg-white border border-stone-300 rounded px-2 py-2.5 text-sm"
                    dir="auto" value={r.category}
                    onChange={(e) => edit(i, { category: e.target.value })} />
                  {r.flags.length ? (
                    <div className="col-span-3 flex items-center gap-2 flex-wrap ps-1 pb-0.5">
                      {r.flags.map((f) => (
                        <span key={f} className="text-[10px] uppercase tracking-widest text-amber-700">
                          {flagLabel(f)}
                        </span>
                      ))}
                      {r.suggestedPrice ? (
                        <button type="button"
                          onClick={() => edit(i, { price: r.suggestedPrice!, flags: r.flags.filter((f) => f !== "implausible_price"), suggestedPrice: null })}
                          className="text-[10px] uppercase tracking-widest border border-amber-500 text-amber-800 rounded px-1.5 py-0.5 hover:bg-amber-100">
                          {t.useSuggested} <span className="font-mono">{r.suggestedPrice}</span>
                        </button>
                      ) : null}
                      <button type="button" onClick={() => setRows((p) => p && p.filter((_, x) => x !== i))}
                        className="text-[10px] uppercase tracking-widest text-red-600 hover:underline">
                        <Trash2 size={11} className="inline" />
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

/*
 * The menu photo, pinned next to the grid.
 *
 * This is deliberately instead of in-app OCR: Arabic menu photos with stylised
 * fonts and a right-aligned price column break Tesseract badly enough that you
 * correct half the rows anyway, and the model is 20+ MB to vendor and ship to
 * a machine with no internet. Reading from a picture is the fast path.
 */
function PhotoPane({ ctx, restaurantId }: { ctx: Ctx; restaurantId: string }) {
  const { t, run, flash } = ctx;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPhotos(await api.photos(restaurantId));
    } catch { /* the editor still works without photos */ }
  }, [restaurantId]);

  useEffect(() => { void load(); }, [load]);

  /*
   * Photos are behind auth, so each is fetched as a blob and handed to <img>
   * as an object URL. Those are not garbage collected — they live until
   * revoked — so the latest set is mirrored into a ref and released on unmount.
   * Reading `urls` directly in the cleanup would capture the empty object from
   * the first render and free nothing.
   */
  const urlsRef = useRef<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());
  useEffect(() => { urlsRef.current = urls; }, [urls]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of photos) {
        // Guard on a ref, not on `urls`: two runs of this effect would
        // otherwise both fetch the same photo and leak the loser's URL.
        if (urlsRef.current[p.id] || inFlight.current.has(p.id)) continue;
        inFlight.current.add(p.id);
        try {
          const url = await api.photoObjectUrl(p.id);
          if (cancelled) { URL.revokeObjectURL(url); return; }
          setUrls((prev) => ({ ...prev, [p.id]: url }));
        } catch {
          /* skip a photo we cannot load — the editor still works */
        } finally {
          inFlight.current.delete(p.id);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [photos]);

  useEffect(() => () => {
    Object.values(urlsRef.current).forEach(URL.revokeObjectURL);
  }, []);

  async function upload(file: File) {
    setBusy(true);
    const r = await run(() => api.uploadPhoto(restaurantId, file));
    setBusy(false);
    if (r) { await load(); setActive(photos.length); }
  }

  const current = photos[active];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] uppercase tracking-widest text-stone-500">{t.photos}</span>
        <label className="inline-flex items-center gap-1.5 text-xs text-stone-700 border border-stone-300 bg-white rounded px-2 py-1 cursor-pointer hover:bg-stone-50">
          <ImagePlus size={13} />{busy ? t.uploading : t.addPhoto}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }} />
        </label>
      </div>

      {photos.length === 0 ? (
        <div className="border border-dashed border-stone-300 rounded p-4 text-center">
          <ImagePlus size={22} className="mx-auto text-stone-300 mb-2" />
          <p className="text-xs text-stone-400">{t.noPhotos}</p>
          <p className="text-[11px] text-stone-400 mt-1">{t.photoHint}</p>
        </div>
      ) : (
        <>
          {photos.length > 1 ? (
            <div className="flex gap-1 mb-2 flex-wrap">
              {photos.map((p, i) => (
                <button key={p.id} type="button" onClick={() => { setActive(i); setZoom(1); }}
                  className={`w-9 h-9 rounded border overflow-hidden ${
                    i === active ? "border-amber-500 ring-1 ring-amber-400" : "border-stone-300"
                  }`}>
                  {urls[p.id] ? (
                    <img src={urls[p.id]} alt="" className="w-full h-full object-cover" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-1 mb-1.5">
            <button type="button" tabIndex={-1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
              className="p-1.5 rounded border border-stone-300 bg-white text-stone-600 hover:bg-stone-50">
              <ZoomOut size={14} />
            </button>
            <button type="button" tabIndex={-1} onClick={() => setZoom((z) => Math.min(6, z + 0.5))}
              className="p-1.5 rounded border border-stone-300 bg-white text-stone-600 hover:bg-stone-50">
              <ZoomIn size={14} />
            </button>
            <span className="text-[11px] text-stone-400 font-mono">{zoom.toFixed(1)}×</span>
            <button type="button" tabIndex={-1}
              onClick={async () => {
                if (!current) return;
                const ok = await run(() => api.deletePhoto(current.id));
                if (ok) {
                  setActive(0); setZoom(1);
                  setUrls((prev) => {
                    const next = { ...prev };
                    if (next[current.id]) URL.revokeObjectURL(next[current.id]);
                    delete next[current.id];
                    return next;
                  });
                  await load();
                  flash(t.deletePhoto);
                }
              }}
              className="ms-auto p-1.5 rounded text-red-500 hover:bg-red-50">
              <Trash2 size={14} />
            </button>
          </div>

          {/* Scroll for panning: simpler than drag handling and works on touch. */}
          <div className="border border-stone-200 rounded bg-stone-100 overflow-auto max-h-[26rem]">
            {current && urls[current.id] ? (
              <img src={urls[current.id]} alt={current.originalName}
                style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
                className="block" />
            ) : (
              <div className="h-40 flex items-center justify-center text-xs text-stone-400">…</div>
            )}
          </div>
          <p className="text-[11px] text-stone-400 mt-1 truncate">{current?.originalName}</p>
        </>
      )}
    </div>
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
