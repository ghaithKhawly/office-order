#!/usr/bin/env node
/*
 * check:offline — the regression guard for "zero network calls at runtime".
 *
 * The app is deployed to a Windows box on a closed office LAN. Anything the
 * browser tries to fetch from the internet does not fail fast, it hangs: the
 * page half-renders, Arabic drops to a system font, and nobody on site can
 * diagnose it. So the build refuses to produce a bundle that references an
 * external host at all.
 *
 * Scans web/dist for absolute URLs and known CDN hostnames. Localhost and
 * private-LAN addresses are allowed — those resolve on the office network.
 * Exits non-zero with file:line for every offender.
 *
 * Run directly (`node scripts/check-offline.mjs`) to scan an existing build,
 * or via `npm run check:offline` to rebuild first. `npm run build` runs it too,
 * so a bad reference cannot reach dist unnoticed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "web", "dist");

/* Files whose bytes a browser actually parses. Fonts/images can't carry URLs
   we'd follow, and .map files are dev-only and not shipped by our build. */
const SCANNABLE = new Set([".html", ".css", ".js", ".mjs", ".json", ".svg", ".webmanifest", ".txt"]);

/* Hosts that are fine: they live on the office LAN or are loopback. */
const ALLOWED_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/i;

/*
 * URLs that appear in the bundle but are never fetched. Each one is an inert
 * string, not a request. Keep this list short and justified — it is the only
 * way past the guard, so anything added here should be something you have
 * actually confirmed the browser does not go and get.
 */
const ALLOWED_URLS = [
  // XML namespace URIs. These are identifiers used by the DOM to distinguish
  // SVG/MathML/XHTML elements. The browser never dereferences them; React and
  // lucide-react emit them for every <svg> they create.
  { pattern: /^https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml|1999\/xlink|XML\/1998\/namespace|1998\/Math\/MathML)/i,
    why: "XML namespace identifier, never dereferenced" },
  // React's minified-error explainer. React concatenates this into the message
  // of an Error it throws; it is shown as text, not requested. Removing it
  // would mean patching React itself.
  { pattern: /^https?:\/\/reactjs\.org\/docs\/error-decoder\.html/i,
    why: "React error message text, not a request" }
];

const isAllowedUrl = (url) => ALLOWED_URLS.some((a) => a.pattern.test(url));

/* Bare CDN hostnames, caught even without a scheme (e.g. in a comment or a
   protocol-relative //fonts.gstatic.com/... reference). */
const CDN_HOSTS = [
  "fonts.googleapis.com", "fonts.gstatic.com", "ajax.googleapis.com",
  "unpkg.com", "cdn.jsdelivr.net", "jsdelivr.net", "cdnjs.cloudflare.com",
  "cdn.skypack.dev", "esm.sh", "googletagmanager.com", "google-analytics.com"
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function scanText(text, file) {
  const problems = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    // Absolute URLs with a scheme.
    for (const m of line.matchAll(/\bhttps?:\/\/([^\s"'`)>\\\]},;]+)/gi)) {
      const host = m[1].split(/[/?#]/)[0];
      if (!ALLOWED_HOST.test(host) && !isAllowedUrl(m[0])) {
        problems.push({ file, line: i + 1, match: m[0].slice(0, 120), why: `external host ${host}` });
      }
    }
    // Protocol-relative URLs: //example.com/x — but not a // comment or a path.
    for (const m of line.matchAll(/(?<![:\w/])\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/"'`\s)]|$)/gi)) {
      if (!ALLOWED_HOST.test(m[1])) {
        problems.push({ file, line: i + 1, match: m[0].slice(0, 120), why: `protocol-relative ${m[1]}` });
      }
    }
    // Bare CDN hostnames with no scheme at all.
    for (const host of CDN_HOSTS) {
      if (line.toLowerCase().includes(host)) {
        problems.push({ file, line: i + 1, match: host, why: `CDN hostname ${host}` });
      }
    }
  });

  return problems;
}

if (!fs.existsSync(DIST)) {
  console.error("check:offline — web/dist does not exist. Run `npm run build` first.");
  process.exit(2);
}

const files = walk(DIST);
if (files.length === 0) {
  console.error("check:offline — web/dist is empty. Run `npm run build` first.");
  process.exit(2);
}

let problems = [];
let scanned = 0;
for (const file of files) {
  if (!SCANNABLE.has(path.extname(file).toLowerCase())) continue;
  scanned++;
  problems.push(...scanText(fs.readFileSync(file, "utf8"), path.relative(DIST, file)));
}

/* The fonts must actually be there — a vendored @font-face pointing at a file
   that didn't ship is the same bug wearing a different hat. */
const fontDir = path.join(DIST, "fonts");
const fonts = fs.existsSync(fontDir) ? fs.readdirSync(fontDir).filter((f) => f.endsWith(".woff2")) : [];
if (fonts.length === 0) {
  problems.push({ file: "fonts/", line: 0, match: "(missing)", why: "no .woff2 files in dist/fonts" });
}

/* Every url(...) a stylesheet points at must resolve inside dist. */
for (const file of files.filter((f) => f.endsWith(".css"))) {
  const css = fs.readFileSync(file, "utf8");
  for (const m of css.matchAll(/url\(\s*['"]?(\/[^'")]+)['"]?\s*\)/g)) {
    const asset = path.join(DIST, m[1].replace(/^\//, ""));
    if (!fs.existsSync(asset)) {
      problems.push({
        file: path.relative(DIST, file), line: 0, match: m[1],
        why: "stylesheet references an asset that is not in dist"
      });
    }
  }
}

if (problems.length > 0) {
  console.error(`\ncheck:offline FAILED — ${problems.length} external reference(s) in web/dist:\n`);
  for (const p of problems) {
    console.error(`  ${p.file}${p.line ? ":" + p.line : ""}  ${p.why}`);
    console.error(`      ${p.match}`);
  }
  console.error(`
Every byte the browser needs must ship with the app. Vendor the asset into
web/public/ and reference it with a root-relative path (/fonts/x.woff2).
`);
  process.exit(1);
}

console.log(`check:offline OK — ${scanned} file(s) scanned, ${fonts.length} vendored font(s), no external references.`);
