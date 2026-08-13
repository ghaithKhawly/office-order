/*
 * Health and backup, for a machine nobody can log into remotely.
 *
 * When something goes wrong here there is no internet to search from, no
 * monitoring, and quite possibly no one on site who knows what SQLite is. So
 * the app has to answer "is it healthy, and if not what exactly is wrong" by
 * itself, in a page an admin can read off their phone.
 */
import { Router } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { db, DATA_DIR, DB_PATH, audit } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";
import { clientCount, boardClientCount } from "../events.js";
import { lanAddresses } from "../net-info.js";
import {
  BACKUP_DIR, backupStatus, listBackups, runBackup, snapshotTo, backupName
} from "../backup.js";

export const adminRoutes = Router();
adminRoutes.use(authRequired, adminRequired);

const BOOTED_AT = Date.now();

function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/*
 * Free space on the volume holding the data. fs.statfs landed in Node 18.15 and
 * works on Windows, but degrade rather than 500 if it is ever unavailable —
 * this page is what someone reads when things are already going wrong.
 */
function diskSpace() {
  try {
    const s = fs.statfsSync(DATA_DIR);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, usedPct: total ? Math.round(((total - free) / total) * 100) : null };
  } catch {
    return { total: null, free: null, usedPct: null };
  }
}

adminRoutes.get("/health", (req, res) => {
  // WAL means the live database is three files; reporting only app.db
  // understates it, sometimes by a lot right before a checkpoint.
  const main = fileSize(DB_PATH);
  const wal = fileSize(DB_PATH + "-wal");
  const shm = fileSize(DB_PATH + "-shm");

  const disk = diskSpace();
  const backup = backupStatus();

  const counts = {
    users: db.prepare("SELECT COUNT(*) c FROM users WHERE active=1").get().c,
    restaurants: db.prepare("SELECT COUNT(*) c FROM restaurants WHERE active=1").get().c,
    sessions: db.prepare("SELECT COUNT(*) c FROM sessions").get().c,
    orders: db.prepare("SELECT COUNT(*) c FROM orders").get().c,
    auditRows: db.prepare("SELECT COUNT(*) c FROM audit_log").get().c
  };

  /*
   * An integrity check on every load would be too slow on a big file; this is
   * the cheap version SQLite recommends for a routine look.
   */
  let integrity = "unknown";
  try {
    integrity = db.pragma("quick_check", { simple: true });
  } catch (e) {
    integrity = "failed: " + e.message;
  }

  res.json({
    ok: true,
    now: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - BOOTED_AT) / 1000),
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    pid: process.pid,
    port: Number(process.env.PORT || 3001),
    addresses: lanAddresses(),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    database: {
      path: DB_PATH,
      bytes: main + wal + shm,
      mainBytes: main,
      walBytes: wal,
      journalMode: db.pragma("journal_mode", { simple: true }),
      integrity,
      schemaVersion: db.pragma("user_version", { simple: true })
    },
    disk,
    backup,
    clients: { total: clientCount(), board: boardClientCount() },
    counts
  });
});

/* ------------------------------------------------------------------ */
/*  backups                                                            */
/* ------------------------------------------------------------------ */

adminRoutes.get("/backups", (req, res) => {
  res.json({ status: backupStatus(), files: listBackups(), dir: BACKUP_DIR });
});

adminRoutes.post("/backups", (req, res) => {
  try {
    res.json(runBackup({ actorId: req.user.id, reason: "manual" }));
  } catch (e) {
    console.error("[backup] manual failed:", e);
    res.status(500).json({ error: "backup_failed", detail: e.message });
  }
});

/*
 * Download a snapshot taken right now.
 *
 * Deliberately a fresh VACUUM INTO rather than the newest scheduled file: when
 * someone clicks "download the database" before doing something risky, they
 * mean the state as of this moment.
 */
adminRoutes.get("/backups/download", (req, res) => {
  const temp = path.join(BACKUP_DIR, `download-${Date.now()}.db`);

  try {
    snapshotTo(temp);
  } catch (e) {
    console.error("[backup] snapshot for download failed:", e);
    return res.status(500).json({ error: "backup_failed" });
  }

  const name = backupName();
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Content-Length", String(fs.statSync(temp).size));

  const stream = fs.createReadStream(temp);

  /*
   * Windows will not unlink a file while a handle is open, so the temp file is
   * removed only once the stream is finished or destroyed — and on both paths,
   * or a cancelled download leaves litter in the backups directory forever.
   */
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    fs.rm(temp, { force: true }, (err) => {
      if (err) console.warn("[backup] temp file left behind:", temp, err.message);
    });
  };

  stream.on("close", cleanup);
  stream.on("error", (e) => {
    console.error("[backup] download stream failed:", e.message);
    cleanup();
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  res.on("close", () => stream.destroy());

  audit(req.user.id, "backup.download", "backup", name);
  stream.pipe(res);
});
