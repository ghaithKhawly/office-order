import { Router } from "express";
import rateLimit from "express-rate-limit";
import { db, uid, audit } from "../db.js";
import {
  hash, verify, sign, publicUser, authRequired, adminRequired
} from "../auth.js";
import { broadcast } from "../events.js";

export const authRoutes = Router();
export const userRoutes = Router();

/* ---------------- auth ---------------- */

/*
 * Deliberately generous. This is a trusted office LAN behind its own router,
 * not the open internet — the threat model is a bored colleague trying to
 * guess a coworker's password, not a botnet. 20 attempts per 15 minutes per IP
 * stops that cold while leaving room for someone genuinely fat-fingering a
 * password on a phone keyboard. Successful logins don't count against it.
 *
 * Note: everyone on the LAN comes from a distinct IP, so this is per-person in
 * practice. There is no proxy in front of the app, so no trust proxy setting.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_attempts" }
});

authRoutes.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username_and_password_required" });
  }
  const user = db
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(String(username).trim());

  if (!user || !user.active || !verify(String(password), user.password_hash)) {
    return res.status(401).json({ error: "bad_credentials" });
  }
  res.json({ token: sign(user), user: publicUser(user) });
});

authRoutes.get("/me", authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRoutes.post("/password", authRequired, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 4) {
    return res.status(400).json({ error: "password_too_short" });
  }
  if (!verify(String(current || ""), req.user.password_hash)) {
    return res.status(400).json({ error: "wrong_current_password" });
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(hash(String(next)), req.user.id);
  audit(req.user.id, "password.change", "user", req.user.id);
  res.json({ ok: true });
});

/* ---------------- users ---------------- */

userRoutes.use(authRequired);

userRoutes.get("/", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE")
    .all();
  res.json(rows.map(publicUser));
});

// Invite-only: there is no public signup. Admins create people.
userRoutes.post("/", adminRequired, (req, res) => {
  const { username, name, password, role, trusted } = req.body || {};
  const u = String(username || "").trim().toLowerCase();
  const n = String(name || "").trim();
  if (!u || !n) return res.status(400).json({ error: "username_and_name_required" });
  if (!/^[a-z0-9._-]{2,32}$/.test(u)) return res.status(400).json({ error: "bad_username" });

  const exists = db
    .prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(u);
  if (exists) return res.status(409).json({ error: "username_taken" });

  const pw = String(password || "").trim() || Math.random().toString(36).slice(2, 8);
  const id = uid();
  db.prepare(
    `INSERT INTO users (id,username,name,password_hash,role,trusted)
     VALUES (?,?,?,?,?,?)`
  ).run(id, u, n, hash(pw), role === "ADMIN" ? "ADMIN" : "MEMBER", trusted ? 1 : 0);

  audit(req.user.id, "user.create", "user", id, { username: u });
  broadcast("users");
  // temp password returned once so the admin can hand it over
  res.status(201).json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id)), tempPassword: pw });
});

userRoutes.patch("/:id", adminRequired, (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "not_found" });

  const { name, role, trusted, active, password } = req.body || {};

  // Never let the last admin demote or deactivate themselves out of existence.
  const admins = db
    .prepare("SELECT COUNT(*) c FROM users WHERE role='ADMIN' AND active=1").get().c;
  const losingAdmin =
    target.role === "ADMIN" &&
    ((role && role !== "ADMIN") || active === false);
  if (losingAdmin && admins <= 1) {
    return res.status(400).json({ error: "last_admin" });
  }

  db.prepare(
    `UPDATE users SET
       name = COALESCE(?, name),
       role = COALESCE(?, role),
       trusted = COALESCE(?, trusted),
       active = COALESCE(?, active),
       password_hash = COALESCE(?, password_hash)
     WHERE id = ?`
  ).run(
    name != null ? String(name).trim() : null,
    role === "ADMIN" || role === "MEMBER" ? role : null,
    trusted == null ? null : trusted ? 1 : 0,
    active == null ? null : active ? 1 : 0,
    password ? hash(String(password)) : null,
    target.id
  );

  audit(req.user.id, "user.update", "user", target.id, { name, role, trusted, active });
  broadcast("users");
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(target.id)) });
});
