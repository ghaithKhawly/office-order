import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/*
 * Resolved to an absolute path deliberately. A relative DATA_DIR (or one set
 * in a .bat file that starts the app from C:\Windows\System32, which is where
 * a Windows service starts by default) would otherwise put the database
 * somewhere nobody can find and silently create a second, empty one.
 */
export const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(__dirname, "..", "data")
);
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, "app.db");
export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

/*
 * All money is stored as INTEGER in minor-free whole units (e.g. whole SYP).
 * No floats anywhere in the money path.
 */
const MIGRATIONS = [
  // v1 — initial schema
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MEMBER','ADMIN')),
    trusted       INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE restaurants (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL DEFAULT '',
    delivery_fee    INTEGER NOT NULL DEFAULT 0,
    min_order       INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    menu_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE menu_items (
    id            TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    price         INTEGER NOT NULL DEFAULT 0,
    category      TEXT NOT NULL DEFAULT '',
    available     INTEGER NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_menu_restaurant ON menu_items(restaurant_id);

  CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
    created_by    TEXT NOT NULL REFERENCES users(id),
    payer_id      TEXT NOT NULL REFERENCES users(id),
    order_date    TEXT NOT NULL DEFAULT (datetime('now')),
    status        TEXT NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN','LOCKED','PLACED','SETTLED','CANCELLED')),
    delivery_fee  INTEGER NOT NULL DEFAULT 0,
    split_mode    TEXT NOT NULL DEFAULT 'EQUAL'
                  CHECK (split_mode IN ('EQUAL','PROPORTIONAL')),
    rounding_step INTEGER NOT NULL DEFAULT 100,
    cash_step     INTEGER NOT NULL DEFAULT 0,
    cutoff_at     TEXT,
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_sessions_status ON sessions(status);

  CREATE TABLE orders (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id),
    status      TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','APPROVED','REJECTED')),
    reason      TEXT NOT NULL DEFAULT '',
    paid        INTEGER NOT NULL DEFAULT 0,
    approved_by TEXT REFERENCES users(id),
    approved_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (session_id, user_id)
  );
  CREATE INDEX idx_orders_session ON orders(session_id);

  -- name and price are SNAPSHOTS. Editing a menu never rewrites history.
  CREATE TABLE order_items (
    id                   TEXT PRIMARY KEY,
    order_id             TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id         TEXT,
    name_snapshot        TEXT NOT NULL,
    unit_price_snapshot  INTEGER NOT NULL,
    qty                  INTEGER NOT NULL CHECK (qty > 0),
    note                 TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_order_items_order ON order_items(order_id);

  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id   TEXT,
    action     TEXT NOT NULL,
    entity     TEXT NOT NULL,
    entity_id  TEXT,
    payload    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  /*
   * v2 — menu photos.
   *
   * An admin photographs the paper menu and types from it on screen. The file
   * lives on disk under DATA_DIR/uploads; only its metadata is in the database,
   * because SQLite is the thing we back up and a few MB of JPEG per restaurant
   * would bloat every snapshot.
   *
   * stored_name is generated server-side. The client's filename is kept only
   * for display and is never used to build a path.
   */
  `
  CREATE TABLE restaurant_photos (
    id            TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    stored_name   TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    mime          TEXT NOT NULL,
    bytes         INTEGER NOT NULL DEFAULT 0,
    uploaded_by   TEXT REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_photos_restaurant ON restaurant_photos(restaurant_id);
  `
];

const current = db.pragma("user_version", { simple: true });
for (let v = current; v < MIGRATIONS.length; v++) {
  db.exec("BEGIN");
  try {
    db.exec(MIGRATIONS[v]);
    db.pragma(`user_version = ${v + 1}`);
    db.exec("COMMIT");
    console.log(`[db] migrated to v${v + 1}`);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function setting(key, fallback = null) {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return r ? r.value : fallback;
}
export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}
export function audit(actorId, action, entity, entityId, payload = {}) {
  db.prepare(
    "INSERT INTO audit_log (actor_id,action,entity,entity_id,payload) VALUES (?,?,?,?,?)"
  ).run(actorId || null, action, entity, entityId || null, JSON.stringify(payload));
}
export const uid = () => crypto.randomUUID();
