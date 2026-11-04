import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES = 5;
const ID = /^[0-9a-f]{20}\.(png|jpg|gif|webp)$/;

/** Sniff the real format from magic bytes; the browser's content-type isn't trusted. */
export function imageExt(b: Buffer): "png" | "jpg" | "gif" | "webp" | undefined {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 6 && b.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return undefined;
}

/** Store an image under a content hash. Paths never contain spaces, so Claude Code turns a pasted path into an attachment. */
export function saveImage(dir: string, b: Buffer): { id: string; path: string } {
  if (b.length > MAX_IMAGE_BYTES) throw new Error("Images must be under 10 MB.");
  const ext = imageExt(b);
  if (!ext) throw new Error("Only PNG, JPEG, GIF and WebP images can be attached.");
  mkdirSync(dir, { recursive: true });
  const id = `${createHash("sha256").update(b).digest("hex").slice(0, 20)}.${ext}`, file = path.join(dir, id);
  if (!existsSync(file)) writeFileSync(file, b, { mode: 0o600 });
  return { id, path: file };
}

/** Map client-supplied ids to files we stored. Anything else is rejected, so the client can't name arbitrary paths. */
export function resolveImages(dir: string, ids: unknown): string[] {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > MAX_IMAGES) throw new Error(`Attach up to ${MAX_IMAGES} images.`);
  return ids.map(id => {
    if (typeof id !== "string" || !ID.test(id)) throw new Error("Unknown image.");
    const f = path.join(dir, id);
    if (!existsSync(f)) throw new Error("That image has expired. Paste it again.");
    return f;
  });
}

export function pruneUploads(dir: string, maxAgeMs = 7 * 24 * 3600 * 1000) {
  try { for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (ID.test(f) && Date.now() - statSync(p).mtimeMs > maxAgeMs) unlinkSync(p); } } catch { /* no uploads yet */ }
}
