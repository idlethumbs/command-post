import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { infoPlist, launcherScript } from "../src/launcher";

const opts = { repo: "/Users/me/it's here", node: "/opt/node/bin/node", pathEnv: "/opt/node/bin:/usr/bin:/bin", port: 7999 };

test("the launcher quotes paths safely and is valid bash", () => {
  const s = launcherScript(opts);
  expect(s).toContain(`REPO='/Users/me/it'\\''s here'`);
  expect(s).toContain("URL='http://127.0.0.1:7999'");
  expect(s).toContain("export ARCANUM_PORT=7999");
  const f = path.join(mkdtempSync(path.join(os.tmpdir(), "arc-")), "Arcanum");
  writeFileSync(f, s);
  execFileSync("bash", ["-n", f]);
});

test("the launcher only starts the daemon when nothing answers, and prefers an existing window", () => {
  const s = launcherScript(opts);
  expect(s.indexOf("if ! up; then")).toBeLessThan(s.indexOf("nohup"));
  expect(s.indexOf("starts with")).toBeLessThan(s.indexOf("--app="));
});

test("the bundle's plist is well formed", () => {
  const f = path.join(mkdtempSync(path.join(os.tmpdir(), "arc-")), "Info.plist");
  writeFileSync(f, infoPlist());
  expect(execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", f], { encoding: "utf8" }).trim()).toBe("Arcanum");
});
