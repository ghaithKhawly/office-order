/*
 * API integration.
 *
 * These run against a real server on a throwaway database. They cover the
 * promises the app makes that are expensive to break and easy to break
 * silently: that a client cannot set its own prices, that admin routes are
 * actually admin-only, that a locked session is locked, that the state machine
 * refuses nonsense, and — the one that matters most — that editing a menu
 * never rewrites what a past session cost.
 */
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/server.js";

let S;          // the running server
let admin;      // { token, user }
let api;

before(async () => {
  S = await startTestServer();
  api = S.api;
  admin = S.admin;
});

after(async () => { await S?.stop(); });

/** A restaurant with a two-item menu, returned in API shape. */
async function makeRestaurant(name = "مطعم الاختبار", items) {
  const r = await api.post("/restaurants",
    { name, phone: "011", deliveryFee: 5000, minOrder: 0 }, admin.token);
  assert.equal(r.status, 201);

  const menu = items || [
    { name: "شيش طاووق", price: 15000, category: "المشاوي" },
    { name: "حمص", price: 5000, category: "المقبلات" }
  ];
  const saved = await api.put(`/restaurants/${r.data.id}/menu`, { items: menu }, admin.token);
  assert.equal(saved.status, 200);
  return saved.data;
}

/** Clear whatever session is running so each test starts from a known place. */
async function clearSession() {
  const active = await api.get("/sessions/active", admin.token);
  if (active.data) await api.del(`/sessions/${active.data.id}`, admin.token);
}

async function startSession(restaurantId, over = {}) {
  await clearSession();
  const r = await api.post("/sessions", {
    restaurantId, deliveryFee: 5000, splitMode: "EQUAL",
    payerId: admin.user.id, roundingStep: 100, cashStep: 0, ...over
  }, admin.token);
  assert.equal(r.status, 201, `could not start session: ${JSON.stringify(r.data)}`);
  return r.data;
}

/* ------------------------------------------------------------------ */

describe("price tampering", () => {
  test("a client-supplied price is ignored; the server snapshots the menu price", async () => {
    const rest = await makeRestaurant();
    const session = await startSession(rest.id);
    const item = rest.menu[0];   // 15,000

    const res = await api.put(`/sessions/${session.id}/my-order`, {
      items: [{
        menuItemId: item.id,
        qty: 2,
        // Everything a hostile client might try.
        price: 1,
        unitPrice: 1,
        unit_price_snapshot: 1,
        name: "free lunch"
      }]
    }, admin.token);

    assert.equal(res.status, 200);
    const mine = res.data.orders.find((o) => o.userId === admin.user.id);
    assert.equal(mine.items[0].unitPrice, 15000, "the live menu price must win");
    assert.equal(mine.items[0].name, "شيش طاووق", "the name is snapshotted server-side too");
    assert.equal(mine.subtotal, 30000, "2 x 15,000");
  });

  test("a negative or absurd quantity is rejected", async () => {
    const rest = await makeRestaurant("qty checks");
    const session = await startSession(rest.id);
    for (const qty of [0, -1, -100, 51, 9999]) {
      const res = await api.put(`/sessions/${session.id}/my-order`,
        { items: [{ menuItemId: rest.menu[0].id, qty }] }, admin.token);
      assert.equal(res.status, 400, `qty ${qty} should be rejected`);
      assert.equal(res.data.error, "bad_qty");
    }
  });

  test("an item from another restaurant cannot be ordered", async () => {
    const a = await makeRestaurant("restaurant A");
    const b = await makeRestaurant("restaurant B");
    const session = await startSession(a.id);

    const res = await api.put(`/sessions/${session.id}/my-order`,
      { items: [{ menuItemId: b.menu[0].id, qty: 1 }] }, admin.token);
    assert.equal(res.status, 400);
    assert.equal(res.data.error, "unknown_item");
  });
});

/* ------------------------------------------------------------------ */

