import { manaOf } from "../src/mana";
import { parseTranscript } from "../src/transcript";

const turn = (tokens: { in: number; read: number; make: number; out: number }, side = false) => JSON.stringify({
  type: "assistant", isSidechain: side, timestamp: "2026-11-06T10:00:00Z",
  message: { id: Math.random().toString(), model: "claude-opus-5-5", content: [], usage: { input_tokens: tokens.in, cache_read_input_tokens: tokens.read, cache_creation_input_tokens: tokens.make, output_tokens: tokens.out } },
}) + "\n";

test("context is the last main-thread turn's input + cache + output, with the peak kept", () => {
  const t = parseTranscript(turn({ in: 2, read: 300_000, make: 1_000, out: 500 }) + turn({ in: 5, read: 40_000, make: 0, out: 100 }) + turn({ in: 1, read: 900_000, make: 0, out: 1 }, true));
  expect(t.context).toEqual({ tokens: 40_105, peak: 301_502, at: Date.parse("2026-11-06T10:00:00Z") });
});

test("the window is 1M after passing 200k or when your default is that family with [1m]; else 200k", () => {
  const ctx = (tokens: number, peak = tokens) => ({ context: { tokens, peak, at: 0 } });
  expect(manaOf(ctx(40_105, 301_502), "sonnet")).toMatchObject({ window: 1_000_000, pct: 4 });
  expect(manaOf(ctx(150_000), "opus", "opus[1m]")).toMatchObject({ window: 1_000_000, pct: 15 });
  expect(manaOf(ctx(150_000), "haiku", "opus[1m]")).toMatchObject({ window: 200_000, pct: 75 });
  expect(manaOf(ctx(250_000, 250_000), "haiku")).toMatchObject({ window: 1_000_000, pct: 25 });
  expect(manaOf({}, "opus")).toBeUndefined();
});
