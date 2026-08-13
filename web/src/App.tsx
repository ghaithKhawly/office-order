import { useCallback, useEffect, useState } from "react";
import {
  ChefHat, Receipt, ShoppingBag, Wallet, Settings, Languages, Loader2, WifiOff
} from "lucide-react";
import {
  api, subscribe, getToken, setToken, ApiError,
  type User, type Session, type Restaurant, type Balance
} from "./api";
import { DICT, errText, type Lang, type T as Dict } from "./i18n";
import { Btn, Docket, Field, inputCls } from "./ui";
import Today from "./screens/Today";
import MenuScreen from "./screens/MenuScreen";
import MoneyScreen from "./screens/MoneyScreen";
import SetupScreen from "./screens/Setup";

export interface Ctx {
  t: Dict;
  lang: Lang;
  cur: string;
  me: User;
  isAdmin: boolean;
  session: Session | null;
  restaurants: Restaurant[];
  users: User[];
  balances: Balance[];
  /* server clock minus this device's clock, in ms. See reload(). */
  clockOffset: number;
  reload: () => Promise<void>;
  flash: (msg: string) => void;
  run: <R>(fn: () => Promise<R>) => Promise<R | undefined>;
  goto: (tab: Tab) => void;
}

type Tab = "today" | "menu" | "money" | "setup";

