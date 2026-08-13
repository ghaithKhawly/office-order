#!/usr/bin/env node
/*
 * Installs the server and web workspaces after the root install.
 *
 * This used to be `npm install --prefix server && npm install --prefix web`,
 * which recurses forever: --prefix changes where packages land but npm still
 * reads the *current directory's* package.json for lifecycle scripts, so the
 * root postinstall re-triggers itself until the process dies. On Windows that
 * surfaced as a wall of nested "npm error" lines and no node_modules.
 *
 * Spawning npm with cwd set to each package directory is what actually
 * isolates them — the child reads that directory's package.json and runs its
 * scripts, not ours.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

/* npm is a .cmd shim on Windows and execFile won't run it without a shell. */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

for (const pkg of ["server", "web"]) {
  const dir = path.join(ROOT, pkg);
  if (!fs.existsSync(path.join(dir, "package.json"))) {
    console.error(`[install] ${pkg}/package.json missing — skipping`);
    continue;
  }
  console.log(`[install] ${pkg}`);
  const r = spawnSync(NPM, ["install"], {
    cwd: dir,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (r.status !== 0) {
    console.error(`[install] ${pkg} failed with code ${r.status}`);
    process.exit(r.status || 1);
  }
}

console.log("[install] server and web ready");
