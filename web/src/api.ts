export type Role = "MEMBER" | "ADMIN";
export type SessionStatus = "OPEN" | "LOCKED" | "PLACED" | "SETTLED" | "CANCELLED";
export type OrderStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface User {
  id: string; username: string; name: string;
  role: Role; trusted: boolean; active: boolean;
}
export interface MenuItem {
  id: string; name: string; price: number; category: string; available: boolean;
}
export interface Restaurant {
  id: string; name: string; phone: string;
  deliveryFee: number; minOrder: number; menuUpdatedAt: string; menu: MenuItem[];
}
export interface OrderLine {
  id: string; menuItemId: string | null; name: string;
  unitPrice: number; qty: number; note: string;
}
export interface Order {
  id: string; userId: string; userName: string;
  status: OrderStatus; reason: string; paid: boolean;
  items: OrderLine[];
  subtotal: number; deliveryShare: number; cashRounding: number;
  due: number; counted: boolean;
}
export interface Totals {
  approvedCount: number; itemsTotal: number; deliveryFee: number;
  grandTotal: number; kitty: number; collected: number; outstanding: number;
}
export interface Session {
  id: string; status: SessionStatus; orderDate: string;
  deliveryFee: number; splitMode: "EQUAL" | "PROPORTIONAL";
  roundingStep: number; cashStep: number; notes: string;
  /* ISO 8601 UTC, unlike orderDate which is bare SQL. */
  cutoffAt: string | null;
  /* The server's clock at the moment this was built; used to correct the countdown. */
  serverNow: string;
  payerId: string; payerName: string;
  restaurant: { id: string; name: string; phone: string; minOrder: number } | null;
  orders: Order[];
  totals: Totals;
}
export interface Balance { userId: string; name: string; balance: number }

/* --- menu entry (paste parser, import/export, photos) --- */

export type ParseFlag = "no_price" | "implausible_price" | "duplicate";

export interface ParsedRow {
  line: number; raw: string; name: string; price: number;
  category: string; kind: "item"; flags: ParseFlag[];
  suggestedPrice: number | null;
}
export interface ParsedMenu {
  rows: ParsedRow[];
  headers: { line: number; name: string }[];
  skipped: { line: number; raw: string; reason: string }[];
  stats: { items: number; categories: number; flagged: number; medianPrice: number | null };
}
export interface MenuFile {
  format: string; version: number; exportedAt: string;
  restaurant: { name: string; phone: string; deliveryFee: number; minOrder: number };
  items: { name: string; price: number; category: string; available: boolean }[];
}
export interface ImportResult {
  created?: boolean; dryRun?: boolean; wouldCreate?: boolean;
  imported: number; replacing?: number; restaurantName?: string;
  rejected: { row: number; name: string; error: string }[];
  restaurant?: Restaurant;
}
export interface Photo {
  id: string; restaurantId: string; originalName: string;
  mime: string; bytes: number; createdAt: string;
}

/* --- ops: health and backups --- */

export interface BackupStatus {
  lastAt: string | null; lastFile: string | null; lastBytes: number;
  count: number; keep: number; intervalHours: number;
  ageHours: number | null; stale: boolean; never: boolean;
}
export interface BackupFile { file: string; bytes: number; at: string }
export interface Health {
  ok: boolean; now: string; uptimeSeconds: number; node: string;
  platform: string; pid: number; port: number;
  addresses: { address: string; iface: string; internal: boolean }[];
  memoryMB: number;
  database: {
    path: string; bytes: number; mainBytes: number; walBytes: number;
    journalMode: string; integrity: string; schemaVersion: number;
  };
  disk: { total: number | null; free: number | null; usedPct: number | null };
  backup: BackupStatus;
  clients: { total: number; board: number };
  counts: { users: number; restaurants: number; sessions: number; orders: number; auditRows: number };
}

