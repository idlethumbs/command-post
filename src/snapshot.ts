import path from "node:path";
import { classify, modelOf } from "./classify";
import { portalPrecision } from "./portal";
import { replyCapability, sealCapability } from "./send";
import { detectHost } from "./procs";
import { assignRealms, loadConfig, saveConfig, type RealmEnv } from "./realms";
import { readRegistry } from "./registry";
import { findTranscript, parseTranscript, readTail } from "./transcript";
import type { Host, ProcTable, Session, Snapshot, TranscriptSummary } from "./types";

const WHERE: Record<Host, string> = {
  cmux: "cmux", warp: "Warp", iterm: "iTerm", tmux: "tmux", ghostty: "Ghostty", terminal: "Terminal", vscode: "VS Code", bg: "Background", unknown: "Unknown terminal",
};

const firstSentence = (t: string) => {
  const flat = t.replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();
  const m = /^(.{12,220}?[.!?])(\s|$)/.exec(flat);
  return m ? m[1] : flat.length > 220 ? flat.slice(0, 217) + "…" : flat;
};

export function briefingOf(t: TranscriptSummary): string {
  if (t.awaySummary && (t.lastHumanAt === undefined || t.awaySummary.at >= t.lastHumanAt)) return t.awaySummary.text;
  if (t.lastAssistantText) return firstSentence(t.lastAssistantText.text);
  return t.aiTitle ?? "No word yet.";
}

export interface SnapshotDeps { claudeDir: string; arcanumDir: string; ps: ProcTable; env: RealmEnv; now?: number; hasCmux?: boolean }

export function buildSnapshot(d: SnapshotDeps): Snapshot {
  const now = d.now ?? Date.now();
  const entries = readRegistry(path.join(d.claudeDir, "sessions"), d.ps);
  const cfg = loadConfig(d.arcanumDir), before = JSON.stringify(cfg);
  const realmOf = assignRealms(entries.map(e => e.cwd), cfg, d.env, now);
  if (JSON.stringify(cfg) !== before) saveConfig(d.arcanumDir, cfg);

  const sessions: Session[] = entries.map(e => {
    const file = findTranscript(d.claudeDir, e.sessionId);
    let t: TranscriptSummary = {};
    try { if (file) t = parseTranscript(readTail(file)); } catch { /* unreadable transcript: show what the registry knows */ }
    const host: Host = e.kind === "bg" ? "bg" : e.entrypoint === "claude-vscode" ? "vscode" : detectHost(d.ps, e.pid);
    let { state, since } = classify(e, t);
    let note: string | undefined;
    if (e.parkedJobId) {   // it handed its turn to a background job: that job is the one working
      const bg = entries.find(x => x.jobId === e.parkedJobId);
      state = "rest";
      note = `Handed its work to the background mage “${bg?.name ?? e.parkedJobId}”.`;
    }
    const last = t.lastAssistantText?.text;
    return {
      id: e.sessionId, pid: e.pid, realmId: realmOf.get(e.cwd)!, name: e.name, title: t.aiTitle, model: modelOf(t.model), modelId: t.model,
      state, since, host, where: WHERE[host], briefing: briefingOf(t), lastText: last && (last.length > 4000 ? "…" + last.slice(-4000) : last),
      waitingFor: e.waitingFor, cwd: e.cwd, branch: t.gitBranch, jobId: e.jobId, tmux: e.tmux, note, status: e.status,
    };
  });
  for (const s of sessions) { s.portal = portalPrecision(s, !!d.hasCmux); s.reply = replyCapability(s, !!d.hasCmux); s.seal = sealCapability(s, !!d.hasCmux); }
  return { generatedAt: now, realms: cfg.realms, sessions };
}
