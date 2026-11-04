import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostTty } from "./procs";
import type { ProcTable, Session } from "./types";

/* ---------- cmux layout: which surface (tab) each process lives in ---------- */
export interface CmuxLayout { surfaceOfPid: Map<number, string>; surfaces: Map<string, { workspace: string; window: string }> }

const uuidOf = (ref: string) => ref.split(" ")[1] ?? "";

/** Parse `cmux top --all --processes --format tsv --id-format both`. */
export function parseCmuxTop(tsv: string): CmuxLayout {
  const paneWs = new Map<string, string>(), wsWin = new Map<string, string>(), surfPane = new Map<string, string>();
  const surfaceOfPid = new Map<number, string>();
  for (const line of tsv.split("\n")) {
    const [, , , kind, self, parent] = line.split("\t");
    if (!kind || !self) continue;
    if (kind === "workspace") wsWin.set(uuidOf(self), uuidOf(parent ?? ""));
    else if (kind === "pane") paneWs.set(uuidOf(self), uuidOf(parent ?? ""));
    else if (kind === "surface") surfPane.set(uuidOf(self), uuidOf(parent ?? ""));
    else if (kind === "process" && parent?.startsWith("surface:")) surfaceOfPid.set(Number(self), uuidOf(parent));
  }
  const surfaces = new Map<string, { workspace: string; window: string }>();
  for (const [s, p] of surfPane) { const ws = paneWs.get(p); if (ws) surfaces.set(s, { workspace: ws, window: wsWin.get(ws) ?? "" }); }
  return { surfaceOfPid, surfaces };
}

export function cmuxSurfaceFor(pid: number, layout: CmuxLayout, ps: ProcTable) {
  let cur: number | undefined = pid;
  for (let i = 0; cur && cur > 1 && i < 25; i++) {
    const s = layout.surfaceOfPid.get(cur);
    if (s) { const loc = layout.surfaces.get(s); return loc ? { surface: s, ...loc } : undefined; }
    cur = ps.get(cur)?.ppid;
  }
  return undefined;
}

/* ---------- planning: pure, so every host is testable without touching a terminal ---------- */
export interface Step { cmd: string; args: string[] }
export interface PortalPlan { precision: "exact" | "app" | "none"; steps: Step[]; message: string }
export interface PortalCtx { ps: ProcTable; cmux?: { bin: string; app: string; layout?: CmuxLayout } }

// tty arrives via argv, never spliced into the script
const TERMINAL_JS = `on run argv
  set want to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is want then
          set selected of t to true
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "missing"
end run`;
const ITERM_JS = `on run argv
  set want to item 1 of argv
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is want then
            select w
            select t
            select s
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run`;

const APP: Partial<Record<Session["host"], string>> = { warp: "Warp", ghostty: "Ghostty" };