describe("authorisation", () => {
  test("non-admins get 403 on admin routes", async () => {
    const rest = await makeRestaurant("perm checks");
    const member = await api.createMember(admin.token, { username: "member1", name: "Member One" });

    const forbidden = [
      ["POST", "/restaurants", { name: "nope" }],
      ["PATCH", `/restaurants/${rest.id}`, { name: "renamed" }],
      ["DELETE", `/restaurants/${rest.id}`, undefined],
      ["PUT", `/restaurants/${rest.id}/menu`, { items: [] }],
      ["PATCH", `/restaurants/${rest.id}/menu/adjust`, { percent: 10 }],
      ["POST", "/restaurants/import", { format: "office-order.menu", version: 1, restaurant: { name: "x" }, items: [] }],
      ["POST", "/restaurants/parse-menu", { text: "x — 1" }],
      ["POST", "/users", { username: "sneaky", name: "Sneaky" }],
      ["PATCH", `/users/${admin.user.id}`, { role: "MEMBER" }],
      ["GET", "/admin/health", undefined],
      ["GET", "/admin/backups", undefined],
      ["POST", "/admin/backups", undefined],
      ["GET", "/admin/backups/download", undefined],
      ["GET", "/board-admin", undefined],
      ["POST", "/board-admin/rotate", undefined]
    ];

    for (const [method, path, body] of forbidden) {
      const res = await api.call(method, path, { token: member.token, body });
      assert.equal(res.status, 403, `${method} ${path} should be 403 for a member, got ${res.status}`);
      assert.equal(res.data.error, "admin_only");
    }
  });

  test("session lifecycle routes are admin-only", async () => {
    const rest = await makeRestaurant("session perms");
    const session = await startSession(rest.id);
    const member = await api.createMember(admin.token, { username: "member2", name: "Member Two" });

    const forbidden = [
      ["POST", "/sessions", { restaurantId: rest.id }],
      ["PATCH", `/sessions/${session.id}`, { status: "LOCKED" }],
      ["DELETE", `/sessions/${session.id}`, undefined],
      ["POST", `/sessions/${session.id}/approve-all`, undefined]
    ];
    for (const [method, path, body] of forbidden) {
      const res = await api.call(method, path, { token: member.token, body });
      assert.equal(res.status, 403, `${method} ${path} should be 403`);
    }
  });

  test("no token at all is 401, not 403", async () => {
    for (const path of ["/users", "/restaurants", "/sessions/active", "/admin/health", "/balances"]) {
      const res = await api.get(path);
      assert.equal(res.status, 401, `${path} without a token should be 401`);
      assert.equal(res.data.error, "auth_required");
    }
  });

  test("a member can still read, and can place their own order", async () => {
    const rest = await makeRestaurant("member reads");
    const session = await startSession(rest.id);
    const member = await api.createMember(admin.token, { username: "member3", name: "Member Three" });

    assert.equal((await api.get("/restaurants", member.token)).status, 200);
    assert.equal((await api.get("/sessions/active", member.token)).status, 200);
    assert.equal((await api.get(`/restaurants/${rest.id}/export`, member.token)).status, 200);

    const res = await api.put(`/sessions/${session.id}/my-order`,
      { items: [{ menuItemId: rest.menu[0].id, qty: 1 }] }, member.token);
    assert.equal(res.status, 200);
  });

  test("the last admin cannot demote themselves out of existence", async () => {
    const res = await api.patch(`/users/${admin.user.id}`, { role: "MEMBER" }, admin.token);
    assert.equal(res.status, 400);
    assert.equal(res.data.error, "last_admin");
  });
});

/* ------------------------------------------------------------------ */

