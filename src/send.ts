import { execFile } from "node:child_process";
import { surfaceOf, type CmuxLayout } from "./portal";
import { hostTty } from "./procs";
import type { ProcTable, Session } from "./types";

/* ---------- reading the terminal: is the prompt empty, holding a draft, or showing a permission dialog? ---------- */
export type Screen =
  | { kind: "input"; draft: string }
  | { kind: "permission"; request: string; question: string; yes: string; no: string }
  | { kind: "unknown" };

const RULE = /^\s*─{10,}\s*$/;
const OPTION = /^\s*(?:❯\s*)?(\d)\.\s+(.*)$/;

export function parseScreen(text: string): Screen {
  const lines = text.split("\n").map(l => l.replace(/\s+$/, ""));
  const q = lines.findLastIndex(l => /^\s*Do you want to .+\?$/.test(l));
  if (q >= 0) {
    const opts = lines.slice(q + 1).map(l => OPTION.exec(l)).filter((m): m is RegExpExecArray => !!m);
    const yes = opts.find(m => /^Yes\b(?!,)/.test(m[2])) ?? opts.find(m => /^Yes\b/.test(m[2]));
    const no = opts.find(m => /^No\b/.test(m[2]));
    if (yes && no) {
      const top = lines.slice(0, q).findLastIndex(l => RULE.test(l));
      const request = lines.slice(top + 1, q).map(l => l.trim()).filter(Boolean).join("\n");
      return { kind: "permission", request, question: lines[q].trim(), yes: yes[1], no: no[1] };
    }
  }
  const p = lines.findLastIndex(l => /^\s*❯(\s|$)/.test(l));
  if (p >= 0 && lines.slice(0, p).some(l => RULE.test(l))) {
    const end = lines.findIndex((l, i) => i > p && RULE.test(l));
    if (end > p) {
      const draft = [lines[p].replace(/^\s*❯\s?/, ""), ...lines.slice(p + 1, end)].map(l => l.trim()).filter(Boolean).join("\n");
      return { kind: "input", draft };
    }
  }
  return { kind: "unknown" };
}

/** Rebuild screen text from cmux's styled grid. `solid` drops faint text (Claude's greyed-out prompt suggestions). */
export function gridText(replay: any): { text: string; solid: string } {
  const g = replay?.render_grid;
  if (!g?.row_spans) return { text: "", solid: "" };
  const faint = new Set((g.styles ?? []).filter((s: any) => s.faint).map((s: any) => s.id));
  const rows = Math.max(g.rows ?? 0, ...g.row_spans.map((s: any) => s.row + 1));
  const full: string[] = Array(rows).fill(""), sol: string[] = Array(rows).fill("");
  const put = (line: string, col: number, t: string) => line.padEnd(col, " ") + t;   // columns are character positions
  for (const s of [...g.row_spans].sort((a: any, b: any) => a.row - b.row || a.column - b.column)) {
    full[s.row] = put(full[s.row], s.column, s.text);
    sol[s.row] = put(sol[s.row], s.column, faint.has(s.style_id) ? " ".repeat([...s.text].length) : s.text);
  }
  return { text: full.join("\n"), solid: sol.join("\n") };
}

/** Keep newlines and tabs; drop every other control character (no escape sequences reach the terminal). */
export const cleanText = (t: string) => t.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 8000);

/* ---------- what each host allows ---------- */
export function replyCapability(s: Session, hasCmux: boolean): "type" | "none" {
  if (s.host === "cmux") return hasCmux ? "type" : "none";
  return s.host === "terminal" || s.host === "iterm" || s.host === "tmux" ? "type" : "none";
}
/** Pressing a dialog key needs a host that can send a bare key without a trailing Return. */
export function sealCapability(s: Session, hasCmux: boolean): boolean {
  return (s.host === "cmux" && hasCmux) || s.host === "tmux";
}

/* ---------- talking to terminals ---------- */
export interface SendCtx { ps: ProcTable; cmux?: { bin: string; layout?: CmuxLayout } }
export interface SendResult { ok: boolean; message: string }

