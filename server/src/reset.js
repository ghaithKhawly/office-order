import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
for (const f of ["app.db", "app.db-wal", "app.db-shm"]) {
  const p = path.join(dir, f);
  if (fs.existsSync(p)) { fs.unlinkSync(p); console.log("removed", f); }
}
console.log("database reset — next start recreates it with the bootstrap admin");
