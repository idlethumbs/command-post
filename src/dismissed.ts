import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Mages you've dismissed from Arcanum. The sessions keep running; Arcanum just stops showing them. */
export type Dismissed = Record<string, { name: string; realmId: string; at: number }>;

const file = (dir: string) => path.join(dir, "dismissed.json");

export function loadDismissed(dir: string): Dismissed {
  try { const d = JSON.parse(readFileSync(file(dir), "utf8")); return d && typeof d === "object" ? d : {}; } catch { return {}; }
}
function save(dir: string, d: Dismissed) {
  mkdirSync(dir, { recursive: true });
  const tmp = `${file(dir)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(d, null, 2) + "\n");
  renameSync(tmp, file(dir));
}
export function dismiss(dir: string, s: { id: string; name: string; realmId: string }, now = Date.now()) {
  const d = loadDismissed(dir); d[s.id] = { name: s.name, realmId: s.realmId, at: now }; save(dir, d);
}
export function restore(dir: string, id: string) {
  const d = loadDismissed(dir); delete d[id]; save(dir, d);
}