const exec = (cmd: string, args: string[]) => new Promise<string>((ok, fail) =>
  execFile(cmd, args, { timeout: 8000, maxBuffer: 4 << 20, env: { ...process.env, CMUX_QUIET: "1" } }, (e, out, err) => e ? fail(new Error((err || e.message).trim().split("\n")[0])) : ok(out)));

const TERMINAL = (body: string) => `on run argv
  set want to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is want then
          ${body}
        end if
      end repeat
    end repeat
  end tell
  return "missing"
end run`;
const ITERM = (body: string) => `on run argv
  set want to item 1 of argv
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is want then
            ${body}
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "missing"
end run`;

/** `solid` is the screen without faint text, where the host can tell (cmux). */
interface Target { read(): Promise<{ text: string; solid?: string }>; type(text: string, images?: string[]): Promise<void>; key(k: string): Promise<void> }

function targetFor(s: Session, ctx: SendCtx): Target | string {
  if (s.host === "cmux") {
    const loc = ctx.cmux?.layout && surfaceOf(s, ctx.cmux.layout, ctx.ps);
    if (!ctx.cmux || !loc) return "Couldn't find its cmux pane.";
    const bin = ctx.cmux.bin, id = loc.surface;
    return {
      read: async () => gridText(JSON.parse(await exec(bin, ["rpc", "terminal.replay", JSON.stringify({ surface_id: id })]))),
      // a bracketed paste: delivered verbatim (newlines, backslashes) and submitted in one step
      type: async (text, images = []) => {
        // image paths pasted together, unsubmitted, become [Image #n] attachments; then the text submits the lot
        if (images.length) await exec(bin, ["rpc", "terminal.paste", JSON.stringify({ surface_id: id, text: images.join(" "), submit: false })]);
        await exec(bin, ["rpc", "terminal.paste", JSON.stringify({ surface_id: id, text: images.length ? " " + text : text })]);
      },
      key: async k => { await exec(bin, ["send", "--surface", id, "--", k]); },
    };
  }
  if (s.host === "tmux") {
    const pane = /\.(%\d+)$/.exec(s.tmux ?? "")?.[1];
    if (!pane) return "This tmux session didn't record its pane.";
    return {
      read: async () => ({ text: await exec("tmux", ["capture-pane", "-p", "-t", pane]) }),
      type: async text => { await exec("tmux", ["send-keys", "-t", pane, "-l", text]); await exec("tmux", ["send-keys", "-t", pane, "Enter"]); },
      key: async k => { await exec("tmux", ["send-keys", "-t", pane, "-l", k]); },
    };
  }
  if (s.host === "terminal" || s.host === "iterm") {
    const tty = hostTty(ctx.ps, s.pid);
    if (!tty) return `Couldn't find its ${s.where} tab.`;
    const wrap = s.host === "iterm" ? ITERM : TERMINAL, it = s.host === "iterm" ? "s" : "t";
    const run = async (body: string, extra: string[] = []) => {
      const out = (await exec("osascript", ["-e", wrap(body), `/dev/${tty}`, ...extra])).trim();
      if (out === "missing") throw new Error(`Its ${s.where} tab has closed.`);
      return out;
    };
    return {
      // Terminal's `contents` is empty when a wrapper (kiro-cli-term) draws claude in an inner pty; `history` always has the screen
      read: async () => ({ text: (await run(`return ${s.host === "iterm" ? "contents" : "history"} of ${it}`)).split("\n").slice(-80).join("\n") }),
      type: async text => { await run(s.host === "iterm" ? `tell ${it} to write text (item 2 of argv)\n          return "ok"` : `do script (item 2 of argv) in ${it}\n          return "ok"`, [text]); },
      key: async () => { throw new Error("Not supported"); },
    };
  }
  return `${s.where} can't be typed into. Open it to reply.`;
}

const firstLine = (t: string) => t.split("\n")[0].replace(/\s+/g, " ").slice(0, 80);

