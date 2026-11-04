# M1 — Live Realms (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm start` serves Arcanum on http://127.0.0.1:7337, showing the user's real, live Claude Code sessions as mages in auto-discovered realms on a pannable, zoomable world map. It updates live, and nothing on the machine is written except `~/.arcanum/realms.json`.

**Architecture:** A single Node 20 process. On every change it (1) scans `~/.claude/sessions/*.json` and checks each pid against `ps` for liveness and parent chain; (2) reads the tail of each live session's transcript JSONL; (3) maps cwd → git root → realm, using persisted realm config; (4) classifies state. It serves a snapshot at `GET /api/state`, pushes updates over SSE `GET /api/events`, and accepts charter edits. The UI is plain ES modules ported from the prototype (no bundler), with fonts served locally from `@fontsource` packages so the browser fetches nothing external.

**Tech Stack:** Node 20, TypeScript run via `tsx`, `node:http`, `vitest`. UI is vanilla JS ES modules plus canvas. `@fontsource/pixelify-sans` and `@fontsource/jacquard-24` provide the fonts.

**Spec:** `docs/specs/2026-11-04-arcanum-design.md`. **Prototype to port:** `docs/prototype/command-post.html`.

**Product additions since the spec (4 Nov):** the map must be **click-drag pannable and zoomable like an RTS map, fitting all realms by default**, and must cope with **many realms**. That means world coordinates instead of percentages, a world size that grows with realm count, label decluttering when zoomed out, and terrain generation that only considers nearby realms per pixel.

---

## File structure

```
package.json, tsconfig.json, vitest.config.ts
src/
  paths.ts          resolved dirs (CLAUDE_DIR, ARCANUM_DIR) — overridable for tests
  procs.ts          one `ps` call → Map<pid, {ppid, lstart, comm}>; host detection
  registry.ts       read ~/.claude/sessions/*.json → live RegistryEntry[]
  transcript.ts     find + tail-parse a session JSONL → TranscriptSummary
  classify.ts       registry status + transcript → MageState + since
  realms.ts         cwd → land root (git) → realm; config load/save; defaults; placement
  snapshot.ts       glue: build Snapshot {realms, sessions}
  server.ts         http: static UI, /api/state, /api/events (SSE), PATCH/POST realm edits
  main.ts           start server, watchers, print URL
ui/
  index.html        shell (sidebar + stage), links styles + fonts
  styles.css        ported from prototype v3
  art.js            colour/noise helpers, renderSprite, drawMage, drawLandmark, buildTerrain, buildBackdrop
  map.js            world view: pan/zoom camera, fit, sites, declutter, fast travel
  app.js            state, sidebar, realm view, charter, keyboard, SSE client
test/
  fixtures/*.jsonl  synthetic transcripts
  *.test.ts
```

## Types (shared contract, defined in `src/types.ts`)

```ts
export type Model = "haiku" | "sonnet" | "opus" | "fable";
export type MageState = "counsel" | "seal" | "cast" | "rest";
export type Host = "cmux" | "warp" | "iterm" | "tmux" | "ghostty" | "terminal" | "vscode" | "bg" | "unknown";
export interface RegistryEntry { pid: number; sessionId: string; cwd: string; kind: string; entrypoint: string; name: string;
  status: string; waitingFor?: string; statusUpdatedAt: number; procStart: string; parkedJobId?: string; version?: string }
export interface TranscriptSummary { model?: string; aiTitle?: string; awaySummary?: { text: string; at: number };
  lastAssistantText?: { text: string; at: number }; lastHumanAt?: number; gitBranch?: string }
export interface Realm { id: string; name: string; lands: string[]; landmark: string; banner: string; pos: { x: number; y: number }; discoveredAt: number }
export interface Session { id: string; pid: number; realmId: string; name: string; title?: string; model: Model; modelId?: string;
  state: MageState; since: number; host: Host; where: string; briefing: string; lastText?: string; waitingFor?: string; cwd: string; branch?: string }
export interface Snapshot { generatedAt: number; realms: Realm[]; sessions: Session[] }
```

---

### Task 1: Scaffold

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `src/paths.ts`.

