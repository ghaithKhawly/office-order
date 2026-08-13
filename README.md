# Office Order

Group food ordering for an office. Everyone adds their items to a shared daily
order, an admin approves and calls the restaurant, and the app works out exactly
what each person owes including their share of the delivery fee.

Arabic-first with full RTL, English toggle.

**Stack:** Express + SQLite (better-sqlite3) · React + TypeScript + Vite + Tailwind · JWT auth · SSE for live updates.

---

## Run it

```bash
npm install          # installs root, server, and web
cp .env.example server/.env   # then edit JWT_SECRET and ADMIN_PASSWORD
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001

Sign in with the bootstrap admin (`admin` / `admin123` unless you changed
`server/.env`). Change the password from **Setup** immediately.

### Production / office LAN

```bash
npm run build        # builds the frontend
npm start            # one process serves API + frontend on :3001
```

Then everyone opens `http://<the-machine's-IP>:3001` on their phone. One
old laptop or a Raspberry Pi on the office network is enough.

### First five minutes

1. **Setup → Add restaurant** — name, phone, delivery fee, then add the menu items.
2. **Setup → Add person** — one account per colleague. The app hands you a
   temporary password to pass on. There is no public signup.
3. **Today → Start a session** — pick the restaurant, set the delivery fee and split mode.
4. Everyone opens **Menu**, taps their items, sends the order.
5. You approve, hit **Kitchen sheet**, copy the aggregated list, call the restaurant.
6. **Money** shows what each person owes and tracks who has paid.

---

## How the money works

`items_total` is the sum of `unit_price_snapshot × qty` for every **approved** order.

The delivery fee is split by `split_mode`:

| Mode | Weight per person |
|---|---|
| `EQUAL` | `1 / N` |
| `PROPORTIONAL` | `their_items / all_items` |

Shares are then allocated with the **largest-remainder method** in multiples of
`rounding_step`: everyone is floored to the step, and the leftover goes to
whoever was rounded down hardest. This guarantees `sum(shares) === delivery_fee`
exactly — the naive approach of rounding each share independently leaves you
short every single time.

`cash_step` optionally rounds each person's final due **up** to a cash-friendly
amount when nobody has change. The surplus is surfaced as a visible tip/kitty
rather than quietly disappearing.

The person set as **payer** fronts the cash. Everyone else's due becomes a debt
to them, tracked on the **Money** tab as a running balance across sessions so
people can settle weekly instead of daily.

---

## Design decisions worth knowing

**Prices are snapshotted server-side.** When you submit an order, the server
looks up the live menu price and stores a copy on the order line. Editing a
menu price later never rewrites a past order's totals. The client's claimed
price is ignored entirely — sending `{"price": 1}` changes nothing.

**Invite-only accounts.** Admins create every account. This, not per-order
approval, is what actually stops fake orders. Approval is still there for the
day-to-day, with a `trusted` flag per person so admins only review new people.

**All money is INTEGER.** No floats anywhere in the money path.

**Session status is a state machine.** `OPEN → LOCKED → PLACED → SETTLED`, with
invalid transitions rejected by the API. You can't mark a session placed with
zero approved orders, and you can't add items after it locks.

**Everything mutating is audited.** `audit_log` records actor, action, entity,
and payload for approvals, rejections, status changes, and menu edits.

---

## API

All routes need `Authorization: Bearer <token>` except `/api/auth/login` and `/api/health`.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | anyone | Get a token (30d) |
| GET | `/api/auth/me` | any | Current user |
| POST | `/api/auth/password` | any | Change own password |
| GET | `/api/users` | any | List people |
| POST | `/api/users` | admin | Create account, returns temp password |
| PATCH | `/api/users/:id` | admin | Role, trusted, active, reset password |
| GET | `/api/restaurants` | any | List with menus |
| POST/PATCH/DELETE | `/api/restaurants[/:id]` | admin | CRUD (delete is a soft archive) |
| PUT | `/api/restaurants/:id/menu` | admin | Replace whole menu atomically |
| PATCH | `/api/restaurants/:id/menu/adjust` | admin | Bulk `{percent}` price change |
| GET | `/api/sessions/active` | any | Current session + computed totals |
| GET | `/api/sessions?limit=` | any | History |
| POST | `/api/sessions` | admin | Start one (409 if one is running) |
| PATCH | `/api/sessions/:id` | admin | Status, fee, split mode, payer |
| PUT | `/api/sessions/:id/my-order` | any | Upsert my items (OPEN only) |
| DELETE | `/api/sessions/:id/my-order` | any | Withdraw my order |
| POST | `/api/sessions/:id/approve-all` | admin | Bulk approve |
| PATCH | `/api/orders/:id/decision` | admin | Approve / reject with reason |
| PATCH | `/api/orders/:id/paid` | admin | Mark settled |
| GET | `/api/sessions/:id/kitchen-sheet` | any | Aggregated text for the phone call |
| GET | `/api/balances` | any | Running debts |
| GET | `/api/stream` | any | SSE; server pings on every write |

---

## Operations

**Backup** is one file copy:

```bash
cp server/data/app.db ~/backups/app-$(date +%F).db
```

Do this on a cron. WAL mode means you should copy `app.db-wal` too, or stop the
server first for a guaranteed-clean snapshot.

**Reset everything:** `npm run reset-db` (deletes the database; next start
recreates it with the bootstrap admin).

**Move to Postgres later:** the schema is plain SQL and the money math lives in
`server/src/calc.js`, independent of the driver. Swapping `better-sqlite3` for
`pg` means rewriting the query layer in `server/src/routes/`, nothing else.

---

## Not built (deliberately)

- Multi-restaurant in one session
- Online payment
- Item options/variants (size, extras) — notes cover most of it
- Push notifications

## Known limits

- HTTP, not HTTPS. Fine on a trusted office LAN; put it behind Caddy or nginx
  with a certificate if you expose it to the internet.
- SQLite handles one writer at a time. At office scale (tens of people) this is
  a non-issue; `busy_timeout` is set to 5s.
- No rate limiting on login. Add `express-rate-limit` before exposing it publicly.
