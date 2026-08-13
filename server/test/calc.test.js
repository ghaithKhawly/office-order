/*
 * The money math.
 *
 * calc.js is the one file where a bug costs real money and nobody notices for
 * weeks — a few pounds short every day, absorbed by whoever fronted the cash.
 * It was verified against 200,000 randomised cases before this suite existed;
 * this ports that check into something `npm test` runs so it stays verified.
 *
 * The invariant, in one line: sum(shares) === delivery_fee, exactly, always.
 * Not "within rounding" — exactly. The naive approach of rounding each share
 * independently leaves you short every single time, which is the whole reason
 * largest-remainder allocation is in here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { allocate, computeSession } from "../src/calc.js";

/* Deterministic PRNG (mulberry32). A property test that fails only on some
   runs is a test nobody can act on: this one fails identically every time. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEPS = [1, 5, 25, 50, 100, 250, 500, 1000, 5000];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/* ------------------------------------------------------------------ */
/*  allocate()                                                         */
/* ------------------------------------------------------------------ */

test("allocate: sum of shares equals the fee exactly, over 20000 random cases", () => {
  const rand = rng(0xC0FFEE);
  let checked = 0;

  for (let i = 0; i < 20000; i++) {
    const n = 1 + Math.floor(rand() * 12);          // 1..12 participants
    const fee = Math.floor(rand() * 200000);        // 0..199,999
    const step = STEPS[Math.floor(rand() * STEPS.length)];

    // Weights as they actually arrive from computeSession: normalised to 1.
    const raw = Array.from({ length: n }, () => rand() + 0.0001);
    const total = sum(raw);
    const weights = raw.map((w) => w / total);

    const out = allocate(fee, weights, step);

    assert.equal(out.length, n, "one share per participant");
    assert.equal(sum(out), fee, `shares must sum to the fee (n=${n} fee=${fee} step=${step})`);
    assert.ok(out.every((v) => v >= 0), "no negative shares");
    assert.ok(out.every(Number.isInteger), "shares are whole units — no floats in the money path");
    checked++;
  }

  assert.equal(checked, 20000);
});

test("allocate: equal weights, the EQUAL split mode", () => {
  const rand = rng(0xBEEF);
  for (let i = 0; i < 5000; i++) {
    const n = 1 + Math.floor(rand() * 10);
    const fee = Math.floor(rand() * 100000);
    const step = STEPS[Math.floor(rand() * STEPS.length)];
    const weights = Array.from({ length: n }, () => 1 / n);

    const out = allocate(fee, weights, step);
    assert.equal(sum(out), fee);
    assert.ok(out.every((v) => v >= 0));

    // With equal weights nobody should be more than one step out from anyone
    // else — that is what makes the split feel fair rather than merely correct.
    const spread = Math.max(...out) - Math.min(...out);
    assert.ok(spread <= step, `equal split spread ${spread} exceeded step ${step}`);
  }
});

test("allocate: zero fee gives everyone zero", () => {
  for (const n of [1, 2, 5, 40]) {
    const weights = Array.from({ length: n }, () => 1 / n);
    const out = allocate(0, weights, 100);
    assert.equal(out.length, n);
    assert.equal(sum(out), 0);
    assert.ok(out.every((v) => v === 0));
  }
});

test("allocate: one participant takes the whole fee", () => {
  for (const fee of [0, 1, 7, 999, 15000, 123457]) {
    for (const step of STEPS) {
      const out = allocate(fee, [1], step);
      assert.deepEqual(out, [fee], `single participant should owe the entire fee (${fee}/${step})`);
    }
  }
});

test("allocate: zero participants allocates nothing", () => {
  assert.deepEqual(allocate(10000, [], 100), []);
  assert.deepEqual(allocate(0, [], 100), []);
});

test("allocate: a fee smaller than the rounding step still lands entirely", () => {
  // 50 to split five ways in steps of 1000: someone has to absorb all of it.
  const out = allocate(50, Array.from({ length: 5 }, () => 0.2), 1000);
  assert.equal(sum(out), 50);
  assert.equal(out.filter((v) => v > 0).length, 1);
});

test("allocate: a step larger than the fee never over-allocates", () => {
  const rand = rng(0x1234);
  for (let i = 0; i < 2000; i++) {
    const n = 1 + Math.floor(rand() * 6);
    const fee = 1 + Math.floor(rand() * 400);
    const out = allocate(fee, Array.from({ length: n }, () => 1 / n), 5000);
    assert.equal(sum(out), fee);
    assert.ok(out.every((v) => v >= 0));
  }
});

/* ------------------------------------------------------------------ */
/*  computeSession()                                                   */
/* ------------------------------------------------------------------ */

const session = (over = {}) => ({
  delivery_fee: 10000,
  split_mode: "EQUAL",
  rounding_step: 100,
  cash_step: 0,
  ...over
});

const order = (id, status, lines) => ({
  id, userId: "u" + id, status, paid: false,
  items: lines.map(([unitPrice, qty]) => ({ unitPrice, qty }))
});

