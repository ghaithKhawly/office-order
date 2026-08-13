/*
 * The wall display.
 *
 * With Web Push off the table (no HTTPS on this LAN, so no secure context, so
 * no service worker), a screen in the room *is* the notification system. This
 * serves a read-only view for an old monitor by the door.
 *
 * No login: nobody wants to type a password into a TV, and the machine driving
 * it may not have a keyboard. Instead the URL carries an unguessable token the
 * admin generates and can rotate if the link leaks. What that token buys is
 * modest by design — the board deliberately contains nothing sensitive.
 *
 * In particular it never shows what any individual owes. It is a public screen
 * in a room that visitors walk through; "who has ordered" is useful social
 * pressure, "Maha owes 47,000" is nobody else's business.
 */
import { Router } from "express";
import crypto from "node:crypto";
import QRCode from "qrcode";

import { db, setting, setSetting, audit } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";
import { sseHandler, boardClientCount } from "../events.js";
import { computeSession } from "../calc.js";
import { joinUrl } from "../net-info.js";

export const boardRoutes = Router();
export const boardAdminRoutes = Router();

const TOKEN_KEY = "board_token";

/* 24 random bytes. Guessing is not a realistic attack on a LAN this size, but
   a token short enough to shoulder-surf off the address bar would be. */
function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export function boardToken() {
  let t = setting(TOKEN_KEY);
  if (!t) {
    t = newToken();
    setSetting(TOKEN_KEY, t);
    console.log("[board] generated a board token — find it in Setup");
  }
  return t;
}

/*
 * Constant-time compare. The tokens are equal length so a plain === would leak
 * very little, but this costs nothing and removes the question.
 */
function tokenOk(given) {
  const expected = boardToken();
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireBoardToken(req, res, next) {
  if (!tokenOk(req.query.token)) return res.status(401).json({ error: "bad_board_token" });
  next();
}

/* ------------------------------------------------------------------ */
/*  the board payload                                                  */
/* ------------------------------------------------------------------ */

boardRoutes.get("/", requireBoardToken, (req, res) => {
  res.json(buildBoard());
});

/*
 * Its own SSE endpoint rather than the shared one: it is token-gated, and
 * counting board clients separately means the health page can tell "the TV is
 * connected" from "six phones are connected".
 */
boardRoutes.get("/stream", requireBoardToken, (req, res) => sseHandler(req, res, { board: true }));

function buildBoard() {
  const s = db
    .prepare(
      `SELECT * FROM sessions
        WHERE status IN ('OPEN','LOCKED','PLACED')
        ORDER BY created_at DESC LIMIT 1`
    )
    .get();

  const currency = setting("currency", "SYP");
  const serverNow = new Date().toISOString();

  if (!s) return { session: null, currency, serverNow };

  const restaurant = db.prepare("SELECT * FROM restaurants WHERE id=?").get(s.restaurant_id);

  const orders = db
    .prepare(
      `SELECT o.id, o.user_id, o.status, u.name AS user_name
         FROM orders o JOIN users u ON u.id = o.user_id
        WHERE o.session_id = ?`
    )
    .all(s.id);

  const items = db
    .prepare(
      `SELECT oi.order_id, oi.unit_price_snapshot, oi.qty FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.session_id = ?`
    )
    .all(s.id);

  // Reuse the real money code rather than re-adding it here, so the total on
  // the wall can never disagree with the total on the phones.
  const byOrder = new Map();
  for (const it of items) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push({ unitPrice: it.unit_price_snapshot, qty: it.qty });
  }
  const { totals } = computeSession(
    s,
    orders.map((o) => ({ id: o.id, userId: o.user_id, status: o.status, paid: false, items: byOrder.get(o.id) || [] }))
  );

  /*
   * A rejected order means that person still has to do something, so they
   * belong in the "not yet" column with everyone who never started.
   */
  const active = db.prepare("SELECT id, name FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE").all();
  const counts = new Map();
  for (const o of orders) {
    if (o.status === "REJECTED") continue;
    counts.set(o.user_id, o.status);
  }

  const ordered = [];
  const waiting = [];
  for (const u of active) {
    (counts.has(u.id) ? ordered : waiting).push({ name: u.name, pending: counts.get(u.id) === "PENDING" });
  }

  const minOrder = restaurant?.min_order || 0;

  return {
    currency,
    serverNow,
    session: {
      id: s.id,
      status: s.status,
      restaurant: restaurant ? { name: restaurant.name } : null,
      cutoffAt: s.cutoff_at ? new Date(s.cutoff_at.replace(" ", "T") + "Z").toISOString() : null,
      ordered,
      waiting,
      // Totals only. Never a per-person figure.
      itemsTotal: totals.itemsTotal,
      deliveryFee: totals.deliveryFee,
      grandTotal: totals.grandTotal,
      approvedCount: totals.approvedCount,
      minOrder,
      minOrderMet: minOrder === 0 || totals.itemsTotal >= minOrder
    }
  };
}

/* ------------------------------------------------------------------ */
/*  admin: the token and the QR code                                   */
/* ------------------------------------------------------------------ */

boardAdminRoutes.use(authRequired, adminRequired);

boardAdminRoutes.get("/", async (req, res) => {
  const port = Number(process.env.PORT || 3001);
  const join = joinUrl(port);
  res.json({
    token: boardToken(),
    boardPath: `/board?token=${boardToken()}`,
    joinUrl: join,
    // SVG, not PNG: it stays sharp printed at any size and is a fraction of
    // the bytes. Generated locally — this machine has no internet.
    joinQr: await QRCode.toString(join, { type: "svg", margin: 1, width: 320 })
  });
});

boardAdminRoutes.post("/rotate", (req, res) => {
  const t = newToken();
  setSetting(TOKEN_KEY, t);
  audit(req.user.id, "board.rotate_token", "settings", TOKEN_KEY);
  res.json({ token: t, boardPath: `/board?token=${t}` });
});

export { boardClientCount };