- [ ] Step 1: `package.json` with scripts `start: tsx src/main.ts`, `test: vitest run`, `dev: tsx watch src/main.ts`; deps `@fontsource/pixelify-sans`, `@fontsource/jacquard-24`; devDeps `tsx`, `typescript`, `vitest`, `@types/node`. `"type": "module"`.
- [ ] Step 2: `src/paths.ts`:
```ts
import os from "node:os"; import path from "node:path";
export const CLAUDE_DIR = process.env.ARCANUM_CLAUDE_DIR ?? path.join(os.homedir(), ".claude");
export const ARCANUM_DIR = process.env.ARCANUM_DIR ?? path.join(os.homedir(), ".arcanum");
export const PORT = Number(process.env.ARCANUM_PORT ?? 7337);
```
- [ ] Step 3: `pnpm install && pnpm test` → "No test files found" (exit code accepted). Commit `chore: scaffold`.

### Task 2: Process table + host detection (`src/procs.ts`)

- [ ] Step 1: test `test/procs.test.ts`:
```ts
import { parsePs, detectHost } from "../src/procs";
const PS = ` 100     1 Tue Nov  3 15:28:45 2026     /Applications/cmux.app/Contents/MacOS/cmux
 200   100 Tue Nov  3 15:28:50 2026     /bin/zsh
 300   200 Tue Nov  3 15:29:00 2026     claude
 400     1 Tue Nov  3 15:00:00 2026     /Applications/Warp.app/Contents/MacOS/stable
 500   400 Tue Nov  3 15:01:00 2026     claude`;
test("parses ps rows", () => { const t = parsePs(PS); expect(t.get(300)).toEqual({ ppid: 200, lstart: "Tue Nov  3 15:29:00 2026", comm: "claude" }); });
test("walks parents to find host", () => { const t = parsePs(PS); expect(detectHost(t, 300)).toBe("cmux"); expect(detectHost(t, 500)).toBe("warp"); expect(detectHost(t, 999)).toBe("unknown"); });
```
- [ ] Step 2: run, expect FAIL (module missing).
- [ ] Step 3: implement. `parsePs` regex `^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s+(.*)$`. `detectHost` walks ppid up to 25 levels and matches comm (case-insensitive): `/cmux/`→cmux, `/warp/`→warp, `/iterm/`→iterm, `/tmux/`→tmux, `/ghostty/`→ghostty, `/Terminal\.app/`→terminal, `/Code Helper|Visual Studio Code|Electron/`→vscode. `readPs()` runs `LC_ALL=C ps -axo pid=,ppid=,lstart=,comm=` via `execFileSync`.
- [ ] Step 4: tests pass. Commit.

### Task 3: Registry (`src/registry.ts`)

- [ ] Step 1: test with a temp dir containing `100.json` (alive per fake ps, matching lstart), `101.json` (pid missing from ps), `102.json` (pid present but lstart differs), and `100.abc.key` (ignored). Expect `readRegistry(dir, ps)` to return only pid 100.
- [ ] Step 2: FAIL. Step 3: implement. Read `/^\d+\.json$/` files, JSON.parse inside try, keep an entry when `ps.get(pid)?.lstart === entry.procStart.replace(/\s+/g," ")` (normalise whitespace on both sides). Step 4: PASS. Commit.

### Task 4: Transcript tail parser (`src/transcript.ts`)