describe("session state machine", () => {
  test("orders are rejected once the session locks", async () => {
    const rest = await makeRestaurant("lock checks");
    const session = await startSession(rest.id);

    const first = await api.put(`/sessions/${session.id}/my-order`,
      { items: [{ menuItemId: rest.menu[0].id, qty: 1 }] }, admin.token);
    assert.equal(first.status, 200, "ordering while OPEN works");

    const locked = await api.patch(`/sessions/${session.id}`, { status: "LOCKED" }, admin.token);
    assert.equal(locked.status, 200);
    assert.equal(locked.data.status, "LOCKED");

    const after = await api.put(`/sessions/${session.id}/my-order`,
      { items: [{ menuItemId: rest.menu[0].id, qty: 5 }] }, admin.token);
    assert.equal(after.status, 409);
    assert.equal(after.data.error, "session_not_open");

    // Withdrawing is blocked too — the order has gone to the restaurant.
    const withdrawn = await api.del(`/sessions/${session.id}/my-order`, admin.token);
    assert.equal(withdrawn.status, 409);
    assert.equal(withdrawn.data.error, "session_not_open");
  });

  test("invalid transitions are rejected", async () => {
    const rest = await makeRestaurant("transitions");
    const session = await startSession(rest.id);

    // OPEN -> PLACED skips LOCKED
    let res = await api.patch(`/sessions/${session.id}`, { status: "PLACED" }, admin.token);
    assert.equal(res.status, 400);
    assert.equal(res.data.error, "bad_transition");

    // OPEN -> SETTLED is nonsense
    res = await api.patch(`/sessions/${session.id}`, { status: "SETTLED" }, admin.token);
    assert.equal(res.status, 400);
    assert.equal(res.data.error, "bad_transition");

    // A terminal state stays terminal.
    await api.patch(`/sessions/${session.id}`, { status: "CANCELLED" }, admin.token);
    res = await api.patch(`/sessions/${session.id}`, { status: "OPEN" }, admin.token);
    assert.equal(res.status, 400);
    assert.equal(res.data.error, "bad_transition");
  });

  test("a session cannot be placed with no approved orders", async () => {
    const rest = await makeRestaurant("no approvals");
    const session = await startSession(rest.id);
    await api.patch(`/sessions/${session.id}`, { status: "LOCKED" }, admin.token);

    const res = await api.patch(`/sessions/${session.id}`, { status: "PLACED" }, admin.token);
    assert.equal(res.status, 400);
    assert.equal(res.data.error, "no_approved_orders");
  });

  test("only one session runs at a time", async () => {
    const rest = await makeRestaurant("one at a time");
    await startSession(rest.id);
    const second = await api.post("/sessions", {
      restaurantId: rest.id, deliveryFee: 1000, splitMode: "EQUAL",
      payerId: admin.user.id, roundingStep: 100, cashStep: 0
    }, admin.token);
    assert.equal(second.status, 409);
    assert.equal(second.data.error, "session_already_running");
  });

  test("an admin can reopen a locked session", async () => {
    const rest = await makeRestaurant("reopen");
    const session = await startSession(rest.id);
    await api.patch(`/sessions/${session.id}`, { status: "LOCKED" }, admin.token);

    const reopened = await api.patch(`/sessions/${session.id}`, { status: "OPEN" }, admin.token);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.data.status, "OPEN");

    const res = await api.put(`/sessions/${session.id}/my-order`,
      { items: [{ menuItemId: rest.menu[0].id, qty: 1 }] }, admin.token);
    assert.equal(res.status, 200, "ordering works again after reopening");
  });
});

/* ------------------------------------------------------------------ */

