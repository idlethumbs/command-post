import { readFileSync } from "node:fs";
import path from "node:path";
import { parseTranscript } from "../src/transcript";

const fx = (n: string) => readFileSync(path.join(__dirname, "fixtures", n), "utf8");

test("summarises the tail of a transcript", () => {
  const s = parseTranscript(fx("basic.jsonl"));
  expect(s.model).toBe("claude-opus-5-5");
  expect(s.aiTitle).toBe("Fix the thing");
  expect(s.gitBranch).toBe("main");
  expect(s.lastAssistantText?.text).toBe("Two options.\n\nWhich do you want?");
  expect(s.lastAssistantText?.at).toBe(Date.parse("2026-11-04T09:03:01.000Z"));
  expect(s.lastHumanAt).toBe(Date.parse("2026-11-04T09:01:00.000Z"));
  expect(s.awaySummary).toEqual({ text: "We're choosing a backfill.", at: Date.parse("2026-11-04T09:04:00.000Z") });
});

test("skips a line cut in half by the tail read", () => {
  const cut = '"content":"half a record"}}\n' + fx("basic.jsonl");
  expect(() => parseTranscript(cut)).not.toThrow();
  expect(parseTranscript(cut).aiTitle).toBe("Fix the thing");
});