- [ ] Step 1: fixture `test/fixtures/basic.jsonl` with, in order: an `assistant` record (model `claude-opus-5-5`, text "Old"), a `user` record with string content and `origin.kind:"human"` at T1, `ai-title` "Fix the thing", an `assistant` thinking-only record, an `assistant` text record "Two options… Which do you want?" at T2 > T1, a `user` tool_result record (must not count as human), and `system/away_summary` "We're choosing a backfill." at T3. Tests:
```ts
const s = parseTranscript(readFileSync(fx("basic.jsonl"), "utf8"));
expect(s.model).toBe("claude-opus-5-5"); expect(s.aiTitle).toBe("Fix the thing");
expect(s.lastAssistantText?.text).toMatch(/Which do you want\?$/); expect(s.lastHumanAt).toBe(Date.parse(T1));
expect(s.awaySummary?.text).toBe("We're choosing a backfill.");
```
plus a test that a truncated first line (tail cut mid-record) is skipped without throwing.
- [ ] Step 2: FAIL. Step 3: implement:
  - `parseTranscript(text)`: split on `\n`, JSON.parse each line in try.
  - `assistant` sets `model`. If it has text blocks, join them; if the previous text record shares `message.id`, append, otherwise replace `lastAssistantText`.
  - `user` counts as human when `origin?.kind === "human"`, or when it has no origin, isn't meta, and its content is a string.
  - `ai-title` sets `aiTitle`; `system/away_summary` sets `awaySummary`; `gitBranch` is taken from any record.
  - `findTranscript(claudeDir, sessionId)` scans `projects/*/` for `<sessionId>.jsonl`, with the result cached.
  - `readTail(file, bytes = 512*1024)` reads the last N bytes.
- [ ] Step 4: PASS. Commit.

### Task 5: Classification (`src/classify.ts`)

- [ ] Step 1: table test:

| registry | transcript | expected |
|---|---|---|
| busy | — | cast |
| waiting + "permission prompt" | — | seal |
| waiting + "input needed" | — | counsel |
| shell | — | cast |
| idle | last text "…Which do you want?" after lastHuman | counsel |
| idle | last text "Done. All tests pass." | rest |
| idle | last text ends "?" but older than lastHuman | rest |
| idle | "Shall I proceed with the commit" (no ?) | counsel |

