import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dismiss, loadDismissed, restore } from "../src/dismissed";
import { planSummon, shellQuote } from "../src/summon";
import type { Realm } from "../src/types";

test("dismissed mages persist until restored", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "arc-"));
  dismiss(dir, { id: "s1", name: "genui-module-4b", realmId: "genui-module" }, 100);
  expect(loadDismissed(dir)).toEqual({ s1: { name: "genui-module-4b", realmId: "genui-module", at: 100 } });
  restore(dir, "s1");
  expect(loadDismissed(dir)).toEqual({});
  expect(loadDismissed(path.join(dir, "nope"))).toEqual({});
});

test("shell quoting survives quotes, $ and newlines", () => {
  expect(shellQuote("it's $HOME `x`\nnext")).toBe("'it'\\''s $HOME `x`\nnext'");
});

const land = mkdtempSync(path.join(tmpdir(), "land-"));
const realm: Realm = { id: "agent-rails", name: "Agent Rails", lands: [land, "/does/not/exist"], landmark: "castle", banner: "#ef5470", pos: { x: 0, y: 0 }, discoveredAt: 1 };
const cmux = { bin: "/bin/cmux", app: "/Apps/cmux.app" };

test("summon opens a cmux workspace running claude with the chosen rank", () => {
  const p = planSummon(realm, { model: "sonnet", land, prompt: "Review the open PR's tests", focus: true }, cmux);
  if ("error" in p) throw new Error(p.error);
  expect(p.steps[0]).toEqual({ cmd: "/bin/cmux", args: ["new-workspace", "--name", "Agent Rails · Magician", "--cwd", land, "--command", "claude --model sonnet 'Review the open PR'\\''s tests'", "--focus", "true"] });
  expect(p.steps[1]).toEqual({ cmd: "open", args: ["-a", "/Apps/cmux.app"] });
  const quiet = planSummon(realm, { model: "fable", land, focus: false }, cmux);
  if ("error" in quiet) throw new Error(quiet.error);
  expect(quiet.steps).toHaveLength(1);
  expect(quiet.steps[0].args).toContain("claude --model fable");
});

test("summon refuses folders outside the realm, missing folders, unknown models and the wilds", () => {
  expect(planSummon(realm, { model: "sonnet", land: "/etc", focus: true }, cmux)).toEqual({ error: "That folder isn't one of Agent Rails's lands." });
  expect(planSummon(realm, { model: "sonnet", land: "/does/not/exist", focus: true }, cmux)).toEqual({ error: "That folder no longer exists." });
  expect(planSummon(realm, { model: "gpt" as any, land, focus: true }, cmux)).toEqual({ error: "Pick a rank: Apprentice, Magician, Sorcerer or Archmage." });
  expect(planSummon({ ...realm, lands: [] }, { model: "sonnet", land, focus: true }, cmux)).toMatchObject({ error: expect.stringMatching(/no lands/) });
  expect(planSummon(realm, { model: "sonnet", land, focus: true }, undefined)).toMatchObject({ error: expect.stringMatching(/cmux/) });
});
