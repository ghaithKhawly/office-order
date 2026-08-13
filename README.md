# Office Order

Group food ordering for an office. Everyone adds their items to a shared daily
order, an admin approves and calls the restaurant, and the app works out exactly
what each person owes including their share of the delivery fee.

Arabic-first with full RTL, English toggle.

**Stack:** Express + SQLite (better-sqlite3) · React + TypeScript + Vite + Tailwind · JWT auth · SSE for live updates.

> **This app runs air-gapped.** It is deployed to a Windows machine on a closed
> office LAN with no internet: no CDN, no npm registry, no certificate
> authority, no cloud backup. Everything the browser needs ships with the app.
> Before changing anything, read **[Air-gap rules](#air-gap-rules)** —
> a single `<link>` to a font CDN is enough to break Arabic on the target
> machine, and nobody on site can diagnose it.
>
> Windows deployment lives in **[DEPLOY-WINDOWS.md](DEPLOY-WINDOWS.md)**.

---

## Run it

Node **22** is required — see `.nvmrc`. `better-sqlite3` ships a prebuilt
binary per Node ABI, so a different major version means it has to compile from
source, and the offline machine has no compiler. This is not a soft preference.

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
npm run build        # builds the frontend, then verifies it is offline-clean
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

## Getting a menu in

Typing a 40-item Arabic menu by hand is the most tedious part of running this
app, so there are four ways in. All of them land in the same editor, and
nothing is written until you press save.

**Paste it.** *Setup → edit a restaurant → Paste a menu.* Drop in raw text and
you get a preview table to correct before committing. The parser
(`server/src/menu-parse.js`, pure, no I/O) handles in a single paste:

- `اسم الصنف — 15000` and `اسم الصنف - 15000`
- `اسم الصنف .......... 15,000` (dot leaders, comma or `٬` grouping)
- tab- and comma-separated pairs, and `15.000` European grouping
- Arabic-Indic `٥٠٠٠` and Persian `۵۰۰۰` digits
- a line with no price → an item at 0, flagged **no price**
- a line with no digits and no separator → a **category header** for the rows
  beneath it

Two judgement calls it will not make for you. A price of `15` where everything
else is in the thousands is flagged **price looks too low** with a one-tap
suggestion of `15000` — it is never applied silently, because a 500 SYP glass
of tea is also a real price. And a bare line is only treated as a heading if a
priced item follows it directly; a stray name after a blank line is an item
somebody forgot to price. Both are editable in the preview.

**Type it.** The grid is built for the keyboard: **Tab** moves name → price →
category → next row, **Shift+Tab** goes back, **Enter** makes a new row and
focuses it (inheriting the category above), **Ctrl+D** copies the row above,
**Ctrl+Delete** removes a row. The availability toggle and the delete button
are deliberately outside the tab order — with them in it, 40 items costs 120
extra keystrokes past controls nobody uses while transcribing.

**Photograph it.** Attach the paper menu as a photo and it sits beside the grid
while you type, zoomable, so you are never looking away from the screen. There
is no OCR, on purpose: Arabic menu photos with stylised fonts and a
right-aligned price column break Tesseract badly enough that you correct half
the rows anyway, and the model is 20+ MB to vendor onto an offline machine.

Photos are capped at 12 MB, whitelisted to JPEG/PNG/WEBP/GIF **by their magic
bytes rather than the Content-Type header**, stored under a filename the server
generates, and served through an authenticated route — never a static
directory.

**Import a file.** `Import` / `Export` move menus as versioned JSON
(`office-order.menu` v1). This is also the menu backup and the way a menu
transcribed on another machine gets in. Validation is per-row: one bad line in
a 40-item file does not cost you the other 39, and every rejected row comes
back with its number and a reason.

---

## Air-gap rules

The deployment target is a Windows box on a closed LAN. These are not style
preferences — each one is a way the app has broken or would break there.

**1. Zero network calls at runtime.** No CDN, no external API, no analytics, no
telemetry. A request to the internet does not fail fast on that network, it
*hangs*: the page half-renders and Arabic silently falls back to a system font.

`npm run build` runs `scripts/check-offline.mjs`, which scans `web/dist` for
absolute URLs, protocol-relative URLs, and known CDN hostnames, and fails the
build if it finds one. Run it alone with:

```bash
npm run check:offline
```

The only permitted exceptions are listed in `ALLOWED_URLS` in that script —
currently XML namespace URIs (`http://www.w3.org/2000/svg`, which the DOM never
dereferences) and React's error-decoder link (message text, not a request).
Each has a written justification. If you need to add one, confirm the browser
genuinely does not fetch it.

**Fonts are vendored.** Tajawal (400/500/700, Arabic + Latin) and IBM Plex Mono
(400/500, Latin) live in `web/public/fonts/` as `.woff2`, declared with local
`@font-face` rules at the top of `web/src/index.css` with `font-display: swap`.
The `unicode-range` values are kept from the original Google CSS, so the
browser still only downloads the subset a given glyph needs. Total ~87 KB.

**2. HTTP only, so no service worker, no PWA, no Web Push.** All three require a
secure context, which needs a certificate, which needs a CA the office machines
trust. Don't add a manifest that implies installability. Notifications are
in-app only.

**3. New dependencies must be pure JS.** They have to install on a Windows x64
machine that has internet *once*, then run forever offline. Native addons other
than `better-sqlite3` mean a compiler on the target machine, which there isn't.

**4. Node 22, pinned.** `engines` in `package.json` and `.nvmrc`. See above.

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
| GET | `/api/restaurants/:id/export` | any | Menu as a JSON file |
| POST | `/api/restaurants/import` | admin | Create/replace from JSON (`dryRun` to preview) |
| POST | `/api/restaurants/parse-menu` | admin | Parse pasted text — writes nothing |
| GET/POST | `/api/restaurants/:id/photos` | any / admin | List or upload menu photos |
| GET/DELETE | `/api/photos/:id` | any / admin | Fetch or delete a photo |
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

- HTTP, not HTTPS. Required on this LAN — there is no CA to issue a certificate
  the office phones would trust. This is why there is no service worker or Web
  Push (both need a secure context).
- SQLite handles one writer at a time. At office scale (tens of people) this is
  a non-issue; `busy_timeout` is set to 5s.
- Login is rate limited to 20 failed attempts per 15 minutes per IP. Successful
  logins don't count against it. **If someone locks themselves out**, the limiter
  is in-memory: restarting the app clears it immediately, or they can wait 15
  minutes.