export default function App() {
  const [lang, setLang] = useState<Lang>(
    (localStorage.getItem("oo:lang") as Lang) || "ar"
  );
  const [me, setMe] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<Tab>("today");
  const [toast, setToast] = useState<string | null>(null);
  const [down, setDown] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [clockOffset, setClockOffset] = useState(0);

  const t = DICT[lang];
  const rtl = lang === "ar";
  const [cur, setCur] = useState("SYP");

  useEffect(() => {
    localStorage.setItem("oo:lang", lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
  }, [lang, rtl]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [s, r, u, b, st] = await Promise.all([
        api.activeSession(), api.restaurants(), api.users(), api.balances(), api.settings()
      ]);
      setSession(s);
      setRestaurants(r);
      setUsers(u);
      setBalances(b);
      setCur(st.currency);
      setDown(false);
      /*
       * Office phones drift, and some are set to the wrong timezone entirely.
       * The cutoff countdown has to match the server that does the locking, so
       * every refresh re-measures the difference between the two clocks.
       */
      if (s?.serverNow) setClockOffset(Date.parse(s.serverNow) - Date.now());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else setDown(true);
    }
  }, []);

  const run = useCallback(
    async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
      try {
        const out = await fn();
        await reload();
        return out;
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 401) setMe(null);
          else flash(errText(t, e.code));
        } else {
          setDown(true);
        }
        return undefined;
      }
    },
    [reload, flash, t]
  );

  // boot: restore session from token
  useEffect(() => {
    (async () => {
      if (!getToken()) { setBooting(false); return; }
      try {
        const { user } = await api.me();
        setMe(user);
        await reload();
      } catch {
        setToken(null);
      } finally {
        setBooting(false);
      }
    })();
  }, [reload]);

  // live sync
  useEffect(() => {
    if (!me) return;
    const off = subscribe(() => { void reload(); });
    const poll = setInterval(() => { void reload(); }, 30000);
    return () => { off(); clearInterval(poll); };
  }, [me, reload]);

  if (booting) {
    return (
      <div className="min-h-full flex items-center justify-center bg-stone-100">
        <Loader2 className="animate-spin text-stone-400" size={28} />
      </div>
    );
  }

  if (!me) {
    return (
      <Login
        t={t} lang={lang} setLang={setLang}
        onIn={async (u) => { setMe(u); await reload(); }}
      />
    );
  }

  const ctx: Ctx = {
    t, lang, cur, me, isAdmin: me.role === "ADMIN",
    session, restaurants, users, balances, clockOffset,
    reload, flash, run, goto: setTab
  };

  const pending = session ? session.orders.filter((o) => o.status === "PENDING").length : 0;
  const tabs: [Tab, typeof Receipt, string, number][] = [
    ["today", Receipt, t.today, pending],
    ["menu", ShoppingBag, t.menu, 0],
    ["money", Wallet, t.money, 0],
    ["setup", Settings, t.setup, 0]
  ];

  return (
    <div className="min-h-full bg-stone-100 text-stone-900">
      <header className="sticky top-0 z-30 bg-stone-100 border-b border-stone-200">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <ChefHat size={18} className="text-amber-500 shrink-0" />
            <span className="font-bold tracking-tight truncate">{t.appName}</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-stone-400 truncate">{me.name}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {down ? <WifiOff size={15} className="text-red-500" /> : null}
            <button type="button" onClick={() => setLang(rtl ? "en" : "ar")}
              className="p-2 rounded hover:bg-stone-200 text-stone-500">
              <Languages size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-3 pt-4 pb-28">
        {down ? (
          <div className="mb-3 flex items-center justify-between gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2.5">
            <span>{t.offline}</span>
            <Btn size="sm" onClick={() => void reload()}>{t.retry}</Btn>
          </div>
        ) : null}

        {tab === "today" && <Today ctx={ctx} />}
        {tab === "menu" && <MenuScreen ctx={ctx} />}
        {tab === "money" && <MoneyScreen ctx={ctx} />}
        {tab === "setup" && <SetupScreen ctx={ctx} onSignOut={() => { setToken(null); setMe(null); }} />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-stone-200">
        <div className="max-w-2xl mx-auto grid grid-cols-4">
          {tabs.map(([key, Icon, label, badge]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors ${
                tab === key ? "text-stone-900" : "text-stone-400 hover:text-stone-600"
              }`}>
              <Icon size={19} />
              <span className={tab === key ? "font-semibold" : ""}>{label}</span>
              {tab === key ? <span className="absolute top-0 inset-x-5 h-0.5 bg-amber-400 rounded-b" /> : null}
              {badge > 0 && me.role === "ADMIN" ? (
                <span className="absolute top-1 end-1/4 bg-red-600 text-white text-[9px] font-bold rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
                  {badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      {toast ? (
        <div className="fixed bottom-20 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="bg-stone-900 text-stone-50 text-sm px-4 py-2.5 rounded shadow-lg">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}

function Login({ t, lang, setLang, onIn }: {
  t: Dict; lang: Lang; setLang: (l: Lang) => void;
  onIn: (u: User) => void | Promise<void>;
}) {
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!username.trim() || !password) return;
    setBusy(true);
    setErr("");
    try {
      const { token, user } = await api.login(username.trim(), password);
      setToken(token);
      await onIn(user);
    } catch (e) {
      // 401 is the everyday case. Anything else that came back *as an API
      // error* still reached the server, so show what it actually said —
      // "too many attempts" must not read as "the server is down".
      if (e instanceof ApiError) setErr(e.status === 401 ? t.badCreds : errText(t, e.code));
      else setErr(t.offline);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full bg-stone-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <ChefHat size={20} className="text-amber-500" />
            <span className="font-bold text-lg tracking-tight">{t.appName}</span>
          </div>
          <button type="button" onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="text-xs text-stone-500 underline">
            {lang === "ar" ? "English" : "عربي"}
          </button>
        </div>
        <Docket className="p-4">
          <Field label={t.username}>
            <input className={inputCls} dir="ltr" autoCapitalize="none" autoCorrect="off"
              value={username} onChange={(e) => setU(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </Field>
          <Field label={t.password}>
            <input className={inputCls} dir="ltr" type="password" value={password}
              onChange={(e) => setP(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </Field>
          {err ? <p className="text-xs text-red-600 mb-3">{err}</p> : null}
          <Btn variant="primary" size="lg" onClick={submit} disabled={busy || !username || !password}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {t.signIn}
          </Btn>
        </Docket>
      </div>
    </div>
  );
}
