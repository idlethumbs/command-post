import { execFileSync } from "node:child_process";
import type { Host, ProcTable } from "./types";

const ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\w{3} \w{3}\s+\d{1,2} \d\d:\d\d:\d\d \d{4})\s+(.*)$/;
export const normStart = (s: string) => s.replace(/\s+/g, " ").trim();

export function parsePs(out: string): ProcTable {
  const t: ProcTable = new Map();
  for (const line of out.split("\n")) {
    const m = ROW.exec(line);
    if (!m) continue;
    const tty = /^ttys?\d+$/.test(m[3]) ? m[3] : undefined;
    t.set(Number(m[1]), { ppid: Number(m[2]), ...(tty ? { tty } : {}), lstart: normStart(m[4]), comm: m[5].trim() });
  }
  return t;
}

/** One ps call per scan: liveness (pid + start time) and parent chains for host detection. */
export function readPs(): ProcTable {
  try {
    return parsePs(execFileSync("ps", ["-axo", "pid=,ppid=,tty=,lstart=,comm="], { env: { ...process.env, LC_ALL: "C" }, encoding: "utf8", maxBuffer: 16 << 20 }));
  } catch {
    return new Map();
  }
}

const HOSTS: [RegExp, Host][] = [
  [/cmux/i, "cmux"], [/warp/i, "warp"], [/iterm/i, "iterm"], [/tmux/i, "tmux"], [/ghostty/i, "ghostty"],
  [/Terminal\.app/, "terminal"], [/Code Helper|Visual Studio Code|Electron/i, "vscode"],
];

export function detectHost(t: ProcTable, pid: number): Host {
  let cur = t.get(pid)?.ppid;
  for (let i = 0; cur && cur > 1 && i < 25; i++) {
    const p = t.get(cur);
    if (!p) break;
    for (const [re, host] of HOSTS) if (re.test(p.comm)) return host;
    cur = p.ppid;
  }
  return "unknown";
}
