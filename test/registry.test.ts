import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readRegistry } from "../src/registry";
import type { ProcTable } from "../src/types";

const entry = (pid: number, procStart: string) => JSON.stringify({
  pid, sessionId: `s-${pid}`, cwd: "/p/x", kind: "interactive", entrypoint: "cli", name: `x-${pid}`,
  status: "idle", statusUpdatedAt: 1, procStart,
});

test("keeps only entries whose pid is alive with a matching start time", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reg-"));
  writeFileSync(path.join(dir, "100.json"), entry(100, "Tue Nov  3 15:28:45 2026"));
  writeFileSync(path.join(dir, "101.json"), entry(101, "Tue Nov  3 15:28:45 2026"));
  writeFileSync(path.join(dir, "102.json"), entry(102, "Tue Nov  3 15:28:45 2026"));
  writeFileSync(path.join(dir, "103.json"), "{not json");
  writeFileSync(path.join(dir, "100.abc.key"), "{}");
  const ps: ProcTable = new Map([
    [100, { ppid: 1, lstart: "Tue Nov 3 15:28:45 2026", comm: "claude" }],
    [102, { ppid: 1, lstart: "Wed Nov 4 09:00:00 2026", comm: "claude" }],
  ]);
  expect(readRegistry(dir, ps).map(e => e.pid)).toEqual([100]);
});
