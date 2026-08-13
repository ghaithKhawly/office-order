import { Router } from "express";
import { db, uid, audit } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";
import { broadcast } from "../events.js";

export const restaurantRoutes = Router();
restaurantRoutes.use(authRequired);

const int = (v, d = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : d;
};

function shape(r) {
  const menu = db
    .prepare("SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY sort_order, rowid")
    .all(r.id)
    .map((m) => ({
      id: m.id,
      name: m.name,
      price: m.price,
      category: m.category,
      available: !!m.available
    }));
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    deliveryFee: r.delivery_fee,
    minOrder: r.min_order,
    menuUpdatedAt: r.menu_updated_at,
    menu
  };
}

restaurantRoutes.get("/", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM restaurants WHERE active = 1 ORDER BY name COLLATE NOCASE")
    .all();
  res.json(rows.map(shape));
});

restaurantRoutes.post("/", adminRequired, (req, res) => {
  const { name, phone, deliveryFee, minOrder } = req.body || {};
  const n = String(name || "").trim();
  if (!n) return res.status(400).json({ error: "name_required" });
  const id = uid();
  db.prepare(
    `INSERT INTO restaurants (id,name,phone,delivery_fee,min_order)
     VALUES (?,?,?,?,?)`
  ).run(id, n, String(phone || "").trim(), int(deliveryFee), int(minOrder));
  audit(req.user.id, "restaurant.create", "restaurant", id, { name: n });
  broadcast("restaurants");
  res.status(201).json(shape(db.prepare("SELECT * FROM restaurants WHERE id=?").get(id)));
});

restaurantRoutes.patch("/:id", adminRequired, (req, res) => {
  const r = db.prepare("SELECT * FROM restaurants WHERE id=?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });
  const { name, phone, deliveryFee, minOrder } = req.body || {};
  db.prepare(
    `UPDATE restaurants SET
       name = COALESCE(?, name),
       phone = COALESCE(?, phone),
       delivery_fee = COALESCE(?, delivery_fee),
       min_order = COALESCE(?, min_order)
     WHERE id = ?`
  ).run(
    name != null ? String(name).trim() : null,
    phone != null ? String(phone).trim() : null,
    deliveryFee != null ? int(deliveryFee) : null,
    minOrder != null ? int(minOrder) : null,
    r.id
  );
  audit(req.user.id, "restaurant.update", "restaurant", r.id);
  broadcast("restaurants");
  res.json(shape(db.prepare("SELECT * FROM restaurants WHERE id=?").get(r.id)));
});

// Soft delete — historical sessions still reference this restaurant.
restaurantRoutes.delete("/:id", adminRequired, (req, res) => {
  const r = db.prepare("SELECT * FROM restaurants WHERE id=?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });
  const inUse = db
    .prepare("SELECT 1 FROM sessions WHERE restaurant_id=? AND status IN ('OPEN','LOCKED','PLACED')")
    .get(r.id);
  if (inUse) return res.status(400).json({ error: "restaurant_in_active_session" });
  db.prepare("UPDATE restaurants SET active = 0 WHERE id = ?").run(r.id);
  audit(req.user.id, "restaurant.archive", "restaurant", r.id);
  broadcast("restaurants");
  res.json({ ok: true });
});

/**
 * Replace the whole menu in one transaction.
 * Item ids are preserved when sent, so "repeat my last order" keeps working.
 */
restaurantRoutes.put("/:id/menu", adminRequired, (req, res) => {
  const r = db.prepare("SELECT * FROM restaurants WHERE id=?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });

  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: "items_array_required" });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM menu_items WHERE restaurant_id = ?").run(r.id);
    const ins = db.prepare(
      `INSERT INTO menu_items (id,restaurant_id,name,price,category,available,sort_order)
       VALUES (?,?,?,?,?,?,?)`
    );
    items.forEach((it, i) => {
      const name = String(it.name || "").trim();
      if (!name) return;
      ins.run(
        it.id || uid(), r.id, name, int(it.price),
        String(it.category || "").trim(),
        it.available === false ? 0 : 1, i
      );
    });
    db.prepare("UPDATE restaurants SET menu_updated_at = datetime('now') WHERE id = ?").run(r.id);
  });
  tx();

  audit(req.user.id, "menu.replace", "restaurant", r.id, { count: items.length });
  broadcast("restaurants");
  res.json(shape(db.prepare("SELECT * FROM restaurants WHERE id=?").get(r.id)));
});

// Bulk inflation adjustment: PATCH /:id/menu/adjust { percent: 10 }
restaurantRoutes.patch("/:id/menu/adjust", adminRequired, (req, res) => {
  const r = db.prepare("SELECT * FROM restaurants WHERE id=?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });
  const pct = Number(req.body?.percent);
  if (!Number.isFinite(pct) || pct === 0) return res.status(400).json({ error: "bad_percent" });

  db.transaction(() => {
    db.prepare(
      "UPDATE menu_items SET price = CAST(ROUND(price * ?) AS INTEGER) WHERE restaurant_id = ?"
    ).run(1 + pct / 100, r.id);
    db.prepare("UPDATE restaurants SET menu_updated_at = datetime('now') WHERE id = ?").run(r.id);
  })();

  audit(req.user.id, "menu.adjust", "restaurant", r.id, { percent: pct });
  broadcast("restaurants");
  res.json(shape(db.prepare("SELECT * FROM restaurants WHERE id=?").get(r.id)));
});
