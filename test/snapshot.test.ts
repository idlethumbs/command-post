import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSnapshot, briefingOf } from "../src/snapshot";
import type { ProcTable } from "../src/types";

function world() {
  const claude = mkdtempSync(path.join(tmpdir(), "claude-")), arcanum = mkdtempSync(path.join(tmpdir(), "arc-"));
  mkdirSync(path.join(claude, "sessions")); mkdirSync(path.join(claude, "projects", "-p-agent-rails"), { recursive: true });
  writeFileSync(path.join(claude, "sessions", "300.json"), JSON.stringify({
    pid: 300, sessionId: "abc", cwd: "/p/agent-rails", kind: "interactive", entrypoint: "cli", name: "agent-rails-e4",
    status: "idle", statusUpdatedAt: 1000, procStart: "Tue Nov  3 15:29:00 2026", version: "2.1.280",
  }));
  writeFileSync(path.join(claude, "projects", "-p-agent-rails", "abc.jsonl"), readFileSync(path.join(__dirname, "fixtures", "basic.jsonl")));
  const ps: ProcTable = new Map([
    [100, { ppid: 1, lstart: "x", comm: "/Applications/cmux.app/Contents/MacOS/cmux" }],
    [300, { ppid: 100, lstart: "Tue Nov 3 15:29:00 2026", comm: "claude" }],
  ]);
  const env = { gitRoot: (c: string) => c, isWilds: () => false };
  return { claude, arcanum, ps, env };
}

test("builds realms and mages from the registry and transcripts", () => {
  const w = world();
  const snap = buildSnapshot({ claudeDir: w.claude, arcanumDir: w.arcanum, ps: w.ps, env: w.env, now: 5 });
  expect(snap.realms).toHaveLength(1);
  expect(snap.sessions).toHaveLength(1);
  expect(snap.sessions[0]).toMatchObject({
    id: "abc", name: "agent-rails-e4", realmId: snap.realms[0].id, model: "opus", state: "counsel",
    host: "cmux", where: "cmux", title: "Fix the thing", branch: "main", briefing: "We're choosing a backfill.",
  });
  expect(existsSync(path.join(w.arcanum, "realms.json"))).toBe(true);
  const again = buildSnapshot({ claudeDir: w.claude, arcanumDir: w.arcanum, ps: w.ps, env: w.env, now: 6 });
  expect(again.realms.map(r => r.id)).toEqual(snap.realms.map(r => r.id));
});

test("a parked session rests and points at the background job doing its work", () => {
  const w = world();
  writeFileSync(path.join(w.claude, "sessions", "300.json"), JSON.stringify({
    pid: 300, sessionId: "abc", cwd: "/p/agent-rails", kind: "interactive", entrypoint: "cli", name: "agent-rails-e4",
    status: "busy", statusUpdatedAt: 1000, procStart: "Tue Nov  3 15:29:00 2026", parkedJobId: "481d6b12",
  }));
  writeFileSync(path.join(w.claude, "sessions", "301.json"), JSON.stringify({
    pid: 301, sessionId: "481d6b12-0000", cwd: "/p/agent-rails", kind: "bg", entrypoint: "cli", name: "Tutorial work", jobId: "481d6b12",
    status: "busy", statusUpdatedAt: 2000, procStart: "Tue Nov  3 15:29:00 2026",
  }));
  w.ps.set(301, { ppid: 1, lstart: "Tue Nov 3 15:29:00 2026", comm: "claude" });
  const snap = buildSnapshot({ claudeDir: w.claude, arcanumDir: w.arcanum, ps: w.ps, env: w.env, now: 5 });
  const parked = snap.sessions.find(s => s.id === "abc")!, bg = snap.sessions.find(s => s.jobId === "481d6b12")!;
  expect(parked.state).toBe("rest");
  expect(parked.note).toBe("Handed its work to the background mage “Tutorial work”.");
  expect(bg).toMatchObject({ host: "bg", state: "cast", portal: "none" });
});

test("briefing prefers a fresh away summary, then the opening of the last reply", () => {
  expect(briefingOf({ awaySummary: { text: "Recap.", at: 10 }, lastHumanAt: 5 })).toBe("Recap.");
  expect(briefingOf({ awaySummary: { text: "Stale.", at: 1 }, lastHumanAt: 5, lastAssistantText: { text: "Both evals are done. Shall I commit?", at: 9 } })).toBe("Both evals are done.");
  expect(briefingOf({ aiTitle: "Fix the thing" })).toBe("Fix the thing");
  expect(briefingOf({})).toBe("No word yet.");
});
