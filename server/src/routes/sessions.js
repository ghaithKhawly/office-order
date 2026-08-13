import { Router } from "express";
import { db, uid, audit } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";
import { broadcast } from "../events.js";
import { computeSession } from "../calc.js";

export const sessionRoutes = Router();
export const orderRoutes = Router();
sessionRoutes.use(authRequired);
orderRoutes.use(authRequired);

const int = (v, d = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : d;
};

/* ------------------------------------------------------------------ */
/*  loading                                                            */
/* ------------------------------------------------------------------ */

function loadOrders(sessionId) {
  const orders = db
    .prepare(
      `SELECT o.*, u.name AS user_name
         FROM orders o JOIN users u ON u.id = o.user_id
        WHERE o.session_id = ?
        ORDER BY o.created_at`
    )
    .all(sessionId);

  const items = db
    .prepare(
      `SELECT oi.* FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.session_id = ?`
    )
    .all(sessionId);

  const byOrder = new Map();
  for (const it of items) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push({
      id: it.id,
      menuItemId: it.menu_item_id,
      name: it.name_snapshot,
      unitPrice: it.unit_price_snapshot,
      qty: it.qty,
      note: it.note
    });
  }

  return orders.map((o) => ({
    id: o.id,
    userId: o.user_id,
    userName: o.user_name,
    status: o.status,
    reason: o.reason,
    paid: !!o.paid,
    items: byOrder.get(o.id) || []
  }));
}

function fullSession(id) {
  const s = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!s) return null;
  const restaurant = db.prepare("SELECT * FROM restaurants WHERE id = ?").get(s.restaurant_id);
  const { orders, totals } = computeSession(s, loadOrders(s.id));
  const payer = db.prepare("SELECT name FROM users WHERE id = ?").get(s.payer_id);

  return {
    id: s.id,
    status: s.status,
    orderDate: s.order_date,
    deliveryFee: s.delivery_fee,
    splitMode: s.split_mode,
    roundingStep: s.rounding_step,
    cashStep: s.cash_step,
    cutoffAt: s.cutoff_at,
    notes: s.notes,
    payerId: s.payer_id,
    payerName: payer ? payer.name : "",
    restaurant: restaurant
      ? {
          id: restaurant.id,
          name: restaurant.name,
          phone: restaurant.phone,
          minOrder: restaurant.min_order
        }
      : null,
    orders,
    totals
  };
}

/* ------------------------------------------------------------------ */
/*  read                                                               */
/* ------------------------------------------------------------------ */

sessionRoutes.get("/active", (req, res) => {
  const s = db
    .prepare(
      `SELECT id FROM sessions
        WHERE status IN ('OPEN','LOCKED','PLACED')
        ORDER BY created_at DESC LIMIT 1`
    )
    .get();
  res.json(s ? fullSession(s.id) : null);
});

sessionRoutes.get("/", (req, res) => {
  const limit = Math.min(50, int(req.query.limit, 20) || 20);
  const rows = db
    .prepare("SELECT id FROM sessions ORDER BY created_at DESC LIMIT ?")
    .all(limit);
  res.json(rows.map((r) => fullSession(r.id)));
});

sessionRoutes.get("/:id", (req, res) => {
  const s = fullSession(req.params.id);
  if (!s) return res.status(404).json({ error: "not_found" });
  res.json(s);
});

/* ------------------------------------------------------------------ */
/*  lifecycle                                                          */
/* ------------------------------------------------------------------ */

sessionRoutes.post("/", adminRequired, (req, res) => {
  const open = db
    .prepare("SELECT 1 FROM sessions WHERE status IN ('OPEN','LOCKED','PLACED')")
    .get();
  if (open) return res.status(409).json({ error: "session_already_running" });

  const { restaurantId, deliveryFee, splitMode, payerId, roundingStep, cashStep, cutoffAt } =
    req.body || {};

  const r = db.prepare("SELECT * FROM restaurants WHERE id=? AND active=1").get(restaurantId);
  if (!r) return res.status(400).json({ error: "bad_restaurant" });

  const payer = db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(payerId || req.user.id);
  if (!payer) return res.status(400).json({ error: "bad_payer" });

  const id = uid();
  db.prepare(
    `INSERT INTO sessions
       (id,restaurant_id,created_by,payer_id,status,delivery_fee,split_mode,rounding_step,cash_step,cutoff_at)
     VALUES (?,?,?,?,'OPEN',?,?,?,?,?)`
  ).run(
    id, r.id, req.user.id, payer.id,
    deliveryFee != null ? int(deliveryFee) : r.delivery_fee,
    splitMode === "PROPORTIONAL" ? "PROPORTIONAL" : "EQUAL",
    Math.max(1, int(roundingStep, 100) || 100),
    int(cashStep, 0),
    cutoffAt || null
  );

  audit(req.user.id, "session.create", "session", id, { restaurant: r.name });
  broadcast("session");
  res.status(201).json(fullSession(id));
});