describe("price snapshotting across a menu edit", () => {
  test("changing a menu price does not move a past session's totals", async () => {
    const rest = await makeRestaurant("history");
    const item = rest.menu[0];               // 15,000
    const session = await startSession(rest.id, { deliveryFee: 3000 });

    await api.put(`/sessions/${session.id}/my-order`,
      { items: [{ menuItemId: item.id, qty: 2 }] }, admin.token);

    // Settle it so it is unambiguously history.
    await api.patch(`/sessions/${session.id}`, { status: "LOCKED" }, admin.token);
    await api.patch(`/sessions/${session.id}`, { status: "PLACED" }, admin.token);
    await api.patch(`/sessions/${session.id}`, { status: "SETTLED" }, admin.token);

    const before = await api.get(`/sessions/${session.id}`, admin.token);
    assert.equal(before.data.totals.itemsTotal, 30000);
    assert.equal(before.data.totals.grandTotal, 33000);

    // Now put the prices up, the way an admin would after an inflation jump.
    const bumped = await api.patch(`/restaurants/${rest.id}/menu/adjust`, { percent: 100 }, admin.token);
    assert.equal(bumped.status, 200);
    assert.equal(bumped.data.menu.find((m) => m.id === item.id).price, 30000, "the live menu did change");

    const after = await api.get(`/sessions/${session.id}`, admin.token);
    assert.equal(after.data.totals.itemsTotal, 30000, "the settled session must not move");
    assert.equal(after.data.totals.grandTotal, 33000);
    assert.equal(after.data.orders[0].items[0].unitPrice, 15000, "the snapshot is what was paid");
  });

  test("replacing the whole menu does not disturb history either", async () => {
    const rest = await makeRestaurant("menu replaced");
    const session = await startSession(rest.id, { deliveryFee: 1000 });
    await api.put(`/sessions/${session.id}/my-order`,
      { items: [{ menuItemId: rest.menu[0].id, qty: 1 }] }, admin.token);
    await api.patch(`/sessions/${session.id}`, { status: "LOCKED" }, admin.token);

    const before = (await api.get(`/sessions/${session.id}`, admin.token)).data.totals.itemsTotal;

    // Wipe the menu entirely — the items the order referenced no longer exist.
    await api.put(`/restaurants/${rest.id}/menu`,
      { items: [{ name: "something else", price: 999, category: "" }] }, admin.token);

    const after = await api.get(`/sessions/${session.id}`, admin.token);
    assert.equal(after.data.totals.itemsTotal, before, "totals survive the menu being replaced");
    assert.equal(after.data.orders[0].items[0].name, "شيش طاووق", "the name snapshot survives too");
  });

  test("an import that replaces the menu leaves past totals alone", async () => {
    const rest = await makeRestaurant("import history");
    const session = await startSession(rest.id, { deliveryFee: 2000 });
    await api.put(`/sessions/${session.id}/my-order`,
      { items: [{ menuItemId: rest.menu[0].id, qty: 3 }] }, admin.token);
    await api.patch(`/sessions/${session.id}`, { status: "LOCKED" }, admin.token);
    const before = (await api.get(`/sessions/${session.id}`, admin.token)).data.totals;

    const res = await api.post("/restaurants/import", {
      format: "office-order.menu", version: 1,
      restaurantId: rest.id,
      restaurant: { name: "import history", phone: "", deliveryFee: 5000, minOrder: 0 },
      items: [{ name: "brand new", price: 111, category: "" }]
    }, admin.token);
    assert.equal(res.status, 200);

    const after = (await api.get(`/sessions/${session.id}`, admin.token)).data.totals;
    assert.deepEqual(after, before);
  });
});

/* ------------------------------------------------------------------ */

describe("menu import validation", () => {
  test("a bad envelope is refused outright", async () => {
    const cases = [
      [{ format: "something-else", version: 1, restaurant: { name: "x" }, items: [] }, "bad_format"],
      [{ format: "office-order.menu", version: 99, restaurant: { name: "x" }, items: [] }, "version_too_new"],
      [{ format: "office-order.menu", version: 1, restaurant: {}, items: [] }, "restaurant_name_required"],
      [{ format: "office-order.menu", version: 1, restaurant: { name: "x" }, items: "nope" }, "items_array_required"]
    ];
    for (const [body, expected] of cases) {
      const res = await api.post("/restaurants/import", body, admin.token);
      assert.equal(res.status, 400);
      assert.equal(res.data.error, expected);
    }
  });

  test("bad rows are reported individually; the good ones still import", async () => {
    const res = await api.post("/restaurants/import", {
      format: "office-order.menu", version: 1,
      restaurant: { name: "per-row errors", phone: "", deliveryFee: 0, minOrder: 0 },
      items: [
        { name: "good one", price: 10000 },
        { name: "", price: 5000 },
        { name: "fractional", price: 12.5 },
        { name: "negative", price: -100 },
        { name: "string price", price: "5000" },
        { name: "good two", price: 7000 },
        { name: "bad available", price: 100, available: "yes" }
      ]
    }, admin.token);

    assert.equal(res.status, 201);
    assert.equal(res.data.imported, 2, "the two valid rows import");
    assert.equal(res.data.rejected.length, 5);
    assert.deepEqual(res.data.rejected.map((r) => r.error), [
      "name_required", "price_not_an_integer", "price_negative",
      "price_not_a_number", "available_not_a_boolean"
    ]);
    assert.equal(res.data.restaurant.menu.length, 2);
  });

  test("dryRun validates without writing anything", async () => {
    const body = {
      format: "office-order.menu", version: 1,
      restaurant: { name: "dry run only", phone: "", deliveryFee: 0, minOrder: 0 },
      items: [{ name: "x", price: 1000 }]
    };
    const dry = await api.post("/restaurants/import", { ...body, dryRun: true }, admin.token);
    assert.equal(dry.status, 200);
    assert.equal(dry.data.dryRun, true);
    assert.equal(dry.data.wouldCreate, true);

    const all = await api.get("/restaurants", admin.token);
    assert.equal(all.data.filter((r) => r.name === "dry run only").length, 0,
      "a dry run must not create a restaurant");
  });
});

