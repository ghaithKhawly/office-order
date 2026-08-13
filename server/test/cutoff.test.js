/*
 * The cutoff and the auto-lock job.
 *
 * Most of this file exists for one bug that would have been invisible: if the
 * cutoff is stored as an ISO string, `cutoff_at <= datetime('now')` is never
 * true, because "2026-08-13T14:00:00Z" sorts after every value SQLite's
 * datetime() can produce. Nothing throws. No session ever locks. The feature
 * simply does not happen, quietly, forever.
 */
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startTestServer } from "./helpers/server.js";

/* Point the module's database at a throwaway directory before importing it —
   db.js creates its file at import time. */
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oo-cutoff-"));
const { toSqlUtc, isPast, CHECK_INTERVAL_MS } = await import("../src/cutoff.js");

describe("timestamp normalisation", () => {
  test("toSqlUtc produces SQLite's own format, which is what makes comparison work", () => {
    assert.equal(toSqlUtc("2026-08-13T14:30:00.000Z"), "2026-08-13 14:30:00");
    assert.equal(toSqlUtc("2026-08-13T14:30:00Z"), "2026-08-13 14:30:00");

    const out = toSqlUtc(new Date("2026-01-02T03:04:05Z"));
    assert.equal(out, "2026-01-02 03:04:05");

    // The shape the whole feature depends on: no "T", no "Z", fixed width.
    assert.match(out, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.ok(!out.includes("T") && !out.includes("Z"));
  });

  test("the stored form sorts chronologically as a plain string", () => {
    // This is the property SQL relies on: `cutoff_at <= datetime('now')` is a
    // string comparison, so ordering must match time ordering.
    const times = [
      "2026-08-13T09:00:00Z", "2026-08-13T14:30:00Z",
      "2026-08-14T08:00:00Z", "2026-12-31T23:59:59Z", "2027-01-01T00:00:00Z"
    ].map(toSqlUtc);

    const sorted = [...times].sort();
    assert.deepEqual(sorted, times, "lexical order must equal chronological order");
  });

  test("an ISO string would have broken the comparison — the bug this guards", () => {
    const iso = "2026-08-13T14:30:00.000Z";
    const sqlNow = "2026-08-13 23:59:59";   // later in the day, SQLite's shape

    // "T" (0x54) sorts above every digit and the space separator, so the raw
    // ISO value compares as later than a genuinely later time.
    assert.ok(iso > sqlNow, "raw ISO sorts after a later SQLite timestamp — no cutoff would ever fire");
    assert.ok(toSqlUtc(iso) < sqlNow, "normalised, it compares correctly");
  });

  test("rubbish input is rejected rather than stored", () => {
    for (const bad of [null, undefined, "", "not a date", "13/08/2026"]) {
      assert.equal(toSqlUtc(bad), null, `${JSON.stringify(bad)} should not produce a timestamp`);
    }
  });

  test("isPast compares against the same normalised form", () => {
    assert.equal(isPast(toSqlUtc(new Date(Date.now() - 60_000))), true);
    assert.equal(isPast(toSqlUtc(new Date(Date.now() + 3600_000))), false);
    assert.equal(isPast(null), false);
  });
});

/* ------------------------------------------------------------------ */

describe("auto-lock", () => {
  let S, api, admin;

  before(async () => {
    S = await startTestServer();
    api = S.api;
    admin = S.admin;
  });
  after(async () => { await S?.stop(); });

  const makeRestaurant = async (name) => {
    const r = await api.post("/restaurants", { name, deliveryFee: 1000 }, admin.token);
    const saved = await api.put(`/restaurants/${r.data.id}/menu`,
      { items: [{ name: "شيش", price: 15000, category: "" }] }, admin.token);
    return saved.data;
  };

  const startSession = async (restaurantId, cutoffAt) => {
    const active = await api.get("/sessions/active", admin.token);
    if (active.data) await api.del(`/sessions/${active.data.id}`, admin.token);
    const r = await api.post("/sessions", {
      restaurantId, deliveryFee: 1000, splitMode: "EQUAL",
      payerId: admin.user.id, roundingStep: 100, cashStep: 0, cutoffAt
    }, admin.token);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };

  /** Poll until the session reaches `status`, or give up. */
  async function waitForStatus(id, status, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await api.get(`/sessions/${id}`, admin.token);
      if (res.data?.status === status) return res.data;
      if (Date.now() > deadline) return res.data;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  test("a cutoff in the past locks the session by itself", async () => {
    const rest = await makeRestaurant("auto lock");
    const session = await startSession(rest.id, new Date(Date.now() - 60_000).toISOString());
    assert.equal(session.status, "OPEN");

    const locked = await waitForStatus(session.id, "LOCKED", CHECK_INTERVAL_MS + 10_000);
    assert.equal(locked.status, "LOCKED", "the job should have locked it");

    // ...and it is recorded as the system doing it, not a person.
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(path.join(S.dataDir, "app.db"), { readonly: true });
    const row = db.prepare(
      "SELECT actor_id, action FROM audit_log WHERE entity_id = ? AND action = 'session.auto_lock'"
    ).get(session.id);
    db.close();

    assert.ok(row, "an audit row should exist");
    assert.equal(row.actor_id, null, "no human actor for an automatic lock");
  });

  test("a future cutoff leaves the session alone", async () => {
    const rest = await makeRestaurant("future cutoff");
    const session = await startSession(rest.id, new Date(Date.now() + 3600_000).toISOString());

    await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS + 3000));
    const still = await api.get(`/sessions/${session.id}`, admin.token);
    assert.equal(still.data.status, "OPEN", "an hour out is not due yet");
  });

  test("the job never drags a session that has already moved on", async () => {
    const rest = await makeRestaurant("already placed");
    const session = await startSession(rest.id, new Date(Date.now() - 60_000).toISOString());

    // Get it to PLACED before the job can act on the stale cutoff.
    await api.put(`/sessions/${session.id}/my-order`,
      { items: [{ menuItemId: rest.menu[0].id, qty: 1 }] }, admin.token);
    await api.patch(`/sessions/${session.id}`, { status: "LOCKED" }, admin.token);
    const placed = await api.patch(`/sessions/${session.id}`, { status: "PLACED" }, admin.token);
    assert.equal(placed.data.status, "PLACED");

    await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS + 3000));
    const after = await api.get(`/sessions/${session.id}`, admin.token);
    assert.equal(after.data.status, "PLACED", "a placed session must not be pulled back to LOCKED");
  });

  test("reopening clears a cutoff that has already passed", async () => {
    const rest = await makeRestaurant("reopen clears");
    const session = await startSession(rest.id, new Date(Date.now() - 60_000).toISOString());
    await waitForStatus(session.id, "LOCKED", CHECK_INTERVAL_MS + 10_000);

    const reopened = await api.patch(`/sessions/${session.id}`, { status: "OPEN" }, admin.token);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.data.status, "OPEN");
    assert.equal(reopened.data.cutoffAt, null,
      "a stale cutoff must be cleared, or the job re-locks within seconds");

    // Prove it stays open through at least one more pass of the job.
    await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS + 3000));
    const still = await api.get(`/sessions/${session.id}`, admin.token);
    assert.equal(still.data.status, "OPEN", "it must not be re-locked immediately");
  });

  test("the cutoff can be set, changed and cleared", async () => {
    const rest = await makeRestaurant("cutoff editing");
    const session = await startSession(rest.id, null);
    assert.equal(session.cutoffAt, null);

    const future = new Date(Date.now() + 1800_000).toISOString();
    let res = await api.patch(`/sessions/${session.id}`, { cutoffAt: future }, admin.token);
    assert.equal(res.status, 200);
    assert.equal(Date.parse(res.data.cutoffAt), Date.parse(future.slice(0, 19) + "Z"));

    // Omitting the key must leave it untouched — it cannot use COALESCE.
    res = await api.patch(`/sessions/${session.id}`, { deliveryFee: 2000 }, admin.token);
    assert.ok(res.data.cutoffAt, "an unrelated update must not wipe the cutoff");

    // null clears it.
    res = await api.patch(`/sessions/${session.id}`, { cutoffAt: null }, admin.token);
    assert.equal(res.data.cutoffAt, null);

    // Nonsense is refused.
    res = await api.patch(`/sessions/${session.id}`, { cutoffAt: "not a date" }, admin.token);
    assert.equal(res.status, 400);
    assert.equal(res.data.error, "bad_cutoff");
  });

  test("the session payload carries the server clock for the countdown", async () => {
    const rest = await makeRestaurant("server now");
    const session = await startSession(rest.id, new Date(Date.now() + 600_000).toISOString());
    assert.ok(session.serverNow, "serverNow must be present");
    const drift = Math.abs(Date.parse(session.serverNow) - Date.now());
    assert.ok(drift < 60_000, `serverNow should track real time (drift ${drift}ms)`);
  });
});
