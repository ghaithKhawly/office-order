/**
 * Largest-remainder allocation.
 *
 * Splits `total` across `weights` in whole multiples of `step`, then hands the
 * leftover to whoever was rounded down hardest. Guarantees sum(out) === total
 * exactly — no drift, no missing pounds at the end of the day.
 */
export function allocate(total, weights, step) {
  const n = weights.length;
  if (n === 0) return [];
  if (!total || total <= 0) return weights.map(() => 0);

  const s = Math.max(1, Math.round(step || 1));
  const raw = weights.map((w) => total * w);
  const base = raw.map((r) => Math.floor(r / s) * s);
  const out = base.slice();

  let remainder = total - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - base[i] }))
    .sort((a, b) => b.frac - a.frac);

  let k = 0;
  while (remainder > 0) {
    const give = Math.min(s, remainder);
    out[order[k % n].i] += give;
    remainder -= give;
    k++;
  }
  return out;
}

/**
 * @param session  row from `sessions`
 * @param orders   [{ id, userId, status, paid, items:[{unitPrice, qty}] }]
 */
export function computeSession(session, orders) {
  const all = orders.map((o) => ({
    ...o,
    subtotal: o.items.reduce((a, i) => a + i.unitPrice * i.qty, 0)
  }));

  const approved = all.filter((o) => o.status === "APPROVED");
  const itemsTotal = approved.reduce((a, o) => a + o.subtotal, 0);

  const weights =
    session.split_mode === "PROPORTIONAL" && itemsTotal > 0
      ? approved.map((o) => o.subtotal / itemsTotal)
      : approved.map(() => 1 / (approved.length || 1));

  const shares = allocate(session.delivery_fee, weights, session.rounding_step);
  const cashStep = session.cash_step || 0;

  const shareById = new Map();
  approved.forEach((o, i) => shareById.set(o.id, shares[i]));

  const rows = all.map((o) => {
    if (o.status !== "APPROVED") {
      return {
        ...o,
        deliveryShare: 0,
        cashRounding: 0,
        due: 0,
        counted: false
      };
    }
    const share = shareById.get(o.id) || 0;
    const base = o.subtotal + share;
    const due = cashStep > 0 ? Math.ceil(base / cashStep) * cashStep : base;
    return {
      ...o,
      deliveryShare: share,
      cashRounding: due - base,
      due,
      counted: true
    };
  });

  const counted = rows.filter((r) => r.counted);

  return {
    orders: rows,
    totals: {
      approvedCount: counted.length,
      itemsTotal,
      deliveryFee: session.delivery_fee,
      grandTotal: itemsTotal + session.delivery_fee,
      kitty: counted.reduce((a, r) => a + r.cashRounding, 0),
      collected: counted.filter((r) => r.paid).reduce((a, r) => a + r.due, 0),
      outstanding: counted.filter((r) => !r.paid).reduce((a, r) => a + r.due, 0)
    }
  };
}