/* ------------------------------------------------------------------ */

describe("the wall display", () => {
  test("the board needs its token and shows no per-person money", async () => {
    const rest = await makeRestaurant("board test");
    const session = await startSession(rest.id, { deliveryFee: 4000 });
    const member = await api.createMember(admin.token, { username: "boardguy", name: "Board Guy" });
    await api.put(`/sessions/${session.id}/my-order`,
      { items: [{ menuItemId: rest.menu[0].id, qty: 1 }] }, member.token);

    assert.equal((await api.get("/board")).status, 401);
    assert.equal((await api.get("/board?token=wrong")).status, 401);

    const info = await api.get("/board-admin", admin.token);
    assert.equal(info.status, 200);

    const board = await api.get(`/board?token=${encodeURIComponent(info.data.token)}`);
    assert.equal(board.status, 200);
    assert.equal(board.data.session.restaurant.name, "board test");

    const names = board.data.session.ordered.map((p) => p.name);
    assert.ok(names.includes("Board Guy"), "whoever ordered is listed");
    assert.ok(board.data.session.waiting.some((p) => p.name === "Test Admin"),
      "whoever has not ordered is listed too");

    // The point of the board: totals, never individual debts.
    const asText = JSON.stringify(board.data);
    for (const leak of ["due", "subtotal", "balance", "owes", "paid"]) {
      assert.ok(!asText.includes(`"${leak}"`), `board payload must not contain "${leak}"`);
    }
  });

  test("rotating the token invalidates the old link", async () => {
    const before = (await api.get("/board-admin", admin.token)).data.token;
    assert.equal((await api.get(`/board?token=${encodeURIComponent(before)}`)).status, 200);

    const rotated = await api.post("/board-admin/rotate", undefined, admin.token);
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.data.token, before);

    assert.equal((await api.get(`/board?token=${encodeURIComponent(before)}`)).status, 401,
      "the old link must stop working");
    assert.equal((await api.get(`/board?token=${encodeURIComponent(rotated.data.token)}`)).status, 200);
  });
});

/* ------------------------------------------------------------------ */

describe("backups", () => {
  test("a snapshot is a valid database containing data still in the WAL", async () => {
    // Write through the API so the row is live but likely uncheckpointed.
    const marker = "wal-marker-" + Date.now();
    await api.post("/restaurants", { name: marker }, admin.token);

    const res = await api.call("GET", "/admin/backups/download", { token: admin.token });
    assert.equal(res.status, 200);

    const dl = await fetch(`${S.base}/admin/backups/download`, {
      headers: { authorization: `Bearer ${admin.token}` }
    });
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.ok(buf.length > 0);
    assert.ok(buf.subarray(0, 15).toString("latin1").startsWith("SQLite format 3"),
      "the download should be a real SQLite file");

    // Open it and check the row made it — this is the whole reason the app uses
    // VACUUM INTO rather than copying app.db, which under WAL can be unusable.
    const { default: Database } = await import("better-sqlite3");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmp = path.join(os.tmpdir(), `oo-snapshot-${Date.now()}.db`);
    fs.writeFileSync(tmp, buf);
    try {
      const db = new Database(tmp, { readonly: true });
      const row = db.prepare("SELECT COUNT(*) c FROM restaurants WHERE name = ?").get(marker);
      db.close();
      assert.equal(row.c, 1, "the snapshot must contain rows that were still in the WAL");
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  test("health reports what an admin needs when nobody can help them", async () => {
    const res = await api.get("/admin/health", admin.token);
    assert.equal(res.status, 200);
    const h = res.data;

    assert.ok(h.uptimeSeconds >= 0);
    assert.equal(h.node, process.version);
    assert.ok(h.database.bytes > 0);
    assert.equal(h.database.integrity, "ok");
    assert.equal(h.database.journalMode, "wal");
    assert.ok(Array.isArray(h.addresses));
    assert.ok(typeof h.clients.total === "number");
    assert.ok(typeof h.counts.users === "number");
  });
});
