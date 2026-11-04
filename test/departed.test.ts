import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findEnded } from "../src/departed";

const rec = (o: object) => JSON.stringify(o) + "\n";
function claudeDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "claude-")), proj = path.join(dir, "projects", "-p-x");
  mkdirSync(proj, { recursive: true });
  const put = (id: string, lines: string, ageDays = 0) => {
    const f = path.join(proj, `${id}.jsonl`); writeFileSync(f, lines);
    const t = (Date.now() - ageDays * 864e5) / 1000; utimesSync(f, t, t);
  };
  const human = (cwd: string, entrypoint = "cli") => rec({ type: "user", cwd, entrypoint, timestamp: "2026-11-04T09:00:00Z", origin: { kind: "human" }, message: { role: "user", content: "hi" } });
  put("11111111-1111-1111-1111-111111111111", human("/p/x"));                               // real, recent → kept
  put("22222222-2222-2222-2222-222222222222", human("/p/x"), 5);                            // too old
  put("33333333-3333-3333-3333-333333333333", human("/p/x"));                               // still alive
  put("44444444-4444-4444-4444-444444444444", human("/p/x", "sdk-cli"));                    // headless run
  put("55555555-5555-5555-5555-555555555555", human("/private/tmp/scratch"));               // temp folder
  put("66666666-6666-6666-6666-666666666666", rec({ type: "assistant", cwd: "/p/x", entrypoint: "cli", message: { id: "m", content: [{ type: "text", text: "x" }] } })); // nobody spoke, no title
  return dir;
}

test("only recent, ended, interactive conversations count as departed", () => {
  const ended = findEnded(claudeDir(), new Set(["33333333-3333-3333-3333-333333333333"]));
  expect(ended.map(e => e.id)).toEqual(["11111111-1111-1111-1111-111111111111"]);
  expect(ended[0].t.cwd).toBe("/p/x");
});
