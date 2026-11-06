import path from "node:path";
import { classify, modelOf } from "./classify";
import { loadDismissed } from "./dismissed";
import { defaultModel, manaOf } from "./mana";
import { departedModel, departedName, findEnded } from "./departed";
import { portalPrecision } from "./portal";
import { replyCapability, sealCapability } from "./send";
import { detectHost } from "./procs";
import { assignRealms, loadConfig, saveConfig, WILDS_ID, type RealmEnv } from "./realms";
import { readRegistry } from "./registry";
import { findTranscript, parseTranscript, readTail } from "./transcript";
import type { DepartedMage, Host, ProcTable, Session, Snapshot, TranscriptSummary } from "./types";

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

export interface SnapshotDeps { claudeDir: string; arcanumDir: string; ps: ProcTable; env: RealmEnv; now?: number; hasCmux?: boolean; withDeparted?: boolean }

export function buildSnapshot(d: SnapshotDeps): Snapshot {
  const now = d.now ?? Date.now();
  const entries = readRegistry(path.join(d.claudeDir, "sessions"), d.ps);
  const cfg = loadConfig(d.arcanumDir), before = JSON.stringify(cfg);
  const gone = loadDismissed(d.arcanumDir);
  const ended = d.withDeparted === false ? [] : findEnded(d.claudeDir, new Set(entries.map(e => e.sessionId)), now).filter(e => !gone[e.id]);
  const realmOf = assignRealms([...entries.map(e => e.cwd), ...ended.map(e => e.t.cwd!)], cfg, d.env, now);
  if (JSON.stringify(cfg) !== before) saveConfig(d.arcanumDir, cfg);

  const defModel = defaultModel(d.claudeDir);
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
      waitingFor: e.waitingFor, cwd: e.cwd, branch: t.gitBranch, jobId: e.jobId, tmux: e.tmux, note, status: e.status, recent: t.recent, mana: manaOf(t, modelOf(t.model), defModel),
    };
  });
  for (const s of sessions) { s.portal = portalPrecision(s, !!d.hasCmux); s.reply = replyCapability(s, !!d.hasCmux); s.seal = sealCapability(s, !!d.hasCmux); }
  const departed: DepartedMage[] = ended.map(e => {
    const last = e.t.lastAssistantText?.text;
    return { id: e.id, realmId: realmOf.get(e.t.cwd!)!, name: departedName(e), title: e.t.aiTitle, model: departedModel(e), modelId: e.t.model, endedAt: e.endedAt,
      cwd: e.t.cwd!, branch: e.t.gitBranch, briefing: briefingOf(e.t), lastText: last && (last.length > 4000 ? "…" + last.slice(-4000) : last), recent: e.t.recent,
      mana: manaOf(e.t, departedModel(e), defModel) };
  });
  // a Wilds mage's folder can become a realm, unless it's a workspace folder holding many projects
  const promotable = (realmId: string, cwd: string) => realmId === WILDS_ID && !d.env.isWilds(cwd);
  for (const x of [...sessions, ...departed]) if (promotable(x.realmId, x.cwd)) x.promote = true;
  const dismissed = Object.entries(gone).map(([id, v]) => ({ id, ...v, alive: sessions.some(s => s.id === id) })).sort((a, b) => b.at - a.at);
  return { generatedAt: now, realms: cfg.realms, sessions: sessions.filter(s => !gone[s.id]), dismissed, departed };
}
