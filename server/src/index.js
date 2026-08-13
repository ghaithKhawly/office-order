import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, uid, setting, setSetting, DB_PATH } from "./db.js";
import { hash, authRequired } from "./auth.js";
import { sseHandler } from "./events.js";
import { authRoutes, userRoutes } from "./routes/users.js";
import { restaurantRoutes } from "./routes/restaurants.js";
import { sessionRoutes, orderRoutes, balancesHandler } from "./routes/sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);

/* -------- bootstrap the first admin so the app is usable on boot -------- */
const adminUser = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
const adminPass = process.env.ADMIN_PASSWORD || "admin123";
const existing = db.prepare("SELECT COUNT(*) c FROM users").get().c;
if (existing === 0) {
  db.prepare(
    `INSERT INTO users (id,username,name,password_hash,role,trusted)
     VALUES (?,?,?,?,'ADMIN',1)`
  ).run(uid(), adminUser, process.env.ADMIN_NAME || "Admin", hash(adminPass));
  console.log(`[boot] created admin "${adminUser}" with password "${adminPass}"`);
  console.log("[boot] change it from Setup, or set ADMIN_PASSWORD in .env before first run");
}
if (!setting("currency")) setSetting("currency", process.env.CURRENCY || "ل.س");

/* ------------------------------- app ---------------------------------- */
const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "512kb" }));

app.get("/api/health", (req, res) =>
  res.json({ ok: true, db: path.basename(DB_PATH), time: new Date().toISOString() })
);

app.get("/api/settings", (req, res) => res.json({ currency: setting("currency", "SYP") }));
app.put("/api/settings", authRequired, (req, res) => {
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "admin_only" });
  if (req.body?.currency) setSetting("currency", String(req.body.currency).slice(0, 8));
  res.json({ currency: setting("currency") });
});

app.get("/api/stream", sseHandler);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/orders", orderRoutes);
app.get("/api/balances", authRequired, balancesHandler);

app.use("/api", (req, res) => res.status(404).json({ error: "no_such_endpoint" }));

/* --------- serve the built frontend if it exists (production mode) ------ */
const dist = path.join(__dirname, "..", "..", "web", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));
  console.log("[boot] serving frontend from web/dist");
} else {
  console.log("[boot] no web/dist yet — run `npm run build` for production mode");
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[boot] API on http://localhost:${PORT}  (LAN: http://<your-ip>:${PORT})`);
  console.log(`[boot] database: ${DB_PATH}`);
});