/** Type a reply into the session's own prompt, as if you were at the keyboard. Refuses whenever that could land in the wrong place. */
export async function sendWord(s: Session, raw: string, ctx: SendCtx, images: string[] = []): Promise<SendResult> {
  const text = cleanText(raw).trim();
  if (!text && !images.length) return { ok: false, message: "Write something first." };
  if (images.length && s.host !== "cmux") return { ok: false, message: "Images can only be sent to cmux sessions so far. Open the portal and paste it there." };
  if (images.some(p => /\s/.test(p))) return { ok: false, message: "Image paths can't contain spaces." };
  if (s.status === "shell") return { ok: false, message: `${s.name} is in shell mode (!). Open the portal to finish there first.` };
  if (s.state === "seal") return { ok: false, message: `${s.name} is waiting on a permission prompt. Grant or refuse it first.` };
  if (s.waitingFor) return { ok: false, message: `${s.name} is showing a question dialog. Open the portal to pick an answer.` };
  if (text.includes("\n") && s.host !== "cmux") return { ok: false, message: "Multi-line replies only work for cmux sessions so far. Send it as one line, or open the portal." };
  const t = targetFor(s, ctx);
  if (typeof t === "string") return { ok: false, message: t };
  try {
    const shot = await t.read(), screen = parseScreen(shot.solid ?? shot.text);
    if (screen.kind === "permission") return { ok: false, message: `${s.name} just asked for permission. Grant or refuse it first.` };
    if (screen.kind === "unknown") return { ok: false, message: `Couldn't see ${s.name}'s prompt, so nothing was typed. Open the portal instead.` };
    if (screen.draft) return { ok: false, message: shot.solid !== undefined
      ? `There's an unsent draft in ${s.name}'s prompt (“${firstLine(screen.draft)}”). Open the portal to finish or clear it.`
      : `There's text in ${s.name}'s prompt (“${firstLine(screen.draft)}”). If it's Claude's grey suggestion, press Esc there; otherwise open the portal to finish it.` };
    await t.type(text, images);
    const what = images.length ? `${images.length === 1 ? "An image" : `${images.length} images`}${text ? " and your word" : ""}` : "Your word";
    return { ok: true, message: s.state === "cast" ? `${what} queued for ${s.name}: it will read it when it finishes casting.` : `${what} sent to ${s.name}.` };
  } catch (e) {
    return { ok: false, message: `Couldn't send: ${(e as Error).message}` };
  }
}

/** What the open permission prompt is asking, read off the screen (cmux and tmux only). */
export async function readSeal(s: Session, ctx: SendCtx): Promise<{ request: string; question: string } | undefined> {
  if (s.state !== "seal" || (s.host !== "cmux" && s.host !== "tmux")) return undefined;
  const t = targetFor(s, ctx);
  if (typeof t === "string") return undefined;
  try { const sc = parseScreen((await t.read()).text); return sc.kind === "permission" ? { request: sc.request, question: sc.question } : undefined; }
  catch { return undefined; }
}

/** Press Yes or No on the permission prompt, after checking the prompt is really on screen. */
export async function answerSeal(s: Session, decision: "grant" | "refuse", ctx: SendCtx): Promise<SendResult> {
  if (s.state !== "seal") return { ok: false, message: `${s.name} isn't asking for permission any more.` };
  if (s.host !== "cmux" && s.host !== "tmux") return { ok: false, message: `${s.where} can't be sent keys. Open the portal to answer.` };
  const t = targetFor(s, ctx);
  if (typeof t === "string") return { ok: false, message: t };
  try {
    const sc = parseScreen((await t.read()).text);
    if (sc.kind !== "permission") return { ok: false, message: `Couldn't see the permission prompt on ${s.name}'s screen, so nothing was pressed.` };
    await t.key(decision === "grant" ? sc.yes : sc.no);
    const what = sc.request.split("\n").slice(0, 2).join(": ").slice(0, 100) || sc.question;
    return { ok: true, message: `${decision === "grant" ? "Seal granted" : "Seal refused"} → ${s.name}: ${what}` };
  } catch (e) {
    return { ok: false, message: `Couldn't answer: ${(e as Error).message}` };
  }
}