const TOKEN_KEY = "oo:token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, (data as any).error || "request_failed");
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    req<{ token: string; user: User }>("POST", "/auth/login", { username, password }),
  me: () => req<{ user: User }>("GET", "/auth/me"),
  changePassword: (current: string, next: string) =>
    req<{ ok: true }>("POST", "/auth/password", { current, next }),

  settings: () => req<{ currency: string }>("GET", "/settings"),
  saveSettings: (currency: string) => req<{ currency: string }>("PUT", "/settings", { currency }),

  users: () => req<User[]>("GET", "/users"),
  createUser: (b: { username: string; name: string; password?: string; role?: Role; trusted?: boolean }) =>
    req<{ user: User; tempPassword: string }>("POST", "/users", b),
  updateUser: (id: string, b: Partial<{ name: string; role: Role; trusted: boolean; active: boolean; password: string }>) =>
    req<{ user: User }>("PATCH", `/users/${id}`, b),

  restaurants: () => req<Restaurant[]>("GET", "/restaurants"),
  createRestaurant: (b: { name: string; phone?: string; deliveryFee?: number; minOrder?: number }) =>
    req<Restaurant>("POST", "/restaurants", b),
  updateRestaurant: (id: string, b: Partial<{ name: string; phone: string; deliveryFee: number; minOrder: number }>) =>
    req<Restaurant>("PATCH", `/restaurants/${id}`, b),
  deleteRestaurant: (id: string) => req<{ ok: true }>("DELETE", `/restaurants/${id}`),
  saveMenu: (id: string, items: Partial<MenuItem>[]) =>
    req<Restaurant>("PUT", `/restaurants/${id}/menu`, { items }),
  adjustMenu: (id: string, percent: number) =>
    req<Restaurant>("PATCH", `/restaurants/${id}/menu/adjust`, { percent }),

  parseMenu: (text: string) => req<ParsedMenu>("POST", "/restaurants/parse-menu", { text }),
  importMenu: (menu: MenuFile, opts: { restaurantId?: string; dryRun?: boolean } = {}) =>
    req<ImportResult>("POST", "/restaurants/import", { ...menu, ...opts }),
  exportMenu: (id: string) => req<MenuFile>("GET", `/restaurants/${id}/export`),

  photos: (restaurantId: string) => req<Photo[]>("GET", `/restaurants/${restaurantId}/photos`),
  deletePhoto: (id: string) => req<{ ok: true }>("DELETE", `/photos/${id}`),
  uploadPhoto: async (restaurantId: string, file: File): Promise<Photo> => {
    // Raw bytes, not multipart — that keeps a body-parser dependency out of an
    // air-gapped deployment. The server checks the magic number regardless.
    const res = await fetch(`/api/restaurants/${restaurantId}/photos`, {
      method: "POST",
      headers: {
        "content-type": file.type,
        "X-Filename": encodeURIComponent(file.name).replace(/%20/g, " "),
        ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {})
      },
      body: file
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (data as any).error || "request_failed");
    return data as Photo;
  },
  /* Photos sit behind auth, so they cannot be used as a plain <img src>.
     Fetch the bytes and hand back an object URL the caller must revoke. */
  photoObjectUrl: async (id: string): Promise<string> => {
    const res = await fetch(`/api/photos/${id}`, {
      headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {}
    });
    if (!res.ok) throw new ApiError(res.status, "photo_failed");
    return URL.createObjectURL(await res.blob());
  },

  activeSession: () => req<Session | null>("GET", "/sessions/active"),
  sessions: (limit = 20) => req<Session[]>("GET", `/sessions?limit=${limit}`),
  createSession: (b: {
    restaurantId: string; deliveryFee: number;
    splitMode: "EQUAL" | "PROPORTIONAL"; payerId: string;
    roundingStep: number; cashStep: number; cutoffAt?: string | null;
  }) => req<Session>("POST", "/sessions", b),
  updateSession: (id: string, b: Partial<{
    status: SessionStatus; deliveryFee: number;
    splitMode: "EQUAL" | "PROPORTIONAL"; payerId: string;
    roundingStep: number; cashStep: number;
    /* null clears the cutoff; omitting the key leaves it untouched. */
    cutoffAt: string | null;
  }>) => req<Session>("PATCH", `/sessions/${id}`, b),
  deleteSession: (id: string) => req<{ ok: true }>("DELETE", `/sessions/${id}`),

  submitOrder: (sessionId: string, items: { menuItemId: string; qty: number; note?: string }[]) =>
    req<Session>("PUT", `/sessions/${sessionId}/my-order`, { items }),
  cancelMyOrder: (sessionId: string) => req<Session>("DELETE", `/sessions/${sessionId}/my-order`),
  approveAll: (sessionId: string) => req<Session>("POST", `/sessions/${sessionId}/approve-all`),
  decide: (orderId: string, status: OrderStatus, reason?: string) =>
    req<Session>("PATCH", `/orders/${orderId}/decision`, { status, reason }),
  setPaid: (orderId: string, paid: boolean) =>
    req<Session>("PATCH", `/orders/${orderId}/paid`, { paid }),

  health: () => req<Health>("GET", "/admin/health"),
  backups: () => req<{ status: BackupStatus; files: BackupFile[]; dir: string }>("GET", "/admin/backups"),
  runBackup: () => req<{ file: string; bytes: number; pruned: string[] }>("POST", "/admin/backups"),
  /* The download needs an auth header, so it cannot be a plain link — fetch the
     bytes and hand the browser a blob. */
  downloadBackup: async (): Promise<{ name: string; blob: Blob }> => {
    const res = await fetch("/api/admin/backups/download", {
      headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {}
    });
    if (!res.ok) throw new ApiError(res.status, "backup_failed");
    const cd = res.headers.get("content-disposition") || "";
    const name = /filename="([^"]+)"/.exec(cd)?.[1] || "app.db";
    return { name, blob: await res.blob() };
  },

  boardInfo: () => req<{
    token: string; boardPath: string; joinUrl: string; joinQr: string;
  }>("GET", "/board-admin"),
  rotateBoardToken: () => req<{ token: string; boardPath: string }>("POST", "/board-admin/rotate"),

  kitchenSheet: (sessionId: string) =>
    req<{ text: string }>("GET", `/sessions/${sessionId}/kitchen-sheet`),
  balances: () => req<Balance[]>("GET", "/balances")
};

/** Server-sent events: the server pings on every write, we refetch. */
export function subscribe(onChange: () => void): () => void {
  let es: EventSource | null = null;
  let stopped = false;
  let retry: number | undefined;

  const open = () => {
    if (stopped) return;
    es = new EventSource("/api/stream");
    es.onmessage = () => onChange();
    es.onerror = () => {
      es?.close();
      if (!stopped) retry = window.setTimeout(open, 4000);
    };
  };
  open();

  return () => {
    stopped = true;
    clearTimeout(retry);
    es?.close();
  };
}
