import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { modelOf } from "./classify";
import { parseTranscript, readTail } from "./transcript";
import type { TranscriptSummary } from "./types";

export const DEPARTED_DAYS = 3;
const INTERACTIVE = new Set(["cli", "claude-vscode", "claude-desktop"]);
const TEMP = ["/tmp/", "/private/tmp/", "/private/var/folders/", os.tmpdir() + "/"];

export interface EndedSession { id: string; file: string; endedAt: number; t: TranscriptSummary }

const cache = new Map<string, { mtime: number; t: TranscriptSummary }>();

/**
 * Conversations that ended recently: transcripts touched in the last few days with no live process.
 * Only real conversations (interactive, with your words or a title), never headless runs or temp scratch folders.
 */
export function findEnded(claudeDir: string, liveIds: Set<string>, now = Date.now(), days = DEPARTED_DAYS): EndedSession[] {
  const root = path.join(claudeDir, "projects"), cutoff = now - days * 864e5, out: EndedSession[] = [];
  let dirs: string[] = [];
  try { dirs = readdirSync(root); } catch { return out; }
  for (const d of dirs) {
    let files: string[] = [];
    try { files = readdirSync(path.join(root, d)).filter(f => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) {
      const id = f.slice(0, -6);
      if (liveIds.has(id) || !/^[0-9a-f-]{36}$/.test(id)) continue;
      const file = path.join(root, d, f);
      let mtime: number;
      try { mtime = statSync(file).mtimeMs; } catch { continue; }
      if (mtime < cutoff) continue;
      let hit = cache.get(file);
      if (!hit || hit.mtime !== mtime) {
        try { hit = { mtime, t: parseTranscript(readTail(file, 256 * 1024)) }; cache.set(file, hit); } catch { continue; }
      }
      const t = hit.t;
      if (!t.cwd || TEMP.some(p => (t.cwd + "/").startsWith(p))) continue;
      if (t.entrypoint && !INTERACTIVE.has(t.entrypoint)) continue;
      if (t.lastHumanAt === undefined && !t.aiTitle) continue;
      out.push({ id, file, endedAt: mtime, t });
    }
  }
  return out.sort((a, b) => b.endedAt - a.endedAt);
}

export const departedName = (e: EndedSession) => `${path.basename(e.t.cwd!)}-${e.id.slice(0, 4)}`;
export const departedModel = (e: EndedSession) => modelOf(e.t.model);
