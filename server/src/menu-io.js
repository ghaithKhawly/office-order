/*
 * Menu import/export.
 *
 * One versioned JSON shape does three jobs: it is the menu backup, the way a
 * menu transcribed on another machine gets in, and the format the paste parser
 * feeds once the admin has checked the preview.
 *
 * Validation is strict but per-row: one malformed line in a 40-item file must
 * not cost the admin the other 39. Bad rows come back with their index and a
 * reason; good rows import.
 */

export const MENU_FORMAT = "office-order.menu";
export const MENU_FORMAT_VERSION = 1;

const MAX_NAME = 120;
const MAX_CATEGORY = 60;
const MAX_ITEMS = 2000;
/* Prices are whole units and this is an office lunch, not a car auction.
   A ceiling catches a misplaced paste far more often than it blocks a real price. */
const MAX_PRICE = 100_000_000;

export function buildExport(restaurant, items) {
  return {
    format: MENU_FORMAT,
    version: MENU_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    restaurant: {
      name: restaurant.name,
      phone: restaurant.phone,
      deliveryFee: restaurant.delivery_fee,
      minOrder: restaurant.min_order
    },
    items: items.map((m) => ({
      name: m.name,
      price: m.price,
      category: m.category,
      available: !!m.available
    }))
  };
}

/**
 * Validate a parsed JSON payload.
 *
 * @returns {{ ok:boolean, error?:string, restaurant?:object,
 *             items:Array, rejected:Array<{row:number,name:string,error:string}> }}
 *
 * `ok:false` means the envelope itself is wrong and nothing can be imported.
 * `ok:true` with entries in `rejected` means some rows were dropped — the
 * caller imports `items` and reports `rejected` to the admin.
 */
export function validateImport(payload) {
  const rejected = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "not_an_object", items: [], rejected };
  }
  if (payload.format !== MENU_FORMAT) {
    return { ok: false, error: "bad_format", items: [], rejected };
  }
  if (!Number.isInteger(payload.version) || payload.version < 1) {
    return { ok: false, error: "bad_version", items: [], rejected };
  }
  if (payload.version > MENU_FORMAT_VERSION) {
    // Forward compatibility is a promise we cannot keep offline: a newer file
    // may use fields this build has never heard of.
    return { ok: false, error: "version_too_new", items: [], rejected };
  }
  if (!Array.isArray(payload.items)) {
    return { ok: false, error: "items_array_required", items: [], rejected };
  }
  if (payload.items.length > MAX_ITEMS) {
    return { ok: false, error: "too_many_items", items: [], rejected };
  }

  const r = payload.restaurant;
  if (!r || typeof r !== "object" || !String(r.name || "").trim()) {
    return { ok: false, error: "restaurant_name_required", items: [], rejected };
  }

  const restaurant = {
    name: String(r.name).trim().slice(0, MAX_NAME),
    phone: String(r.phone || "").trim().slice(0, 40),
    deliveryFee: safeInt(r.deliveryFee),
    minOrder: safeInt(r.minOrder)
  };

  const items = [];
  payload.items.forEach((raw, i) => {
    const row = i + 1;
    const reject = (error) =>
      rejected.push({ row, name: String(raw?.name ?? "").slice(0, MAX_NAME), error });

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("not_an_object");

    const name = String(raw.name ?? "").trim();
    if (!name) return reject("name_required");
    if (name.length > MAX_NAME) return reject("name_too_long");

    // Money is INTEGER everywhere. A float here would be the one place a
    // fraction of a pound could enter the system, so reject rather than round.
    const price = raw.price ?? 0;
    if (typeof price !== "number" || !Number.isFinite(price)) return reject("price_not_a_number");
    if (!Number.isInteger(price)) return reject("price_not_an_integer");
    if (price < 0) return reject("price_negative");
    if (price > MAX_PRICE) return reject("price_too_large");

    const category = String(raw.category ?? "").trim();
    if (category.length > MAX_CATEGORY) return reject("category_too_long");

    if (raw.available != null && typeof raw.available !== "boolean") {
      return reject("available_not_a_boolean");
    }

    items.push({
      name,
      price,
      category,
      available: raw.available !== false
    });
  });

  return { ok: true, restaurant, items, rejected };
}

function safeInt(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
