import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCANUM_DIR, CLAUDE_DIR, PORT } from "./paths";
import { findCmux, planPortal, readCmuxLayout, runPortal } from "./portal";
import { readPs } from "./procs";
import { answerSeal, readSeal, sendWord, type SendCtx } from "./send";
import { pruneUploads } from "./uploads";
import { realEnv } from "./realms";
import { createArcanumServer } from "./server";
import { buildSnapshot } from "./snapshot";
import { findTranscript } from "./transcript";
import type { Snapshot } from "./types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontDirs = ["pixelify-sans", "jacquard-24", "alegreya", "alegreya-sans"].map(f => path.join(root, "node_modules", "@fontsource", f, "files"));

const cmux = findCmux();
const uploadsDir = path.join(ARCANUM_DIR, "uploads");
pruneUploads(uploadsDir);
const live = (id: string) => snapshot.sessions.find(x => x.id === id);
const sendCtx = async (s: { host: string }): Promise<SendCtx> => ({ ps: readPs(), cmux: cmux && { bin: cmux.bin, layout: s.host === "cmux" ? await readCmuxLayout(cmux.bin) : undefined } });

let snapshot: Snapshot = { generatedAt: Date.now(), realms: [], sessions: [] };
let lastKey = "";
const rebuild = () => {
  try {
    snapshot = buildSnapshot({ claudeDir: CLAUDE_DIR, arcanumDir: ARCANUM_DIR, ps: readPs(), env: realEnv, hasCmux: !!cmux });
  } catch (e) { console.error("Couldn't read sessions:", (e as Error).message); return; }
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

app.server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n  ✦ Arcanum is watching ${snapshot.sessions.length} mages in ${snapshot.realms.length} realms\n  ➜ ${url}\n  (read-only · realm edits saved to ${path.join(ARCANUM_DIR, "realms.json")})\n`);
  if (process.argv.includes("--open")) execFile("open", [url]);
});
app.server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${PORT} is busy. Set ARCANUM_PORT to use another.` : e.message);
  process.exit(1);
});
