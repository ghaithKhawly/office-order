/*
 * Menu photo storage.
 *
 * Deliberately *not* OCR. Arabic menu photos with stylised fonts and a right
 * aligned price column break Tesseract badly enough that you end up correcting
 * half the rows anyway, and the model is 20+ MB of vendored weight that has to
 * survive being copied to an offline machine. Showing the photo next to the
 * grid while someone types is faster and never wrong.
 *
 * Files land in DATA_DIR/uploads under a name we generate. They are served
 * through an authenticated route, never a static directory, so a photo of a
 * menu with a phone number on it is not readable by anyone who guesses a URL.
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db.js";

export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* 12 MB. A phone photo of a menu is 2–5 MB; this leaves room without letting
   someone fill the disk on a machine nobody is watching. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/*
 * Whitelist by what the bytes actually are, not by what the client claims.
 * A Content-Type header is a suggestion; the magic number is evidence.
 */
const SIGNATURES = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/gif", ext: "gif",
    test: (b) => b.slice(0, 4).toString("latin1") === "GIF8" },
  { mime: "image/webp", ext: "webp",
    test: (b) => b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP" }
];

export const ALLOWED_MIMES = SIGNATURES.map((s) => s.mime);

/** Identify an image from its leading bytes. Returns null if it isn't one we allow. */
export function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return SIGNATURES.find((s) => s.test(buffer)) || null;
}

/**
 * Build the stored filename ourselves. The client's filename never touches the
 * filesystem — it is kept only to show the admin which photo is which.
 */
export function storedName(id, ext) {
  return `${id}.${ext}`;
}

/** Resolve a stored name to an absolute path, refusing anything that escapes the directory. */
export function uploadPath(name) {
  const full = path.join(UPLOADS_DIR, path.basename(String(name)));
  const rel = path.relative(UPLOADS_DIR, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("upload path escaped the uploads directory");
  }
  return full;
}

/** Keep a display name that is safe to render and short enough to fit a row. */
export function cleanOriginalName(raw) {
  return String(raw || "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[/\\]/g, "-")
    .trim()
    .slice(0, 120);
}
