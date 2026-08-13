import { Router } from "express";
import express from "express";
import fs from "node:fs";
import { db, uid, audit } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";
import { broadcast } from "../events.js";
import { parseMenu } from "../menu-parse.js";
import { buildExport, validateImport } from "../menu-io.js";
import {
  MAX_UPLOAD_BYTES, ALLOWED_MIMES, sniffImage, storedName, uploadPath, cleanOriginalName
} from "../uploads.js";

export const restaurantRoutes = Router();
export const photoRoutes = Router();
restaurantRoutes.use(authRequired);
photoRoutes.use(authRequired);

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

/* ------------------------------------------------------------------ */
/*  import / export                                                    */
/* ------------------------------------------------------------------ */

/*
 * The export is the menu backup and the transport format in one. Anyone can
 * pull it — it is the same menu they can already read in the app — but only an
 * admin can push one back.
 */
restaurantRoutes.get("/:id/export", (req, res) => {
  const r = db.prepare("SELECT * FROM restaurants WHERE id=?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });

  const items = db
    .prepare("SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY sort_order, rowid")
    .all(r.id);

  const payload = buildExport(r, items);

  /*
   * A filename the admin can find again: the restaurant, the date it was taken.
   *
   * Content-Disposition is a Latin-1 header, so an Arabic restaurant name
   * cannot go in it directly — Node rejects the whole response. RFC 5987 is
   * the way out: a stripped ASCII `filename` that any client can read, plus a
   * percent-encoded UTF-8 `filename*` that real browsers prefer, which is what
   * keeps "مطعم الشام" on the downloaded file.
   */
  const stamp = new Date().toISOString().slice(0, 10);
  const pretty = `${r.name.trim().replace(/\s+/g, "-")}-${stamp}.json`;
  const ascii =
    (r.name.replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "").trim().replace(/\s+/g, "-") || "menu") +
    `-${stamp}.json`;
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(pretty)}`
  );
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(payload, null, 2));
});

/*
 * Import. Creates a restaurant or replaces an existing one's menu.
 *
 * `restaurantId` targets an existing restaurant explicitly; without it we match
 * on name, and failing that create a new one. `dryRun` validates and reports
 * without writing, which is what the preview screen uses.
 */
restaurantRoutes.post("/import", adminRequired, (req, res) => {
  const { ok, error, restaurant, items, rejected } = validateImport(req.body?.menu ?? req.body);
  if (!ok) return res.status(400).json({ error, rejected });

  const dryRun = req.body?.dryRun === true;
  const targetId = req.body?.restaurantId;

  let target = targetId
    ? db.prepare("SELECT * FROM restaurants WHERE id=?").get(targetId)
    : db.prepare("SELECT * FROM restaurants WHERE name=? COLLATE NOCASE AND active=1").get(restaurant.name);

  if (targetId && !target) return res.status(404).json({ error: "not_found" });

  if (dryRun) {
    return res.json({
      dryRun: true,
      wouldCreate: !target,
      restaurantId: target?.id ?? null,
      restaurantName: restaurant.name,
      imported: items.length,
      replacing: target
        ? db.prepare("SELECT COUNT(*) c FROM menu_items WHERE restaurant_id=?").get(target.id).c
        : 0,
      rejected
    });
  }

  const created = !target;
  const tx = db.transaction(() => {
    let id;
    if (target) {
      id = target.id;
      db.prepare(
        `UPDATE restaurants SET name=?, phone=?, delivery_fee=?, min_order=? WHERE id=?`
      ).run(restaurant.name, restaurant.phone, restaurant.deliveryFee, restaurant.minOrder, id);
    } else {
      id = uid();
      db.prepare(
        `INSERT INTO restaurants (id,name,phone,delivery_fee,min_order) VALUES (?,?,?,?,?)`
      ).run(id, restaurant.name, restaurant.phone, restaurant.deliveryFee, restaurant.minOrder);
    }

    db.prepare("DELETE FROM menu_items WHERE restaurant_id = ?").run(id);
    const ins = db.prepare(
      `INSERT INTO menu_items (id,restaurant_id,name,price,category,available,sort_order)
       VALUES (?,?,?,?,?,?,?)`
    );
    items.forEach((it, i) =>
      ins.run(uid(), id, it.name, it.price, it.category, it.available ? 1 : 0, i)
    );
    db.prepare("UPDATE restaurants SET menu_updated_at = datetime('now') WHERE id = ?").run(id);
    return id;
  });

  const id = tx();
  audit(req.user.id, created ? "menu.import_create" : "menu.import_replace", "restaurant", id, {
    name: restaurant.name, imported: items.length, rejected: rejected.length
  });
  broadcast("restaurants");

  res.status(created ? 201 : 200).json({
    created,
    imported: items.length,
    rejected,
    restaurant: shape(db.prepare("SELECT * FROM restaurants WHERE id=?").get(id))
  });
});

/*
 * Preview a pasted menu. Pure parse, writes nothing — the admin corrects the
 * rows on screen and saves through the normal menu route.
 */
restaurantRoutes.post("/parse-menu", adminRequired, (req, res) => {
  const text = String(req.body?.text ?? "");
  if (!text.trim()) return res.status(400).json({ error: "text_required" });
  if (text.length > 200_000) return res.status(400).json({ error: "text_too_large" });
  res.json(parseMenu(text));
});

/* ------------------------------------------------------------------ */
/*  menu photos                                                        */
/* ------------------------------------------------------------------ */

const photoShape = (p) => ({
  id: p.id,
  restaurantId: p.restaurant_id,
  originalName: p.original_name,
  mime: p.mime,
  bytes: p.bytes,
  createdAt: p.created_at
});

restaurantRoutes.get("/:id/photos", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM restaurant_photos WHERE restaurant_id=? ORDER BY created_at")
    .all(req.params.id);
  res.json(rows.map(photoShape));
});

/*
 * Upload. The body is the raw image — no multipart, which keeps a parser
 * dependency out of an air-gapped deployment. The client sends the bytes with
 * the real Content-Type and the display name in X-Filename.
 */
restaurantRoutes.post(
  "/:id/photos",
  adminRequired,
  express.raw({ type: ALLOWED_MIMES, limit: MAX_UPLOAD_BYTES }),
  (req, res) => {
    const r = db.prepare("SELECT * FROM restaurants WHERE id=?").get(req.params.id);
    if (!r) return res.status(404).json({ error: "not_found" });

    /*
     * express.raw only fills req.body for the types it was told to parse, so a
     * PDF arrives as an empty object rather than a Buffer. Say "wrong type"
     * instead of "empty file" — they are different mistakes.
     */
    const declared = (req.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_MIMES.includes(declared)) {
      return res.status(415).json({ error: "unsupported_image_type", allowed: ALLOWED_MIMES });
    }

    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: "empty_upload" });
    }

    // Trust the bytes, not the header.
    const kind = sniffImage(body);
    if (!kind) return res.status(415).json({ error: "unsupported_image_type" });

    const id = uid();
    const name = storedName(id, kind.ext);
    fs.writeFileSync(uploadPath(name), body);

    db.prepare(
      `INSERT INTO restaurant_photos
         (id,restaurant_id,stored_name,original_name,mime,bytes,uploaded_by)
       VALUES (?,?,?,?,?,?,?)`
    ).run(id, r.id, name, cleanOriginalName(req.get("X-Filename")), kind.mime, body.length, req.user.id);

    audit(req.user.id, "photo.upload", "restaurant", r.id, { photoId: id, bytes: body.length });
    broadcast("restaurants");
    res.status(201).json(photoShape(db.prepare("SELECT * FROM restaurant_photos WHERE id=?").get(id)));
  }
);

/* Served through the API so the file is behind the same auth as everything
   else. `uploads/` is never exposed as a static directory. */
photoRoutes.get("/:id", (req, res) => {
  const p = db.prepare("SELECT * FROM restaurant_photos WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "not_found" });

  let full;
  try {
    full = uploadPath(p.stored_name);
  } catch {
    return res.status(500).json({ error: "bad_stored_name" });
  }
  if (!fs.existsSync(full)) return res.status(404).json({ error: "file_missing" });

  res.setHeader("Content-Type", p.mime);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  fs.createReadStream(full).pipe(res);
});

photoRoutes.delete("/:id", adminRequired, (req, res) => {
  const p = db.prepare("SELECT * FROM restaurant_photos WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "not_found" });

  try {
    fs.rmSync(uploadPath(p.stored_name), { force: true });
  } catch (e) {
    // The row is the source of truth; a file we cannot remove is a warning,
    // not a reason to leave a dangling record.
    console.warn("[photos] could not delete file:", e.message);
  }
  db.prepare("DELETE FROM restaurant_photos WHERE id=?").run(p.id);
  audit(req.user.id, "photo.delete", "restaurant", p.restaurant_id, { photoId: p.id });
  broadcast("restaurants");
  res.json({ ok: true });
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