const FLOW = {
  OPEN: ["LOCKED", "CANCELLED"],
  LOCKED: ["OPEN", "PLACED", "CANCELLED"],
  PLACED: ["SETTLED", "CANCELLED"],
  SETTLED: [],
  CANCELLED: []
};

sessionRoutes.patch("/:id", adminRequired, (req, res) => {
  const s = db.prepare("SELECT * FROM sessions WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "not_found" });

  const { status, deliveryFee, splitMode, payerId, roundingStep, cashStep } = req.body || {};

  if (status && status !== s.status) {
    if (!FLOW[s.status].includes(status)) {
      return res.status(400).json({ error: "bad_transition", from: s.status, to: status });
    }
    if (status === "PLACED") {
      const approved = db
        .prepare("SELECT COUNT(*) c FROM orders WHERE session_id=? AND status='APPROVED'")
        .get(s.id).c;
      if (approved === 0) return res.status(400).json({ error: "no_approved_orders" });
    }
  }

  db.prepare(
    `UPDATE sessions SET
       status = COALESCE(?, status),
       delivery_fee = COALESCE(?, delivery_fee),
       split_mode = COALESCE(?, split_mode),
       payer_id = COALESCE(?, payer_id),
       rounding_step = COALESCE(?, rounding_step),
       cash_step = COALESCE(?, cash_step)
     WHERE id = ?`
  ).run(
    status || null,
    deliveryFee != null ? int(deliveryFee) : null,
    splitMode === "EQUAL" || splitMode === "PROPORTIONAL" ? splitMode : null,
    payerId || null,
    roundingStep != null ? Math.max(1, int(roundingStep, 100)) : null,
    cashStep != null ? int(cashStep) : null,
    s.id
  );

  audit(req.user.id, "session.update", "session", s.id, { status, deliveryFee, splitMode });
  broadcast("session");
  res.json(fullSession(s.id));
});

sessionRoutes.delete("/:id", adminRequired, (req, res) => {
  const s = db.prepare("SELECT * FROM sessions WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "not_found" });
  db.prepare("DELETE FROM sessions WHERE id=?").run(s.id);
  audit(req.user.id, "session.delete", "session", s.id);
  broadcast("session");
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  my order                                                           */
/* ------------------------------------------------------------------ */

sessionRoutes.put("/:id/my-order", (req, res) => {
  const s = db.prepare("SELECT * FROM sessions WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "not_found" });
  if (s.status !== "OPEN") return res.status(409).json({ error: "session_not_open" });

  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items || items.length === 0) return res.status(400).json({ error: "items_required" });

  // Resolve every line against the live menu. Client-sent prices are ignored.
  const menu = new Map(
    db.prepare("SELECT * FROM menu_items WHERE restaurant_id = ?")
      .all(s.restaurant_id)
      .map((m) => [m.id, m])
  );

  const resolved = [];
  for (const it of items) {
    const m = menu.get(it.menuItemId);
    if (!m) return res.status(400).json({ error: "unknown_item", menuItemId: it.menuItemId });
    if (!m.available) return res.status(400).json({ error: "item_unavailable", name: m.name });
    const qty = int(it.qty, 0);
    if (qty < 1 || qty > 50) return res.status(400).json({ error: "bad_qty" });
    resolved.push({
      menuItemId: m.id,
      name: m.name,
      price: m.price, // snapshot taken here, server-side
      qty,
      note: String(it.note || "").slice(0, 140)
    });
  }

  const autoApprove = req.user.trusted || req.user.role === "ADMIN";

  const tx = db.transaction(() => {
    const existing = db
      .prepare("SELECT * FROM orders WHERE session_id=? AND user_id=?")
      .get(s.id, req.user.id);

    let orderId;
    if (existing) {
      orderId = existing.id;
      db.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId);
      db.prepare(
        `UPDATE orders SET status=?, reason='', updated_at=datetime('now') WHERE id=?`
      ).run(autoApprove ? "APPROVED" : "PENDING", orderId);
    } else {
      orderId = uid();
      db.prepare(
        `INSERT INTO orders (id,session_id,user_id,status) VALUES (?,?,?,?)`
      ).run(orderId, s.id, req.user.id, autoApprove ? "APPROVED" : "PENDING");
    }

    const ins = db.prepare(
      `INSERT INTO order_items
         (id,order_id,menu_item_id,name_snapshot,unit_price_snapshot,qty,note)
       VALUES (?,?,?,?,?,?,?)`
    );
    for (const r of resolved) {
      ins.run(uid(), orderId, r.menuItemId, r.name, r.price, r.qty, r.note);
    }
    return orderId;
  });

  const orderId = tx();
  audit(req.user.id, "order.submit", "order", orderId, { lines: resolved.length });
  broadcast("session");
  res.json(fullSession(s.id));
});

sessionRoutes.delete("/:id/my-order", (req, res) => {
  const s = db.prepare("SELECT * FROM sessions WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "not_found" });
  if (s.status !== "OPEN") return res.status(409).json({ error: "session_not_open" });
  db.prepare("DELETE FROM orders WHERE session_id=? AND user_id=?").run(s.id, req.user.id);
  broadcast("session");
  res.json(fullSession(s.id));
});

sessionRoutes.post("/:id/approve-all", adminRequired, (req, res) => {
  const s = db.prepare("SELECT * FROM sessions WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "not_found" });
  const info = db
    .prepare(
      `UPDATE orders SET status='APPROVED', approved_by=?, approved_at=datetime('now')
        WHERE session_id=? AND status='PENDING'`
    )
    .run(req.user.id, s.id);
  audit(req.user.id, "order.approve_all", "session", s.id, { count: info.changes });
  broadcast("session");
  res.json(fullSession(s.id));
});

/* ------------------------------------------------------------------ */
/*  admin decisions on a single order                                  */
/* ------------------------------------------------------------------ */

orderRoutes.patch("/:id/decision", adminRequired, (req, res) => {
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
  if (!o) return res.status(404).json({ error: "not_found" });
  const { status, reason } = req.body || {};
  if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
    return res.status(400).json({ error: "bad_status" });
  }
  if (status === "REJECTED" && !String(reason || "").trim()) {
    return res.status(400).json({ error: "reason_required" });
  }
  db.prepare(
    `UPDATE orders SET status=?, reason=?, approved_by=?, approved_at=datetime('now'),
       updated_at=datetime('now') WHERE id=?`
  ).run(status, String(reason || "").trim(), req.user.id, o.id);

  audit(req.user.id, "order.decision", "order", o.id, { status, reason });
  broadcast("session");
  res.json(fullSession(o.session_id));
});

orderRoutes.patch("/:id/paid", adminRequired, (req, res) => {
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
  if (!o) return res.status(404).json({ error: "not_found" });
  const paid = req.body?.paid ? 1 : 0;
  db.prepare("UPDATE orders SET paid=?, updated_at=datetime('now') WHERE id=?").run(paid, o.id);
  audit(req.user.id, "order.paid", "order", o.id, { paid: !!paid });
  broadcast("session");
  res.json(fullSession(o.session_id));
});

/* ------------------------------------------------------------------ */
/*  kitchen sheet + balances                                           */
/* ------------------------------------------------------------------ */

sessionRoutes.get("/:id/kitchen-sheet", (req, res) => {
  const s = fullSession(req.params.id);
  if (!s) return res.status(404).json({ error: "not_found" });

  const agg = new Map();
  for (const o of s.orders) {
    if (o.status !== "APPROVED") continue;
    for (const i of o.items) {
      if (!agg.has(i.name)) agg.set(i.name, { qty: 0, notes: [] });
      const e = agg.get(i.name);
      e.qty += i.qty;
      if (i.note) e.notes.push(`${i.note} (${o.userName})`);
    }
  }

  const n = (v) => new Intl.NumberFormat("en-US").format(v);
  const lines = [s.restaurant?.name || "", "─".repeat(24)];
  for (const [name, e] of agg) {
    lines.push(`${e.qty}× ${name}`);
    e.notes.forEach((x) => lines.push(`   • ${x}`));
  }
  lines.push("─".repeat(24));
  lines.push(`Items: ${n(s.totals.itemsTotal)}`);
  lines.push(`Delivery: ${n(s.totals.deliveryFee)}`);
  lines.push(`Total: ${n(s.totals.grandTotal)}`);
  if (s.restaurant?.phone) lines.push(s.restaurant.phone);

  res.json({ text: lines.filter(Boolean).join("\n") });
});

/**
 * Running balances. A debt exists from the moment the food is ordered,
 * so LOCKED / PLACED / SETTLED sessions all count. Positive = others owe them.
 */
export function balancesHandler(req, res) {
  const rows = db
    .prepare("SELECT * FROM sessions WHERE status IN ('LOCKED','PLACED','SETTLED')")
    .all();

  const bal = new Map();
  const bump = (id, v) => bal.set(id, (bal.get(id) || 0) + v);

  for (const s of rows) {
    const { orders } = computeSession(s, loadOrders(s.id));
    for (const o of orders) {
      if (!o.counted || o.paid || o.userId === s.payer_id) continue;
      bump(o.userId, -o.due);
      bump(s.payer_id, o.due);
    }
  }

  const users = db.prepare("SELECT id,name FROM users WHERE active=1").all();
  res.json(
    users
      .map((u) => ({ userId: u.id, name: u.name, balance: bal.get(u.id) || 0 }))
      .filter((x) => x.balance !== 0)
      .sort((a, b) => b.balance - a.balance)
  );
}
