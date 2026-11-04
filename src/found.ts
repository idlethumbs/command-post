import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { foundRealm, type Config, type RealmEnv } from "./realms";
import type { Realm } from "./types";

export const PROJECTS_DIR = process.env.ARCANUM_PROJECTS_DIR ?? path.join(os.homedir(), "projects");

export interface FoundReq { name: string; folder?: string; create?: boolean; git?: boolean }

export const slugOf = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
const expand = (p: string) => path.resolve(p.replace(/^~(?=\/|$)/, os.homedir()));

/**
 * Found a realm. Either a new folder under ~/projects named after the realm, or an existing folder.
 * Every check runs before anything touches the disk.
 */
export function found(cfg: Config, q: FoundReq, env: RealmEnv, projectsDir = PROJECTS_DIR, now = Date.now()): { realm: Realm; created: boolean; git: boolean } {
  const name = (q.name ?? "").trim();
  let root: string;
  if (q.create) {
    const slug = slugOf(name);
    if (!slug) throw new Error("Give the realm a name with some letters or numbers.");
    root = path.join(projectsDir, slug);
    if (existsSync(root)) throw new Error(`${root.replace(os.homedir(), "~")} already exists. Choose “Use an existing folder” to found the realm on it.`);
  } else {
    if (!q.folder?.trim()) throw new Error("Choose a folder.");
    root = expand(q.folder.trim());
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${q.folder} isn't a folder.`);
  }
  const probe = { ...cfg, realms: [...cfg.realms] };           // validate (name, workspace folders, duplicates) without saving
  foundRealm(probe, { name, root }, env, now);
  if (q.create) mkdirSync(root, { recursive: true });
  let git = false;
  if (q.git && env.gitRoot(root) === null) { execFileSync("git", ["init", "-q", root], { stdio: "ignore" }); git = true; }
  return { realm: foundRealm(cfg, { name, root }, env, now), created: !!q.create, git };
}
