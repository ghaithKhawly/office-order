/*
 * Spin up a real server against a throwaway database.
 *
 * Deliberately a child process running server/src/index.js unmodified, rather
 * than importing the app: it exercises the actual boot path — migrations, the
 * bootstrap admin, the scheduled jobs, the static file serving — and it means
 * the tests needed no production code to be rearranged for testability.
 *
 * Each run gets its own DATA_DIR and its own port, so tests never see each
 * other's rows and can be run while a development server is up.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, "..", "..", "src", "index.js");

/** Ask the OS for a port nothing is using, then let go of it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const ADMIN = { username: "admin", password: "test-admin-pw" };

export async function startTestServer() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oo-test-"));

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      JWT_SECRET: "test-secret-not-used-anywhere-real",
      ADMIN_USERNAME: ADMIN.username,
      ADMIN_PASSWORD: ADMIN.password,
      ADMIN_NAME: "Test Admin",
      // Keep the scheduled backup out of the way; tests that want one ask.
      BACKUP_INTERVAL_HOURS: "24",
      NODE_ENV: "test"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));

  const base = `http://127.0.0.1:${port}/api`;

  // Wait for it to answer, rather than sleeping and hoping.
  const deadline = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (${child.exitCode}):\n${log.join("")}`);
    }
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`server did not start within 30s:\n${log.join("")}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const api = makeClient(base);
  const admin = await api.login(ADMIN.username, ADMIN.password);

  return {
    base,
    port,
    dataDir,
    api,
    admin,
    log: () => log.join(""),
    async stop() {
      child.kill();
      await new Promise((r) => child.once("exit", r));
      // Windows can hold the database file briefly after the process goes.
      for (let i = 0; i < 5; i++) {
        try {
          fs.rmSync(dataDir, { recursive: true, force: true });
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }
  };
}

/**
 * A tiny client that returns { status, data } instead of throwing, because
 * most of these tests are asserting on the failure codes.
 */
function makeClient(base) {
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, data, headers: res.headers };
  };

  return {
    call,
    get: (p, token) => call("GET", p, { token }),
    post: (p, body, token) => call("POST", p, { body, token }),
    put: (p, body, token) => call("PUT", p, { body, token }),
    patch: (p, body, token) => call("PATCH", p, { body, token }),
    del: (p, token) => call("DELETE", p, { token }),

    async login(username, password) {
      const r = await call("POST", "/auth/login", { body: { username, password } });
      if (r.status !== 200) throw new Error(`login failed for ${username}: ${JSON.stringify(r.data)}`);
      return { token: r.data.token, user: r.data.user };
    },

    /** Create a member and log them in. Returns { user, token }. */
    async createMember(adminToken, { username, name, trusted = true }) {
      const created = await call("POST", "/users", {
        token: adminToken,
        body: { username, name, trusted }
      });
      if (created.status !== 201) throw new Error(`could not create ${username}: ${JSON.stringify(created.data)}`);
      const { token } = await this.login(username, created.data.tempPassword);
      return { user: created.data.user, token };
    }
  };
}
