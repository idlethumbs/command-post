import { execFile } from "node:child_process";
import { cmuxSurfaceFor, readCmuxLayout } from "./portal";
import { hostTty } from "./procs";
import type { ProcTable, Session } from "./types";

/**
 * Can Arcanum actually reach each session's terminal right now? Checked against the live
 * cmux layout and Terminal/iTerm tab lists, so a reply box is only offered when typing will land.
 * Returns session id → reachable, only for sessions on hosts Arcanum types into.
 */
export interface ReachDeps { cmuxBin?: string; ps: ProcTable; tabTtys(app: "Terminal" | "iTerm2"): Promise<Set<string> | undefined> }

export async function checkReach(sessions: Session[], d: ReachDeps): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const on = (h: string) => sessions.filter(s => s.host === h);
  if (on("cmux").length && d.cmuxBin) {
    const layout = await readCmuxLayout(d.cmuxBin);
    for (const s of on("cmux")) out.set(s.id, !!layout && !!cmuxSurfaceFor(s.pid, layout, d.ps));
  }
  for (const [host, app] of [["terminal", "Terminal"], ["iterm", "iTerm2"]] as const) {
    if (!on(host).length) continue;
    const ttys = await d.tabTtys(app);
    for (const s of on(host)) { const t = hostTty(d.ps, s.pid); out.set(s.id, !!ttys && !!t && ttys.has(`/dev/${t}`)); }
  }
  return out;
}

/** Ask Terminal or iTerm for every tab's tty. Only called when that app hosts a live session (so it is running). */
export function appTabTtys(app: "Terminal" | "iTerm2"): Promise<Set<string> | undefined> {
  const script = app === "Terminal" ? 'tell application "Terminal" to get tty of every tab of every window' : 'tell application "iTerm2" to get tty of every session of every tab of every window';
  return new Promise(ok => execFile("osascript", ["-e", script], { timeout: 4000 }, (e, out) =>
    ok(e ? undefined : new Set(out.split(/[,\n]/).map(x => x.trim()).filter(x => x.startsWith("/dev/"))))));
}

/** Withdraw what can't work: no reply box, no seal buttons, no exact portal for a session whose terminal is gone. */
export function applyReach(sessions: Session[], reach: Map<string, boolean>) {
  for (const s of sessions) {
    if (reach.get(s.id) !== false) continue;
    s.unreachable = true; s.reply = "none"; s.seal = false;
    if (s.portal === "exact") s.portal = "app";
  }
}
