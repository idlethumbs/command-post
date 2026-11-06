import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Hook events Arcanum listens to. Only PermissionRequest ever waits (for your answer in the dashboard). */
export const EVENTS = ["SessionStart", "SessionEnd", "UserPromptSubmit", "Stop", "Notification", "PermissionRequest"] as const;
export const MARK = ".arcanum/bin/hook";
export const STATUS_MARK = "# arcanum-relay";
const command = (e: string) => `~/${MARK} ${e}`;
const ours = (h: any) => Array.isArray(h?.hooks) && h.hooks.some((x: any) => typeof x?.command === "string" && x.command.includes(MARK));

/** Settings with Arcanum's hooks added, leaving every other hook and setting exactly as it was. Idempotent. */
export function withHooks(settings: any): any {
  const s = structuredClone(settings ?? {});
  s.hooks ??= {};
  for (const e of EVENTS) {
    const list = (s.hooks[e] ?? []).filter((h: any) => !ours(h));
    list.push({ hooks: [{ type: "command", command: command(e), timeout: e === "PermissionRequest" ? 120 : 5 }] });
    s.hooks[e] = list;
  }
  return s;
}

/** Settings with Arcanum's hooks removed; empty event lists and an empty `hooks` key go too. */
export function withoutHooks(settings: any): any {
  const s = structuredClone(settings ?? {});
  if (!s.hooks) return s;
  for (const e of Object.keys(s.hooks)) {
    const list = (s.hooks[e] ?? []).filter((h: any) => !ours(h));
    if (list.length) s.hooks[e] = list; else delete s.hooks[e];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return s;
}

export const hooksInstalled = (settings: any) => EVENTS.every(e => (settings?.hooks?.[e] ?? []).some(ours));

/** The one line added to the status line script: a fire-and-forget copy of the payload to Arcanum. */
export const STATUS_LINE = `{ [ -S "$HOME/.arcanum/hooks.sock" ] && printf '%s' "$json_input" | curl -s --max-time 1 --unix-socket "$HOME/.arcanum/hooks.sock" -H 'content-type: application/json' --data-binary @- http://arcanum/status >/dev/null 2>&1 & } ${STATUS_MARK}`;

export function withStatusRelay(script: string): string | undefined {
  if (script.includes(STATUS_MARK)) return script;
  const lines = script.split("\n"), i = lines.findIndex(l => /^\s*read -r json_input\s*$/.test(l));
  if (i < 0) return undefined;   // not a script we recognise: leave it alone
  lines.splice(i + 1, 0, STATUS_LINE);
  return lines.join("\n");
}
export const withoutStatusRelay = (script: string) => script.split("\n").filter(l => !l.includes(STATUS_MARK)).join("\n");

/* ---------- applying it ---------- */
export interface Paths { settings: string; relaySource: string; relayTarget: string }
export const defaultPaths = (repoRoot: string): Paths => ({
  settings: path.join(os.homedir(), ".claude", "settings.json"),
  relaySource: path.join(repoRoot, "bin", "arcanum-hook"),
  relayTarget: path.join(os.homedir(), MARK),
});
export function statusScriptOf(settings: any): string | undefined {
  const cmd: string | undefined = settings?.statusLine?.command;
  if (!cmd) return undefined;
  const p = cmd.trim().split(/\s+/)[0].replace(/^\$HOME|^~/, os.homedir());
  return existsSync(p) ? p : undefined;
}
const backup = (f: string) => { const b = `${f}.arcanum-bak-${new Date().toISOString().replace(/[:.]/g, "-")}`; copyFileSync(f, b); return b; };

export function install(p: Paths) {
  const settings = JSON.parse(readFileSync(p.settings, "utf8"));
  mkdirSync(path.dirname(p.relayTarget), { recursive: true });
  copyFileSync(p.relaySource, p.relayTarget); chmodSync(p.relayTarget, 0o755);
  const backups = [backup(p.settings)];
  writeFileSync(p.settings, JSON.stringify(withHooks(settings), null, 2) + "\n");
  const script = statusScriptOf(settings);
  let status: string | undefined;
  if (script) {
    const next = withStatusRelay(readFileSync(script, "utf8"));
    if (next && next !== readFileSync(script, "utf8")) { backups.push(backup(script)); writeFileSync(script, next); status = script; }
  }
  return { backups, status };
}

export function uninstall(p: Paths) {
  const settings = JSON.parse(readFileSync(p.settings, "utf8"));
  const backups = [backup(p.settings)];
  writeFileSync(p.settings, JSON.stringify(withoutHooks(settings), null, 2) + "\n");
  const script = statusScriptOf(settings);
  if (script && readFileSync(script, "utf8").includes(STATUS_MARK)) { backups.push(backup(script)); writeFileSync(script, withoutStatusRelay(readFileSync(script, "utf8"))); }
  return { backups };
}
