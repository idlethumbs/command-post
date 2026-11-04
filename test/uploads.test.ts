import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { imageExt, resolveImages, saveImage } from "../src/uploads";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

test("sniffs formats from bytes, not names", () => {
  expect(imageExt(PNG)).toBe("png");
  expect(imageExt(Buffer.from("ffd8ffe000104a46", "hex"))).toBe("jpg");
  expect(imageExt(Buffer.from("<svg onload=alert(1)>"))).toBeUndefined();
});

test("stores by content hash at a space-free path, and only resolves its own ids", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "up-"));
  const a = saveImage(dir, PNG), b = saveImage(dir, PNG);
  expect(a).toEqual(b);
  expect(a.path).not.toMatch(/\s/);
  expect(readFileSync(a.path).equals(PNG)).toBe(true);
  expect(resolveImages(dir, [a.id])).toEqual([a.path]);
  expect(() => resolveImages(dir, ["../../etc/passwd"])).toThrow("Unknown image");
  expect(() => resolveImages(dir, ["0123456789abcdef0123.png"])).toThrow(/expired/);
  expect(() => saveImage(dir, Buffer.from("not an image"))).toThrow(/PNG, JPEG/);
});