test("computeSession: delivery shares sum to the fee in both split modes", () => {
  const rand = rng(0xFEED);

  for (let i = 0; i < 4000; i++) {
    const n = 1 + Math.floor(rand() * 8);
    const fee = Math.floor(rand() * 60000);
    const step = STEPS[Math.floor(rand() * STEPS.length)];
    const mode = rand() < 0.5 ? "EQUAL" : "PROPORTIONAL";

    const orders = Array.from({ length: n }, (_, k) =>
      order(k, "APPROVED", [[100 + Math.floor(rand() * 40000), 1 + Math.floor(rand() * 4)]])
    );

    const s = session({ delivery_fee: fee, split_mode: mode, rounding_step: step });
    const { orders: rows, totals } = computeSession(s, orders);

    const shares = rows.filter((r) => r.counted).map((r) => r.deliveryShare);
    assert.equal(sum(shares), fee, `${mode}: shares must sum to the fee (n=${n} fee=${fee} step=${step})`);
    assert.ok(shares.every((v) => v >= 0), "no negative shares");
    assert.equal(totals.deliveryFee, fee);
    assert.equal(totals.grandTotal, totals.itemsTotal + fee);
  }
});

test("computeSession: only approved orders are charged", () => {
  const orders = [
    order(1, "APPROVED", [[10000, 1]]),
    order(2, "PENDING", [[50000, 3]]),
    order(3, "REJECTED", [[90000, 2]])
  ];
  const { orders: rows, totals } = computeSession(session(), orders);

  assert.equal(totals.itemsTotal, 10000, "pending and rejected must not reach the total");
  assert.equal(totals.approvedCount, 1);

  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId[1].counted, true);
  assert.equal(byId[2].counted, false);
  assert.equal(byId[3].counted, false);
  assert.equal(byId[2].due, 0, "an unapproved order owes nothing");
  assert.equal(byId[3].deliveryShare, 0);

  // The whole fee still lands on the one approved order.
  assert.equal(byId[1].deliveryShare, 10000);
});

test("computeSession: zero participants leaves the fee unallocated", () => {
  const { orders: rows, totals } = computeSession(session({ delivery_fee: 8000 }), []);
  assert.deepEqual(rows, []);
  assert.equal(totals.approvedCount, 0);
  assert.equal(totals.itemsTotal, 0);
  assert.equal(totals.deliveryFee, 8000);
  assert.equal(totals.outstanding, 0, "nobody is owed anything when nobody ordered");
});

test("computeSession: a session with only unapproved orders charges nobody", () => {
  const { totals } = computeSession(session(), [order(1, "PENDING", [[10000, 1]])]);
  assert.equal(totals.approvedCount, 0);
  assert.equal(totals.itemsTotal, 0);
  assert.equal(totals.outstanding, 0);
});

test("computeSession: PROPORTIONAL charges the bigger order more", () => {
  const orders = [
    order(1, "APPROVED", [[10000, 1]]),   // 10,000
    order(2, "APPROVED", [[90000, 1]])    // 90,000
  ];
  const { orders: rows } = computeSession(
    session({ split_mode: "PROPORTIONAL", delivery_fee: 10000, rounding_step: 100 }),
    orders
  );
  const [a, b] = rows;
  assert.ok(b.deliveryShare > a.deliveryShare, "the larger order should carry more of the fee");
  assert.equal(a.deliveryShare + b.deliveryShare, 10000);
});

test("computeSession: PROPORTIONAL with a zero items total falls back to equal", () => {
  // Everyone ordered something free — do not divide by zero.
  const orders = [order(1, "APPROVED", [[0, 1]]), order(2, "APPROVED", [[0, 1]])];
  const { orders: rows } = computeSession(
    session({ split_mode: "PROPORTIONAL", delivery_fee: 10000 }),
    orders
  );
  assert.equal(sum(rows.map((r) => r.deliveryShare)), 10000);
  assert.equal(rows[0].deliveryShare, rows[1].deliveryShare);
});

test("computeSession: cash rounding only ever rounds up, and surfaces as kitty", () => {
  const rand = rng(0xCA5);
  for (let i = 0; i < 2000; i++) {
    const n = 1 + Math.floor(rand() * 6);
    const cashStep = [0, 100, 500, 1000][Math.floor(rand() * 4)];
    const orders = Array.from({ length: n }, (_, k) =>
      order(k, "APPROVED", [[137 + Math.floor(rand() * 9000), 1]])
    );
    const { orders: rows, totals } = computeSession(
      session({ delivery_fee: 7000, cash_step: cashStep }), orders
    );

    for (const r of rows) {
      assert.ok(r.cashRounding >= 0, "cash rounding must never take money off the total");
      assert.equal(r.due, r.subtotal + r.deliveryShare + r.cashRounding);
      if (cashStep > 0) assert.equal(r.due % cashStep, 0, "due should land on the cash step");
    }
    assert.equal(totals.kitty, sum(rows.map((r) => r.cashRounding)));
  }
});

test("computeSession: collected and outstanding split the total, and nothing leaks", () => {
  const orders = [
    { ...order(1, "APPROVED", [[10000, 1]]), paid: true },
    order(2, "APPROVED", [[20000, 1]]),
    order(3, "PENDING", [[50000, 1]])
  ];
  const { totals } = computeSession(session({ delivery_fee: 6000 }), orders);
  const counted = totals.collected + totals.outstanding;
  assert.equal(counted, totals.itemsTotal + totals.deliveryFee + totals.kitty);
});
