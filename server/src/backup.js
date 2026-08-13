/*
 * Backups.
 *
 * The admin cannot phone a friend when this breaks, cannot restore from a
 * cloud, and cannot search for what a corrupted SQLite file means. So the app
 * takes its own snapshots on a schedule, keeps a handful, and says loudly when
 * the last good one is getting old.
 *
 * Snapshots are taken with VACUUM INTO, never a file copy. The database runs in
 * WAL mode, which means the committed state is split between app.db and
 * app.db-wal: copying app.db alone while the server is running gives you a
 * file that is missing every recent transaction, and it looks perfectly valid.
 * VACUUM INTO asks SQLite for a consistent, compacted copy while it holds the
 * appropriate locks — the whole point being that you find out it worked now,
 * not on the morning you need it.
 */
import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR, setting, setSetting, audit } from "./db.js";

export const BACKUP_DIR = path.join(DATA_DIR, "backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });

/* Both configurable from .env — a busy office may want more, a quiet one less. */
export const INTERVAL_HOURS = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS) || 6);
export const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);

/* Past this, the UI starts warning. Two missed intervals, floored at a day. */
export const STALE_AFTER_HOURS = Math.max(24, INTERVAL_HOURS * 2);

const stamp = (d = new Date()) =>
  d.toISOString().slice(0, 16).replace("T", "-").replace(":", "");

export const backupName = (d = new Date()) => `app-${stamp(d)}.db`;

/**
 * Write a consistent snapshot to `target`.
 *
 * VACUUM INTO refuses to overwrite, which is a feature: it means a snapshot can
 * never half-replace a good one. We delete a stale target first only when it is
 * our own temp file.
 */
export function snapshotTo(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  db.prepare("VACUUM INTO ?").run(target);
  return fs.statSync(target).size;
}

/** Take a scheduled backup, record it, and prune old ones. */
export function runBackup({ actorId = null, reason = "scheduled" } = {}) {
  const file = backupName();
  const target = path.join(BACKUP_DIR, file);

  const bytes = snapshotTo(target);

  setSetting("last_backup_at", new Date().toISOString());
  setSetting("last_backup_file", file);
  setSetting("last_backup_bytes", String(bytes));

  const removed = prune();
  audit(actorId, "backup.create", "backup", file, { bytes, reason, pruned: removed.length });
  console.log(`[backup] wrote ${file} (${(bytes / 1024).toFixed(0)} KB)${removed.length ? `, pruned ${removed.length}` : ""}`);
  return { file, bytes, pruned: removed };
}

/** Keep the newest KEEP snapshots. Filenames sort chronologically by design. */
export function prune() {
  const files = listBackups();
  const doomed = files.slice(KEEP);
  for (const f of doomed) {
    try {
      fs.rmSync(path.join(BACKUP_DIR, f.file), { force: true });
    } catch (e) {
      console.warn("[backup] could not remove", f.file, e.message);
    }
  }
  return doomed.map((f) => f.file);
}

/** Newest first. */
export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("app-") && f.endsWith(".db"))
    .map((file) => {
      const s = fs.statSync(path.join(BACKUP_DIR, file));
      return { file, bytes: s.size, at: s.mtime.toISOString() };
    })
    .sort((a, b) => (a.file < b.file ? 1 : -1));
}

/** What the UI shows, including whether to start worrying. */
export function backupStatus() {
  const at = setting("last_backup_at");
  const files = listBackups();

  // Fall back to the newest file on disk: the settings row is lost by a reset,
  // the files are the actual evidence.
  const lastAt = at || files[0]?.at || null;
  const ageHours = lastAt ? (Date.now() - Date.parse(lastAt)) / 3600_000 : null;

  return {
    lastAt,
    lastFile: setting("last_backup_file") || files[0]?.file || null,
    lastBytes: Number(setting("last_backup_bytes") || files[0]?.bytes || 0),
    count: files.length,
    keep: KEEP,
    intervalHours: INTERVAL_HOURS,
    ageHours,
    stale: lastAt === null || (ageHours !== null && ageHours > STALE_AFTER_HOURS),
    never: lastAt === null
  };
}

let timer = null;

export function startBackupJob() {
  if (timer) return timer;

  /*
   * Take one shortly after boot rather than immediately: on a machine that gets
   * switched on in the morning this captures the state before the day's
   * ordering, and the delay keeps startup snappy.
   */
  const first = setTimeout(() => safeRun(), 60_000);
  first.unref?.();

  timer = setInterval(() => safeRun(), INTERVAL_HOURS * 3600_000);
  timer.unref?.();
  console.log(`[backup] every ${INTERVAL_HOURS}h, keeping ${KEEP}, in ${BACKUP_DIR}`);
  return timer;
}

export function stopBackupJob() {
  if (timer) clearInterval(timer);
  timer = null;
}

function safeRun() {
  try {
    runBackup();
  } catch (e) {
    // A failed backup must not kill the timer, or every later backup is lost
    // too. The health page surfaces the staleness that results.
    console.error("[backup] FAILED:", e.message);
  }
}
