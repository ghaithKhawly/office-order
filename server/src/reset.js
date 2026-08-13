/*
 * Deletes the database so the next start recreates it with the bootstrap admin.
 *
 * On Windows a running server holds an open handle on app.db and unlink fails
 * with EBUSY/EPERM. The original version threw a raw stack trace at that point,
 * which reads like a corrupted install to whoever is standing at the machine.
 * Stop the service first — the message says so.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));

if (!fs.existsSync(dir)) {
  console.log(`no data directory at ${dir} — nothing to reset`);
  process.exit(0);
}

let removed = 0;
let locked = false;

for (const f of ["app.db", "app.db-wal", "app.db-shm"]) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) continue;
  try {
    fs.unlinkSync(p);
    console.log("removed", f);
    removed++;
  } catch (e) {
    if (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES") {
      locked = true;
      console.error(`could not remove ${f} — the file is in use`);
    } else {
      throw e;
    }
  }
}

if (locked) {
  console.error(`
The database is still open by a running server. Stop it first, then retry:

  nssm stop OfficeOrder      (if installed as a Windows service)

or close the terminal window running \`npm start\`.
`);
  process.exit(1);
}

if (removed === 0) console.log("no database files found — nothing to reset");
else console.log("database reset — next start recreates it with the bootstrap admin");
