import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db } from "./db.js";

export const SECRET =
  process.env.JWT_SECRET || "change-me-in-env-file-please-0000000000";

export const hash = (pw) => bcrypt.hashSync(pw, 10);
export const verify = (pw, h) => bcrypt.compareSync(pw, h);

export function sign(user) {
  return jwt.sign({ sub: user.id, role: user.role }, SECRET, { expiresIn: "30d" });
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    trusted: !!u.trusted,
    active: !!u.active
  };
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "auth_required" });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: "auth_required" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "auth_required" });
  }
}

export function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "admin_only" });
  }
  next();
}