export function planPortal(s: Session, ctx: PortalCtx): PortalPlan {
  const tty = hostTty(ctx.ps, s.pid);
  const cm = ctx.cmux;
  switch (s.host) {
    case "cmux": {
      if (!cm) return { precision: "none", steps: [], message: "cmux isn't installed where Arcanum expects it." };
      const loc = cm.layout && cmuxSurfaceFor(s.pid, cm.layout, ctx.ps);
      if (!loc) return { precision: "app", steps: [{ cmd: "open", args: ["-a", cm.app] }], message: "Raised cmux, but couldn't find the exact pane." };
      return {
        precision: "exact", message: `Opened ${s.name} in cmux.`, steps: [
          { cmd: cm.bin, args: ["select-workspace", "--workspace", loc.workspace] },
          { cmd: cm.bin, args: ["rpc", "surface.focus", JSON.stringify({ surface_id: loc.surface })] },
          { cmd: "open", args: ["-a", cm.app] },
          { cmd: cm.bin, args: ["trigger-flash", "--surface", loc.surface, "--workspace", loc.workspace] },
        ],
      };
    }
    case "terminal":
    case "iterm":
      if (!tty) return { precision: "app", steps: [{ cmd: "open", args: ["-a", s.host === "iterm" ? "iTerm" : "Terminal"] }], message: `Raised ${s.where}; its tab wasn't found.` };
      return { precision: "exact", message: `Opened ${s.name} in ${s.where}.`, steps: [{ cmd: "osascript", args: ["-e", s.host === "iterm" ? ITERM_JS : TERMINAL_JS, `/dev/${tty}`] }] };
    case "tmux": {
      const m = /^([^:]+:@\d+)\.(%\d+)$/.exec(s.tmux ?? "");
      if (!m) return { precision: "none", steps: [], message: "This tmux session didn't record its window." };
      return { precision: "exact", message: `Switched tmux to ${s.name}.`, steps: [{ cmd: "tmux", args: ["select-window", "-t", m[1]] }, { cmd: "tmux", args: ["select-pane", "-t", m[2]] }] };
    }
    case "warp":
    case "ghostty":
      return { precision: "app", steps: [{ cmd: "open", args: ["-a", APP[s.host]!] }], message: `Raised ${s.where}. It can't be told which tab, so look for ${s.name}.` };
    case "vscode":
      return { precision: "app", steps: [{ cmd: "open", args: ["-a", "Visual Studio Code", s.cwd] }], message: `Raised the VS Code window for ${path.basename(s.cwd)}.` };
    case "bg": {
      if (!s.jobId || !/^[0-9a-f]{8}$/.test(s.jobId)) return { precision: "none", steps: [], message: "This background session has no job id to attach to." };
      if (!cm) return { precision: "none", steps: [], message: `Run \`claude attach ${s.jobId}\` in a terminal to join it.` };
      return {
        precision: "exact", message: `Attached to ${s.name} in a new cmux workspace.`, steps: [
          { cmd: cm.bin, args: ["new-workspace", "--name", s.name.slice(0, 60), "--cwd", s.cwd, "--command", `claude attach ${s.jobId}`] },
          { cmd: "open", args: ["-a", cm.app] },
        ],
      };
    }
    default:
      return { precision: "none", steps: [], message: `Arcanum couldn't tell which terminal ${s.name} runs in.` };
  }
}

/* ---------- running ---------- */
const run = (s: Step) => new Promise<string>((ok, fail) =>
  execFile(s.cmd, s.args, { timeout: 8000, env: { ...process.env, CMUX_QUIET: "1" } }, (e, out, err) => e ? fail(new Error((err || e.message).trim())) : ok(out.trim())));

export async function runPortal(plan: PortalPlan): Promise<{ ok: boolean; precision: PortalPlan["precision"]; message: string }> {
  if (!plan.steps.length) return { ok: false, precision: plan.precision, message: plan.message };
  for (const step of plan.steps) {
    try {
      const out = await run(step);
      if (step.cmd === "osascript" && out === "missing") return { ok: false, precision: plan.precision, message: "That terminal tab has closed." };
    } catch (e) {
      const msg = (e as Error).message;
      const hint = /not allowed|1743|-1743/i.test(msg) ? " macOS needs to allow Arcanum's terminal to control that app (System Settings → Privacy & Security → Automation)." : "";
      return { ok: false, precision: plan.precision, message: `Couldn't open the portal.${hint || " " + msg.split("\n")[0]}` };
    }
  }
  return { ok: true, precision: plan.precision, message: plan.message };
}

export function findCmux(): { bin: string; app: string } | undefined {
  const apps = [process.env.ARCANUM_CMUX_APP, path.join(os.homedir(), "Applications", "cmux.app"), "/Applications/cmux.app"].filter(Boolean) as string[];
  for (const app of apps) { const bin = path.join(app, "Contents", "Resources", "bin", "cmux"); if (existsSync(bin)) return { bin, app }; }
  return undefined;
}

export function readCmuxLayout(bin: string): Promise<CmuxLayout | undefined> {
  return new Promise(ok => execFile(bin, ["top", "--all", "--processes", "--format", "tsv", "--id-format", "both"], { timeout: 4000, maxBuffer: 8 << 20, env: { ...process.env, CMUX_QUIET: "1" } },
    (e, out) => ok(e ? undefined : parseCmuxTop(out))));
}

/** What the UI can promise before clicking: exact tab, app window only, or nothing. */
export function portalPrecision(s: Session, hasCmux: boolean): PortalPlan["precision"] {
  if (s.host === "cmux") return hasCmux ? "exact" : "none";
  if (s.host === "terminal" || s.host === "iterm" || s.host === "tmux") return "exact";
  if (s.host === "bg") return hasCmux && !!s.jobId ? "exact" : "none";
  if (s.host === "warp" || s.host === "ghostty" || s.host === "vscode") return "app";
  return "none";
}
