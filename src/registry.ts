import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { normStart } from "./procs";
import type { ProcTable, RegistryEntry } from "./types";

/** Live entries of ~/.claude/sessions: records can outlive their process, so pid + start time must match ps. */
export function readRegistry(dir: string, ps: ProcTable): RegistryEntry[] {
  let files: string[] = [];
  try { files = readdirSync(dir).filter(f => /^\d+\.json$/.test(f)); } catch { return []; }
  const out: RegistryEntry[] = [];
  for (const f of files) {
    let e: RegistryEntry;
    try { e = JSON.parse(readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    if (!e?.sessionId || !e.procStart) continue;
    const p = ps.get(e.pid);
    if (p && p.lstart === normStart(e.procStart)) out.push(e);
  }
  return out.sort((a, b) => a.pid - b.pid);
}
