import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Realm } from "./types";

export const LANDMARKS = ["castle", "tower", "grove", "cavern", "volcano", "pyramid", "spire", "village"] as const;
export const BANNERS = ["#ef5470", "#74e0f7", "#f2c14e", "#b884f0", "#7fd18a", "#ff9a3c", "#f0e4c4"];
export const WILDS_ID = "wilds";
export const R = 70; // realm radius in world px; realms are placed at least 2R apart

export interface Config { version: 1; realms: Realm[] }
export interface RealmEnv { gitRoot(cwd: string): string | null; isWilds(dir: string): boolean }

export const emptyConfig = (): Config => ({ version: 1, realms: [] });
export const humanize = (s: string) => s.split(/[-_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

function fnv(s: string) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const within = (dir: string, land: string) => dir === land || dir.startsWith(land.endsWith("/") ? land : land + "/");

/** Pack realms tightly: try slots in a ring around every existing realm, take the free one nearest the centre (wide aspect). */
function place(existing: { x: number; y: number }[]) {
  if (!existing.length) return { x: 0, y: 0 };
  let best: { x: number; y: number } | undefined, bestScore = Infinity;
  for (const p of existing) for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, x = Math.round(p.x + Math.cos(a) * 2.05 * R), y = Math.round(p.y + Math.sin(a) * 2.05 * R);
    if (!existing.every(q => Math.hypot(q.x - x, q.y - y) >= 2 * R)) continue;
    const score = Math.hypot(x * 0.72, y);
    if (score < bestScore) { bestScore = score; best = { x, y }; }
  }
  return best!;
}

function realmFor(root: string, cfg: Config): Realm | undefined {
  let best: Realm | undefined, bestLen = -1;
  for (const r of cfg.realms) for (const l of r.lands) if (within(root, l) && l.length > bestLen) { best = r; bestLen = l.length; }
  return best;
}

/** Prefer a landmark no realm has yet, so realms are easy to tell apart; repeat only once all are taken. */
function freshLandmark(cfg: Config, h: number) {
  const used = new Set(cfg.realms.map(r => r.landmark));
  for (let i = 0; i < LANDMARKS.length; i++) { const l = LANDMARKS[(h + i) % LANDMARKS.length]; if (!used.has(l)) return l; }
  return LANDMARKS[h % LANDMARKS.length];
}

function newRealm(cfg: Config, root: string, now: number): Realm {
  const h = fnv(root), base = humanize(path.basename(root)) || "Realm";
  let id = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, "-") || "realm";
  while (cfg.realms.some(r => r.id === id)) id += "-" + (h % 97);
  const r: Realm = { id, name: base, lands: [root], landmark: freshLandmark(cfg, h), banner: BANNERS[(h >>> 3) % BANNERS.length], pos: place(cfg.realms.map(x => x.pos)), discoveredAt: now };
  cfg.realms.push(r);
  return r;
}

function wilds(cfg: Config, now: number): Realm {
  let w = cfg.realms.find(r => r.id === WILDS_ID);
  if (!w) { w = { id: WILDS_ID, name: "The Wilds", lands: [], landmark: freshLandmark(cfg, 2), banner: "#a39bcb", pos: place(cfg.realms.map(x => x.pos)), discoveredAt: now }; cfg.realms.push(w); }
  return w;
}

/** Map each cwd to a realm id, creating realms for newly discovered lands (mutates cfg). */
export function assignRealms(cwds: string[], cfg: Config, env: RealmEnv, now = Date.now()): Map<string, string> {
  const roots = [...new Set(cwds)].map(cwd => ({ cwd, root: env.gitRoot(cwd) ?? cwd })).sort((a, b) => a.root.length - b.root.length);
  const out = new Map<string, string>();
  for (const { cwd, root } of roots) {
    const hit = realmFor(root, cfg);
    if (hit) out.set(cwd, hit.id);
    else if (env.gitRoot(cwd) === null && env.isWilds(root)) out.set(cwd, wilds(cfg, now).id);
    else out.set(cwd, newRealm(cfg, root, now).id);
  }
  return out;
}

export function updateRealm(cfg: Config, id: string, patch: Partial<Pick<Realm, "name" | "landmark" | "banner">>) {
  const r = cfg.realms.find(x => x.id === id);
  if (!r) throw new Error(`No realm called ${id}`);
  if (patch.landmark !== undefined && !(LANDMARKS as readonly string[]).includes(patch.landmark)) throw new Error(`Unknown landmark ${patch.landmark}`);
  if (patch.banner !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.banner)) throw new Error(`Banner must be a #rrggbb colour`);
  if (patch.name !== undefined) { const n = patch.name.trim(); if (!n || n.length > 60) throw new Error("Name must be 1–60 characters"); r.name = n; }
  if (patch.landmark) r.landmark = patch.landmark;
  if (patch.banner) r.banner = patch.banner;
  return r;
}

export function absorbRealm(cfg: Config, intoId: string, otherId: string) {
  if (intoId === otherId || intoId === WILDS_ID || otherId === WILDS_ID) throw new Error("Those realms can't be merged");
  const into = cfg.realms.find(r => r.id === intoId), other = cfg.realms.find(r => r.id === otherId);
  if (!into || !other) throw new Error("No such realm");
  into.lands = [...new Set([...into.lands, ...other.lands])];
  cfg.realms = cfg.realms.filter(r => r !== other);
  return into;
}

export function loadConfig(dir: string): Config {
  try {
    const c = JSON.parse(readFileSync(path.join(dir, "realms.json"), "utf8"));
    return c?.version === 1 && Array.isArray(c.realms) ? c : emptyConfig();
  } catch { return emptyConfig(); }
}

export function saveConfig(dir: string, cfg: Config) {
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "realms.json"), tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
  renameSync(tmp, f);
}

/* real environment */
const gitCache = new Map<string, string | null>();
export const realEnv: RealmEnv = {
  gitRoot(cwd) {
    if (gitCache.has(cwd)) return gitCache.get(cwd)!;
    let root: string | null = null;
    try {
      const common = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      root = path.basename(common) === ".git" ? path.dirname(common) : execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { root = null; }
    gitCache.set(cwd, root);
    return root;
  },
  isWilds(dir) {
    const home = os.homedir(), tmps = ["/tmp", "/private/tmp", "/private/var/folders", os.tmpdir()];
    if (dir === home || dir === "/" || tmps.some(t => within(dir, t))) return true;
    try {   // a folder holding several repos is a workspace, not a project
      return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(path.join(dir, d.name, ".git"))).length >= 3;
    } catch { return false; }
  },
};