`since` = `statusUpdatedAt`. `modelOf("claude-fable-5-1")` → fable; `"claude-haiku-4-5-20251001"` → haiku; unknown/undefined → opus (the user's default model is `opus[1m]`).
- [ ] Step 2: FAIL. Step 3: implement. "Asks" means the trimmed text ends with `?`, or its last 300 chars match `/\b(shall i|should i|do you want|would you like|which (one|option)|let me know|your call|okay to proceed|ok to proceed|awaiting (your )?(input|decision|approval|feedback))\b/i`. Step 4: PASS. Commit.

### Task 6: Realms (`src/realms.ts`)

- [ ] Step 1: tests (injected `gitRoot(cwd) → string | null` and fake fs for "is a container"):
  - The repo `/p/agent-rails` and its worktree `/p/agent-rails/.claude/worktrees/x` (gitRoot returns `/p/agent-rails` via `--git-common-dir`) → one realm, `lands: ["/p/agent-rails"]`.
  - Non-git `/p/orchestration` processed before the repo `/p/orchestration/orchestrator` → one realm.
  - `/p` (contains ≥3 git repos), `$HOME`, `/private/tmp/...` and `os.tmpdir()/...` → the `wilds` realm.
  - A config realm with `lands: ["/p/lmax-a", "/p/lmax-b"]` captures sessions from both.
  - Defaults are deterministic: the same root always gives the same landmark and banner; `name` is humanised (`agent-rails` → `Agent Rails`).
  - Placement: 40 realms placed sequentially are all ≥ `2*R` apart (R = 70 world px) and every position is finite.
- [ ] Step 2: FAIL. Step 3: implement:
  - `landRoot(cwd)` = gitRoot(cwd) ?? cwd.
  - `assign(roots, config)`: sort by path length; for each root, the longest land in config that is the root or one of its ancestors wins (wilds excluded); otherwise create a realm.
  - Placement: candidates on a spiral from the centroid of existing positions (step R/2); pick the first candidate ≥ 2R from all realms.
  - Hash: FNV-1a of the root picks the landmark (from 8) and banner (from 7).
  - `loadConfig()` / `saveConfig()` use `~/.arcanum/realms.json`, written atomically (write tmp, then rename).
- [ ] Step 4: PASS. Commit.

### Task 7: Snapshot (`src/snapshot.ts`)

- [ ] Step 1: integration test with a temp CLAUDE_DIR (sessions + projects with fixture transcript), a fake ps, a fake gitRoot and a temp ARCANUM_DIR. `buildSnapshot()` returns one realm and one session with the expected state, `where` and briefing. It also writes `realms.json` once, and a second call reuses the same realm id.
- [ ] Step 2: FAIL. Step 3: implement:
  - Briefing = `awaySummary.text` if it is newer than `lastHumanAt`; else the first sentence (≤ 220 chars) of the last assistant text; else `aiTitle`; else "No word yet."
  - `lastText` = the last assistant text, trimmed to its final 4000 chars.
  - `where`: cmux → "cmux"; vscode → "VS Code"; bg → "Background"; etc.
  - The snapshot includes every realm in config, including ones with no live sessions.
- [ ] Step 4: PASS. Commit.

### Task 8: Server (`src/server.ts`, `src/main.ts`)

- [ ] Step 1: test: start on port 0 with injected `getSnapshot`. `GET /api/state` → 200 JSON. `GET /` → HTML containing `<title>Arcanum</title>`. `PATCH /api/realms/:id {name}` → 200 and persisted. `POST /api/realms/:id/absorb {other}` merges lands and deletes the other. Paths containing `..` → 404. The server binds `127.0.0.1` only.
- [ ] Step 2: FAIL. Step 3: implement:
  - Static routes: `/` → `ui/index.html`; `/ui/*` → `ui/`; `/fonts/*` → `node_modules/@fontsource/*/files`.
  - SSE: `/api/events` sends `data: <snapshot>` on change, plus a `:ping` every 15s.
  - `main.ts`: `fs.watch` the sessions dir and each live transcript file (re-armed after each scan); debounce 250ms; plus a 5s interval for liveness. Rebuild, and broadcast only if the JSON changed. Print the URL.
- [ ] Step 4: PASS. Commit.

### Task 9: UI port (`ui/*`)

- [ ] Step 1: Move the prototype CSS into `ui/styles.css` and the art functions verbatim into `ui/art.js` as exports: helpers, `renderSprite`, `drawMage`, `drawLandmark`, `BIOME`, `LANDMARKS`, `buildBackdrop`. `@font-face` rules point at `/fonts/...woff2`.
- [ ] Step 2: `ui/map.js`, the RTS camera:
  - The world is a fixed-size `div.world` (W×H world px × 3 CSS px). Its size is the bounding box of realm positions plus a 160px margin, with a minimum of 900×560.
  - Terrain uses `buildTerrain(W, H, realms)`, with a spatial bucket grid (cell = 3R) so each pixel only checks realms in neighbouring cells.
  - Camera `{x, y, z}` with `transform: translate(x,y) scale(z)`, z ∈ [0.25, 3]. Pointer drag pans, with a click-vs-drag threshold of 4px so clicks still open realms. Wheel and trackpad pinch (`ctrlKey` wheel) zoom about the cursor. Toolbar has + / − / Fit. Keyboard: `+` `-` `0`=fit.
  - **Fit by default:** when first shown and after discoveries, fit the bbox of all realms with 60px padding. The camera is remembered across visits in sessionStorage.
  - **Declutter:** at z < 0.7, hide `.tag` names for realms with no requests (pins stay). At z < 0.45, show landmarks only, plus red/gold pins.
  - Fast travel: animate the camera to the realm at z=2.4 over 450ms with the flash, then open the realm.
- [ ] Step 3: `ui/app.js`: fetch `/api/state`, subscribe to `EventSource('/api/events')`, and re-render the sidebar always and the stage only if its inputs changed (so typing in Send word isn't lost). Sidebar, realm view, charter (via PATCH/absorb) and keyboard are as in the prototype. Send / Portal / Grant buttons render **disabled**, with "Arrives in M2/M3" text. Unread state lives in localStorage.
- [ ] Step 4: manual check: `pnpm start`, open the URL, see your real realms. Commit.

### Task 10: Verify + docs

- [ ] `pnpm test` all green. Start the server, `curl -s 127.0.0.1:7337/api/state | head -c 400` shows real sessions, and the browser shows the map with real realms. Add a `README.md` with run instructions and a note that the app is read-only. Commit.

---

## Self-review notes
- Spec §3.1 rules → Task 6; §4.1–4.3 → Task 9; §5.2 sources → Tasks 3–5; §8 risks: version gate (log a warning if the registry `version` major/minor differs from 2.1) → Task 7.
- Not in M1 (by design): hooks, replies, focus, the departed archive, summon.
