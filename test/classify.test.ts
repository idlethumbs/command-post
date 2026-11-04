import { classify, modelOf } from "../src/classify";
import type { RegistryEntry, TranscriptSummary } from "../src/types";

const reg = (status: string, waitingFor?: string): RegistryEntry => ({
  pid: 1, sessionId: "s", cwd: "/p", kind: "interactive", entrypoint: "cli", name: "n",
  status, waitingFor, statusUpdatedAt: 42, procStart: "x",
});
const said = (text: string, at = 200, lastHumanAt = 100): TranscriptSummary => ({ lastAssistantText: { text, at }, lastHumanAt });

test.each([
  ["busy", undefined, {}, "cast"],
  ["waiting", "permission prompt", {}, "seal"],
  ["waiting", "input needed", {}, "counsel"],
  ["shell", undefined, {}, "cast"],
  ["idle", undefined, said("Two options. Which do you want?"), "counsel"],
  ["idle", undefined, said("Done. All tests pass."), "rest"],
  ["idle", undefined, said("Which do you want?", 50, 100), "rest"],
  ["idle", undefined, said("Shall I proceed with the commit"), "counsel"],
  ["idle", undefined, {}, "rest"],
  ["idle", undefined, said("Tick the ones you like and tell me here what you'd change."), "counsel"],
  ["idle", undefined, said("I can cherry-pick it unless you'd rather keep everything on one branch."), "counsel"],
  ["idle", undefined, said("Committed as a1b2c3d. The branch is pushed."), "rest"],
] as const)("%s/%s → %s", (status, waitingFor, t, expected) => {
  const r = classify(reg(status, waitingFor), t as TranscriptSummary);
  expect(r.state).toBe(expected);
  expect(r.since).toBe(42);
});

test("maps model ids to ranks", () => {
  expect(modelOf("claude-fable-5-1")).toBe("fable");
  expect(modelOf("claude-haiku-4-5-20251001")).toBe("haiku");
  expect(modelOf("claude-sonnet-5")).toBe("sonnet");
  expect(modelOf("claude-opus-5-5")).toBe("opus");
  expect(modelOf(undefined)).toBe("opus");
});
