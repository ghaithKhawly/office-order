/*
 * Auto-lock at the cutoff.
 *
 * The server is always on now, so a scheduled job is finally reliable — before,
 * a laptop that slept through lunch would have missed it. Plain setInterval: a
 * cron dependency buys nothing when the only schedule is "check whether the
 * clock has passed a stored timestamp".
 *
 * The job is deliberately narrow. It only ever performs OPEN → LOCKED, which
 * the state machine in routes/sessions.js already allows, and it does so with a
 * conditional UPDATE so a session an admin moved on a half-second earlier is
 * left alone.
 */
import { db, audit } from "./db.js";
import { broadcast } from "./events.js";

/*
 * How often to look. The client shows a per-second countdown, so this only
 * decides how long "00:00" can sit on screen before the lock actually lands.
 * 15s keeps that imperceptible without waking the box constantly.
 */
export const CHECK_INTERVAL_MS = 15_000;

/*
 * Timestamps are stored the way the rest of the schema stores them: UTC, in
 * SQLite's own "YYYY-MM-DD HH:MM:SS" shape. That is what datetime('now')
 * produces, and because the format is fixed-width a plain string comparison is
 * a chronological one. An ISO string with its "T" and "Z" would sort *after*
 * every value datetime('now') can return, and the cutoff would never fire.
 */
export function toSqlUtc(value) {
  if (value == null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** True when a stored cutoff is in the past. */
export function isPast(sqlUtc) {
  if (!sqlUtc) return false;
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  return sqlUtc <= now;
}

/**
 * One pass. Exported so a test can run it directly instead of waiting on a
 * timer.
 *
 * @returns {string[]} ids of sessions that were locked by this pass
 */
export function runCutoffPass() {
  const due = db
    .prepare(
      `SELECT id, cutoff_at FROM sessions
        WHERE status = 'OPEN'
          AND cutoff_at IS NOT NULL
          AND cutoff_at <= datetime('now')`
    )
    .all();

  const locked = [];
  for (const s of due) {
    /*
     * Conditional on status: between the SELECT above and this UPDATE an admin
     * may have locked, placed or cancelled the session by hand. Re-checking in
     * the WHERE clause means the job can never drag a session backwards, and
     * changes === 0 tells us somebody else got there first.
     */
    const info = db
      .prepare("UPDATE sessions SET status = 'LOCKED' WHERE id = ? AND status = 'OPEN'")
      .run(s.id);

    if (info.changes === 0) continue;

    audit(null, "session.auto_lock", "session", s.id, { cutoffAt: s.cutoff_at });
    locked.push(s.id);
  }

  if (locked.length > 0) {
    console.log(`[cutoff] auto-locked ${locked.length} session(s)`);
    broadcast("session");
  }
  return locked;
}

let timer = null;

export function startCutoffJob(intervalMs = CHECK_INTERVAL_MS) {
  if (timer) return timer;
  // Run once on boot: the machine may have been off or the service restarted
  // straight through a cutoff.
  safePass();
  timer = setInterval(safePass, intervalMs);
  // Don't hold the process open on shutdown.
  timer.unref?.();
  console.log(`[cutoff] auto-lock job running every ${Math.round(intervalMs / 1000)}s`);
  return timer;
}

export function stopCutoffJob() {
  if (timer) clearInterval(timer);
  timer = null;
}

function safePass() {
  try {
    runCutoffPass();
  } catch (e) {
    // A transient SQLITE_BUSY must not kill the timer — that would silently
    // disable every future cutoff until someone restarts the service.
    console.error("[cutoff] pass failed:", e.message);
  }
}
