import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { absorbRealm, assignRealms, emptyConfig, humanize, loadConfig, R, saveConfig, updateRealm, WILDS_ID, type RealmEnv } from "../src/realms";

const repos: Record<string, string> = {
  "/p/agent-rails": "/p/agent-rails",
  "/p/agent-rails/.claude/worktrees/x": "/p/agent-rails",
  "/p/orchestration/orchestrator": "/p/orchestration/orchestrator",
  "/p/lmax-a": "/p/lmax-a", "/p/lmax-b": "/p/lmax-b",
};
const env: RealmEnv = {
  gitRoot: cwd => repos[cwd] ?? null,
  isWilds: dir => dir === "/p" || dir.startsWith("/private/tmp"),
};

test("a repo and its worktrees share one realm", () => {
  const cfg = emptyConfig();
  const m = assignRealms(["/p/agent-rails/.claude/worktrees/x", "/p/agent-rails"], cfg, env, 1);
  expect(new Set(m.values()).size).toBe(1);
  expect(cfg.realms).toHaveLength(1);
  expect(cfg.realms[0]).toMatchObject({ name: "Agent Rails", lands: ["/p/agent-rails"] });
});

test("a repo inside a non-git folder joins that folder's realm", () => {
  const cfg = emptyConfig();
  const m = assignRealms(["/p/orchestration/orchestrator", "/p/orchestration"], cfg, env, 1);
  expect(m.get("/p/orchestration/orchestrator")).toBe(m.get("/p/orchestration"));
  expect(cfg.realms).toHaveLength(1);
});

test("container folders and temp dirs go to the Wilds", () => {
  const cfg = emptyConfig();
  const m = assignRealms(["/p", "/private/tmp/claude-1/scratch"], cfg, env, 1);
  expect(m.get("/p")).toBe(WILDS_ID);
  expect(m.get("/private/tmp/claude-1/scratch")).toBe(WILDS_ID);
});

test("a merged realm captures every land it lists", () => {
  const cfg = emptyConfig();
  assignRealms(["/p/lmax-a", "/p/lmax-b"], cfg, env, 1);
  const [a, b] = cfg.realms;
  absorbRealm(cfg, a.id, b.id);
  expect(cfg.realms).toHaveLength(1);
  const m = assignRealms(["/p/lmax-a", "/p/lmax-b"], cfg, env, 2);
  expect(new Set(m.values())).toEqual(new Set([a.id]));
});

test("defaults are deterministic and realms are spread out", () => {
  const c1 = emptyConfig(), c2 = emptyConfig();
  assignRealms(["/p/lmax-a"], c1, env, 1); assignRealms(["/p/lmax-a"], c2, env, 1);
  expect(c1.realms[0].landmark).toBe(c2.realms[0].landmark);
  expect(c1.realms[0].banner).toBe(c2.realms[0].banner);
  const many = emptyConfig();
  const cwds = Array.from({ length: 40 }, (_, i) => `/p/r${i}`);
  assignRealms(cwds, many, { gitRoot: c => c, isWilds: () => false }, 1);
  const ps = many.realms.map(r => r.pos);
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++)
    expect(Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y)).toBeGreaterThanOrEqual(2 * R - 1e-6);
});

test("updates are validated and config round-trips through disk", () => {
  const cfg = emptyConfig();
  assignRealms(["/p/lmax-a"], cfg, env, 1);
  const id = cfg.realms[0].id;
  updateRealm(cfg, id, { name: "LMAX", landmark: "spire", banner: "#b884f0" });
  expect(() => updateRealm(cfg, id, { landmark: "moonbase" })).toThrow();
  const dir = mkdtempSync(path.join(tmpdir(), "arc-"));
  saveConfig(dir, cfg);
  expect(loadConfig(dir).realms[0]).toMatchObject({ name: "LMAX", landmark: "spire" });
  expect(loadConfig(path.join(dir, "missing")).realms).toEqual([]);
});

test("humanize", () => { expect(humanize("genui-module")).toBe("Genui Module"); expect(humanize("prism")).toBe("Prism"); });
