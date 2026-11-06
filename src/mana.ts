import { readFileSync } from "node:fs";
import path from "node:path";
import type { Mana, Model, TranscriptSummary } from "./types";

const K200 = 200_000, M1 = 1_000_000;

/** The default model from ~/.claude/settings.json, e.g. "opus[1m]". */
export function defaultModel(claudeDir: string): string | undefined {
  try { return JSON.parse(readFileSync(path.join(claudeDir, "settings.json"), "utf8")).model; } catch { return undefined; }
}

/**
 * How full the context window is. Transcripts record tokens per turn but not the window size, so it's inferred:
 * 1M if the session ever went past 200k, or if your default model is that family with [1m]; otherwise 200k.
 */
export function manaOf(t: TranscriptSummary, model: Model, defaultModelSetting?: string): Mana | undefined {
  if (!t.context) return undefined;
  const oneM = t.context.peak > K200 || (!!defaultModelSetting && /\[1m\]/i.test(defaultModelSetting) && defaultModelSetting.toLowerCase().includes(model));
  const window = oneM ? M1 : K200;
  return { used: t.context.tokens, window, pct: Math.min(100, Math.round((t.context.tokens / window) * 100)), inferred: true };
}
