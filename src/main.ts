import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCANUM_DIR, CLAUDE_DIR, PORT } from "./paths";
import { findCmux, planPortal, readCmuxLayout, runPortal } from "./portal";
import { readPs } from "./procs";
import { answerSeal, readSeal, sendWord, type SendCtx } from "./send";
import { pruneUploads } from "./uploads";
import { appTabTtys, applyReach, checkReach } from "./reach";
import { dismiss, loadDismissed, restore } from "./dismissed";
import { planResume, planSummon } from "./summon";
import { readRegistry } from "./registry";
import { CLAUDE_DIR as CD } from "./paths";
import { loadConfig } from "./realms";
import type { Model } from "./types";
import { realEnv } from "./realms";
import { createArcanumServer } from "./server";
import { buildSnapshot } from "./snapshot";
import { findTranscript } from "./transcript";
import type { Snapshot } from "./types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontDirs = ["pixelify-sans", "jacquard-24", "alegreya-sans"].map(f => path.join(root, "node_modules", "@fontsource", f, "files"));

const cmux = findCmux();
const uploadsDir = path.join(ARCANUM_DIR, "uploads");
pruneUploads(uploadsDir);
const live = (id: string) => snapshot.sessions.find(x => x.id === id);
const sendCtx = async (s: { host: string }): Promise<SendCtx> => ({ ps: readPs(), cmux: cmux && { bin: cmux.bin, layout: s.host === "cmux" ? await readCmuxLayout(cmux.bin) : undefined } });

let snapshot: Snapshot = { generatedAt: Date.now(), realms: [], sessions: [] };
let reach = new Map<string, boolean>();
let lastKey = "";
const rebuild = () => {
  try {
    snapshot = buildSnapshot({ claudeDir: CLAUDE_DIR, arcanumDir: ARCANUM_DIR, ps: readPs(), env: realEnv, hasCmux: !!cmux });
  } catch (e) { console.error("Couldn't read sessions:", (e as Error).message); return; }
  applyReach(snapshot.sessions, reach);
  const key = JSON.stringify({ ...snapshot, generatedAt: 0 });
  if (key !== lastKey) { lastKey = key; app.broadcast(snapshot); }
  syncTranscriptWatches();
};

let timer: NodeJS.Timeout | undefined;
const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, 250); };

const app = createArcanumServer({ uploadsDir, uiDir: path.join(root, "ui"), fontDirs, arcanumDir: ARCANUM_DIR, getSnapshot: () => snapshot, onConfigChange: schedule,
  // Read the process table and cmux layout at click time: panes move, tabs close.
  async openPortal(id) {
    const s = snapshot.sessions.find(x => x.id === id);
    if (!s) return undefined;
    const layout = cmux && s.host === "cmux" ? await readCmuxLayout(cmux.bin) : undefined;
    const result = await runPortal(planPortal(s, { ps: readPs(), cmux: cmux && { ...cmux, layout } }));
    console.log(`portal → ${s.name} (${s.where}): ${result.ok ? "ok" : "failed"} · ${result.message}`);
    return result;
  },
  async sendWord(id, text, images) {
    const s = live(id); if (!s) return undefined;
    const r = await sendWord(s, text, await sendCtx(s), images);
    console.log(`send → ${s.name} (${s.where}): ${r.ok ? "ok" : "refused"} · ${r.message}`);
    if (r.ok) schedule();
    return r;
  },
  async answerSeal(id, decision) {
    const s = live(id); if (!s) return undefined;
    const r = await answerSeal(s, decision, await sendCtx(s));
    console.log(`seal → ${s.name}: ${decision} · ${r.ok ? "ok" : "refused"} · ${r.message}`);
    if (r.ok) schedule();
    return r;
  },
  dismiss(id) {
    const s = live(id), dep = snapshot.departed?.find(x => x.id === id);
    if (!s && !dep) return undefined;
    dismiss(ARCANUM_DIR, (s ?? dep)!); schedule();
    return { ok: true, message: s ? `${s.name} dismissed. It keeps running in ${s.where}; restore it from Dismissed mages.` : `${dep!.name} dismissed. Restore it from Dismissed mages.` };
  },
  async resume(id, req) {
    const dep = snapshot.departed?.find(x => x.id === id); if (!dep) return undefined;
    // check the registry fresh, not the last snapshot: two processes on one session would fork it
    const alive = readRegistry(path.join(CD, "sessions"), readPs()).some(e => e.sessionId === id);
    const plan = planResume(dep, req, cmux, alive);
    if ("error" in plan) return { ok: false, message: plan.error };
    const out = await runPortal({ precision: "exact", steps: plan.steps, message: plan.message });
    console.log(`resume → ${dep.name}: ${out.ok ? "ok" : "failed"} · ${out.message}`);
    if (out.ok) schedule();
    return { ok: out.ok, message: out.ok ? `${plan.message} It will come back to life here in a moment.` : out.message };
  },
  restore(id) {
    const d = loadDismissed(ARCANUM_DIR)[id]; if (!d) return undefined;
    restore(ARCANUM_DIR, id); schedule();
    return { ok: true, message: `${d.name} is back.` };
  },
  async summon(realmId, req) {
    const r = loadConfig(ARCANUM_DIR).realms.find(x => x.id === realmId);
    if (!r) return { ok: false, message: "No realm by that name." };
    const plan = planSummon(r, { ...req, model: req.model as Model }, cmux);
    if ("error" in plan) return { ok: false, message: plan.error };
    const out = await runPortal({ precision: "exact", steps: plan.steps, message: plan.message });
    console.log(`summon → ${r.name} (${req.model}): ${out.ok ? "ok" : "failed"} · ${out.message}`);
    return { ok: out.ok, message: out.ok ? `${plan.message} It will appear here in a moment.` : out.message };
  },
  async readSeal(id) { const s = live(id); return s ? readSeal(s, await sendCtx(s)) : undefined; },
});

// Watch the live registry, and the transcript of every live session (re-armed after each scan).
const watchers = new Map<string, FSWatcher>();
const arm = (p: string) => { if (watchers.has(p)) return; try { watchers.set(p, watch(p, schedule)); } catch { /* not there yet */ } };
function syncTranscriptWatches() {
  const want = new Set([path.join(CLAUDE_DIR, "sessions"), path.join(ARCANUM_DIR, "realms.json")]);
  for (const s of snapshot.sessions) { const f = findTranscript(CLAUDE_DIR, s.id); if (f) want.add(f); }
  for (const [p, w] of watchers) if (!want.has(p)) { w.close(); watchers.delete(p); }
  for (const p of want) arm(p);
}

rebuild();
setInterval(rebuild, 5000); // liveness: processes can die without touching any file

// Reachability: does each session's pane/tab still exist? Withdraw reply boxes for ones that don't.
let checking = false;
setInterval(async () => {
  if (checking) return; checking = true;
  try {
    const next = await checkReach(snapshot.sessions, { cmuxBin: cmux?.bin, ps: readPs(), tabTtys: appTabTtys });
    if (JSON.stringify([...next]) !== JSON.stringify([...reach])) { reach = next; rebuild(); }
  } finally { checking = false; }
}, 5000);

app.server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n  ✦ Arcanum is watching ${snapshot.sessions.length} mages in ${snapshot.realms.length} realms\n  ➜ ${url}\n  (read-only · realm edits saved to ${path.join(ARCANUM_DIR, "realms.json")})\n`);
  if (process.argv.includes("--open")) execFile("open", [url]);
});
app.server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${PORT} is busy. Set ARCANUM_PORT to use another.` : e.message);
  process.exit(1);
});
