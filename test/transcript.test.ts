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

test("keeps the recent exchange: your words and the mage's replies, no tool chatter", () => {
  const s = parseTranscript(fx("basic.jsonl") + JSON.stringify({ type: "user", timestamp: "2026-11-04T09:05:00.000Z", origin: { kind: "human" },
    message: { role: "user", content: [{ type: "text", text: "[Image #1] [Image #2] look at these" }, { type: "image" }, { type: "image" }] } }) + "\n");
  expect(s.recent).toEqual([
    { who: "mage", text: "Old answer.", at: Date.parse("2026-11-04T09:00:00.000Z") },
    { who: "you", text: "please fix the thing", at: Date.parse("2026-11-04T09:01:00.000Z") },
    { who: "mage", text: "Two options.\n\nWhich do you want?", at: Date.parse("2026-11-04T09:03:00.000Z") },
    { who: "you", text: "look at these", at: Date.parse("2026-11-04T09:05:00.000Z"), images: 2 },
  ]);
});

test("skips a line cut in half by the tail read", () => {
  const cut = '"content":"half a record"}}\n' + fx("basic.jsonl");
  expect(() => parseTranscript(cut)).not.toThrow();
  expect(parseTranscript(cut).aiTitle).toBe("Fix the thing");
});

test("a message sent mid-turn (queued, then absorbed) counts as yours", () => {
  const at = "2026-11-09T15:24:47.644Z";
  const t = parseTranscript([
    { type: "assistant", timestamp: "2026-11-09T15:24:40.000Z", message: { id: "m1", content: [{ type: "text", text: "Working on it." }] } },
    { type: "queue-operation", operation: "enqueue", timestamp: at, content: "also fix the footer" },
    { type: "attachment", timestamp: at, attachment: { type: "queued_command", prompt: "also fix the footer", origin: { kind: "human" }, commandMode: "prompt" } },
    { type: "attachment", timestamp: at, attachment: { type: "queued_command", prompt: "a task notification", origin: { kind: "task" } } },
  ].map(r => JSON.stringify(r)).join("\n"));
  expect(t.recent?.map(e => [e.who, e.text])).toEqual([["mage", "Working on it."], ["you", "also fix the footer"]]);
  expect(t.lastHumanAt).toBe(Date.parse(at));
});
