import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync } from "node:fs";
import path from "node:path";
import type { Exchange, TranscriptSummary } from "./types";

const RECENT = 12, CLIP = 1500;
const clip = (t: string) => t.length > CLIP ? t.slice(0, CLIP) + "…" : t;

const textOf = (content: unknown): string | undefined => {
  if (!Array.isArray(content)) return undefined;
  const parts = content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text.trim()).filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
};

/** Summarise transcript records. Input is usually a tail read, so the first line may be partial. */
export function parseTranscript(text: string): TranscriptSummary {
  const s: TranscriptSummary = {};
  let lastTextMsgId: string | undefined;
  const recent: Exchange[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r: any;
    try { r = JSON.parse(line); } catch { continue; }
    const at = r.timestamp ? Date.parse(r.timestamp) : undefined;
    if (r.gitBranch) s.gitBranch = r.gitBranch;
    if (r.type === "assistant" && r.message) {
      if (r.message.model) s.model = r.message.model;
      const t = textOf(r.message.content);
      if (t) {
        const prev = s.lastAssistantText;
        const same = prev && lastTextMsgId === r.message.id;
        s.lastAssistantText = { text: same ? `${prev!.text}\n\n${t}` : t, at: at ?? prev?.at ?? 0 };
        const last = recent.at(-1);
        if (same && last?.who === "mage") last.text = clip(s.lastAssistantText.text);
        else recent.push({ who: "mage", text: clip(t), at: at ?? 0 });
        lastTextMsgId = r.message.id;
      }
    } else if (r.type === "user" && r.message) {
      const human = r.origin?.kind === "human" || (!r.origin && !r.isMeta && typeof r.message.content === "string");
      if (human && at) {
        s.lastHumanAt = at;
        const c = r.message.content;
        const text = typeof c === "string" ? c : textOf(c) ?? "";
        const images = Array.isArray(c) ? c.filter((b: any) => b?.type === "image").length : 0;
        if (text.trim() || images) recent.push({ who: "you", text: clip(text.replace(/\[Image #\d+\]\s*/g, "").trim()), at, ...(images ? { images } : {}) });
      }
    } else if (r.type === "ai-title" && r.aiTitle) {
      s.aiTitle = r.aiTitle;
    } else if (r.type === "system" && r.subtype === "away_summary" && typeof r.content === "string") {
      s.awaySummary = { text: r.content, at: at ?? 0 };
    }
  }
  if (recent.length) s.recent = recent.slice(-RECENT);
  return s;
}

const located = new Map<string, string>();
export function findTranscript(claudeDir: string, sessionId: string): string | undefined {
  const hit = located.get(sessionId);
  if (hit && existsSync(hit)) return hit;
  const root = path.join(claudeDir, "projects");
  let dirs: string[] = [];
  try { dirs = readdirSync(root); } catch { return undefined; }
  for (const d of dirs) {
    const f = path.join(root, d, `${sessionId}.jsonl`);
    if (existsSync(f)) { located.set(sessionId, f); return f; }
  }
  return undefined;
}

/** Read the last `bytes` of a file. Transcripts reach tens of MB, so never read them whole. */
export function readTail(file: string, bytes = 512 * 1024): string {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size, len = Math.min(size, bytes), buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally { closeSync(fd); }
}
