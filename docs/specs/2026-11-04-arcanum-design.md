# Arcanum — design spec

**Status:** draft v3 · 2026-11-04. Product decisions so far: magic theme (v1 soldiers rejected); realm = repo with merge overrides (§3.1, approved); full-screen map plus sidebar; painted-VGA art.
**Prototype:** `docs/prototype/command-post.html` (published: https://claude.ai/artifact/7fZCWFQ7Ye6RMRcjPnKBAy). Sample data, no backend.

## 1. Problem

Many Claude Code sessions run at once across several repos, in several terminals and VS Code. The cost is context-swapping: finding which session is waiting, remembering what it was doing, and getting back to it. Arcanum is a local, game-styled overview that answers three questions at a glance:

1. How many bodies of work (realms) do I have going, and how many sessions are in each?
2. Which sessions are waiting on me, and in which realm?
3. What does each waiting session want, and can I answer it without hunting for the terminal?

Non-goals for now: triage or priority scoring (we order by time), remote or cloud access, multiple users. Starting new sessions comes later.

## 2. Theme: realms and mages

One metaphor throughout, so every UI element has an in-world name.

| System concept | In-world | Visual |
|---|---|---|
| Group of repos/folders | **Realm**: a region on the world map | Biome-coloured island with a landmark and banner |
| Session | **Mage** (name = session name) | Pixel mage sprite |
| Model | **Rank** | Haiku = Apprentice (hooded, wand) · Sonnet = Magician (blue hat, staff) · Opus = Sorcerer (purple, stars, gold trim) · Fable = Archmage (white robes, beard, glowing staff) |
| Waiting for a reply | **Seeks counsel** | Red `!` bubble, staff raised |
| Waiting for permission | **Awaits your seal** | Gold `?` bubble, holds out a sealed scroll |
| Working | **Casting** | Staff gem pulses, sparkles |
| Idle / finished | **Meditating** | Settled, eyes closed, drifting `z` |
| Process gone | **Departed** | Not on the map; listed in the realm's archive with "resume" |
| Notification feed | **Ravens** | Feed, newest first |
| Reply | **Send word** (via cmux) / **Send by raven** (relay) | Text box; the label says which path it takes |
| Approve / deny | **Grant seal** / **Refuse** | |
| Focus terminal | **Open portal** | |
| Open a realm | **Fast travel** | The map zooms into the landmark, then the realm materialises |

Visual language: see §4.4. Indigo night chrome, and parchment for anything Claude wrote. The data model (§5) is theme-agnostic, so the theme stays a skin.

## 3. Realms

### 3.1 What a realm is
A realm is **a named group of "lands"**, where a land is a path rule (a repo root or a folder).
- **Discovery default:** each git repository root becomes its own realm the first time a session runs in it. Worktrees (`<repo>/.claude/worktrees/*`, and other `git worktree`s via `--git-common-dir`) fold into their repo's realm. A non-git folder becomes a realm by itself, and a repo nested inside a non-git folder that's already a realm joins it. Example: `orchestration/` (no git) and `orchestration/orchestrator` (a repo) form one realm.
- **Your override:** rename a realm, or have one realm absorb another, e.g. one "LMAX" realm over `lmax-frontend-tools` and `lmax-corp-nextjs`. Overrides are stored in `~/.arcanum/realms.json`, which you can edit by hand.
- Sessions outside any repo (e.g. started in `~/projects` itself or a temp scratchpad) land in a shared **Wilds** realm.
- Claude's own per-folder project dirs (`~/.claude/projects/<slug>`) are only used to find transcripts. They do not define realms, because they split worktrees and subfolders of the same work.

### 3.2 How a realm looks
On discovery, a realm gets a **landmark** (castle, tower, grove, cavern, volcano, pyramid, spire, village), whose **biome** colours its region of the map, plus a **banner colour** and a **map position**. All three are picked deterministically from a hash of the repo path, so they're stable. You can change any of them in the realm's **charter**, and the prototype's charter shows this. New realms appear under fog, then are revealed with a "New realm discovered" raven.

Map layout: each realm owns a position. Land grows around it with noise, and each tile takes the biome of its nearest realm, so every realm reads as its own region. New realms are placed in the largest free stretch of sea. Later milestones can allow dragging realms around and hand-painted landmark art, which can replace the procedural sprites per realm.

## 4. Screens

The app is a full-height shell: a **persistent left sidebar** plus a **main stage**. The world map fills the stage, and realm views open inside it.

### 4.1 Sidebar (always visible)
- **Brand + summary:** realms · mages · casting.
- **Navigation:** World map · **Scry** (search mages by name, realm, rank or topic; ⌘K) · Summon a mage (M5) · Archive of the departed (M5) · Grimoire, i.e. settings: sound, hooks status, theme (M3+). Items that come later are shown but disabled and labelled LATER, so the nav doesn't change shape as features arrive.
- **Waiting on you:** `! n counsel` `? n seal` counts and a **Next ▸** button (same as `N`), which goes to the newest unanswered request across realms.
- **Ravens:** every mage's latest state change, newest first, filterable *All / Needs you*. Each shows a realm colour dot, name · realm, state glyph, age and a two-line excerpt. Unread requests carry a dot until you open that mage. Resting mages are dimmed.
- Below 900px wide, the sidebar stacks under the stage.

### 4.2 World map (stage)
- A painted overworld that fills the stage. The **newest request floats as a raven banner** under the title scroll; clicking it fast-travels to that mage.
- Each realm is a region with its landmark and a tag with its name plus `!n ?n ✦n` pins. Arrow keys cycle through realms (waiting-first, then newest). Enter fast-travels: the map zooms into the landmark with a light flash, and the realm materialises.
- Overlays: legend (bottom-left) and key hints (bottom-right), plus a dev-only "simulate a discovery" button in the prototype.

### 4.3 Realm view (stage)
- **Scene:** a painted backdrop for the realm's biome (sky, two hill layers, ground), the landmark at 2× detail, and every live mage standing with their state bubble. Click a mage to select it.
- **Circle:** a compact list of the same mages, waiting-first, then newest.
- **Comms panel:** portrait, rank/model, state and duration, where it lives; **The matter at hand** (briefing); **Latest missive**; **Send word** / **Send by raven**, or **Grant seal / Refuse** for permission requests; **Open portal** always.
- **Edit realm** opens the charter (name, landmark, banner, lands, absorb another realm).

### 4.4 Art direction
Painted-VGA, closer to *Monkey Island 2* than *1*. Everything is drawn with vector paths and gradients at a low native resolution, then upscaled ×3 with hard pixels, so shapes are smooth and shaded while still reading as pixel art. Terrain and backdrops use ordered (Bayer) dithering across 5-step colour ramps per biome, plus hill-shading, foam lines, and subtle borders between realm regions. Characters get a soft dark outline. UI type is Pixelify Sans (rounded, readable). Jacquard 24 is used only for the app, map and realm titles.

### 4.5 Controls
Arrows, Enter to travel, Esc back to the map, `R` reply, ⌘⏎ send, `N` next waiting mage, ⌘K scry. Mouse works everywhere.

## 5. Architecture

```
 ┌──────────────── browser (localhost:7337) ───────────────┐
 │  UI: Vite + vanilla TS (or Preact) · canvas sprites      │
 │  ← SSE /events      → POST /sessions/:id/reply, /focus   │
 └──────────────────────────┬──────────────────────────────┘
                            │ HTTP on 127.0.0.1 only
 ┌──────────────────────────┴──────────────────────────────┐
 │  arcanum daemon (Node 20, single process)           │
 │   ├─ Registry watcher   ~/.claude/sessions/*.json        │
 │   ├─ Transcript tailer  ~/.claude/projects/*/<id>.jsonl  │
 │   ├─ Hook receiver      POST /hook  (optional, richer)   │
 │   ├─ State model        projects → sessions → events     │
 │   └─ Control adapters   reply() / focus()  (see §6)      │
 └──────────────────────────────────────────────────────────┘
```

### 5.1 Data model (theme-agnostic)
```ts
type Realm = { id: string; name: string; lands: string[]; landmark: string; banner: string; pos: { x: number; y: number }; discoveredAt: number }  // see §3.1
type Session = {
  id: string; pid?: number; realmId: string; name: string;
  kind: "terminal" | "vscode" | "background";
  model?: "haiku" | "sonnet" | "opus" | "fable";                       // from the latest assistant message.model
  state: "awaiting" | "permission" | "working" | "idle" | "gone";
  stateSince: number;
  title?: string; briefing?: string; lastAssistantText?: string;
  pendingPermission?: { tool: string; summary: string };
  terminal?: { app: "ghostty" | "iterm" | "vscode" | "unknown"; tty?: string };
}
type Dispatch = { at: number; sessionId: string; kind: "awaiting" | "permission" | "working"; text: string }
```

### 5.2 Sources (verified on this machine, CLI 2.1.280)
- **Live registry** `~/.claude/sessions/<pid>.json`: sessionId, cwd, kind, entrypoint, name, `status: busy|idle|shell`, statusUpdatedAt, and a messaging socket path. Entries can outlive their process, so check the pid is alive and the procStart matches.
- **Transcript** `~/.claude/projects/<slug>/<sessionId>.jsonl`: `message.model`; `ai-title`; `system/away_summary` (an excellent ready-made briefing); assistant text blocks. Tail it from a byte offset and never re-read the whole file (these reach 8 MB+).
- **Registry status mapping:** `busy` → working (or *parked* if `parkedJobId`); `waiting` + `waitingFor:"permission prompt"` → needs clearance; `waiting` + any other `waitingFor` (input needed, dialog, sandbox) → awaiting orders; `shell` → working, shown with an "in shell" badge; no live record → gone.
- **"Awaiting" vs "idle"** is the one heuristic: the registry says `idle`, and the last assistant text ends with a question or matches the CLI's own "awaiting user" patterns → awaiting orders; otherwise at ease. `user.origin.kind` (`human` vs `peer`) tells real replies from relays. Unread state is tracked by the daemon (you've seen it once you open it in the Comms panel).
- `away_summary` is written when you *return* to the terminal, so it is often missing while you're away. The briefing falls back to the last assistant text.

### 5.3 Layout
```
command-post/
  daemon/   src/{registry,transcripts,hooks,state,adapters/*,server}.ts
  ui/       src/{world-map,realm,comms,charter,sprites/*,sound}.ts
  docs/
```
Tests: unit tests for the transcript parser and the state reducer, using fixture JSONL captured from real sessions (scrubbed), plus a fake registry dir for watcher tests.

## 6. Control layer (replying & focusing)

Full evidence: `docs/research/2026-11-04-control-layer.md`. All tests ran on throwaway sessions only.

**Key fact:** your "Ghostty" is actually **cmux** (Ghostty embedded). cmux has a socket CLI (`cmux send / send-key / read-screen / select-workspace / focus-pane / trigger-flash`), and every session inside it has `CMUX_SURFACE_ID` in its env. Current spread: 3 sessions in cmux, 2 in Warp, 3 in VS Code, 1 background.

**Decision (product, 4 Nov): cmux is home.** You said sessions can run wherever works best, so new sessions are started in cmux, where Send word lands as a real user turn and Open portal hits the exact pane. Existing Warp / VS Code / background sessions still show up, get **Send by raven** (the relay), and get app-level Open portal. Optional later: a "move to cmux" action that ends the old session and resumes it in a new cmux pane, only once the old process has exited.

**Reply paths, by how much the model treats it as *you*:**

| Path | Lands as | Works for | Use |
|---|---|---|---|
| Keystrokes (`cmux send`, `tmux send-keys`, iTerm AppleScript) | a real user turn (`origin.kind: human`); can also press dialog keys | cmux, tmux, iTerm | **Primary.** Gated on registry status plus `read-screen`, so we never type into a dialog or shell by accident |
| Peer socket (`/tmp/cc-socks/<pid>.sock`, what SendMessage uses) | "another Claude session sent a message… not typed by your user". Cannot approve prompts | every live session, incl. Warp, VS Code, bg | **Fallback**, labelled in the UI as *Relay*, with a prefix saying you typed it in Arcanum |
| `PermissionRequest` hook → daemon | equivalent to clicking Yes/No | sessions started after the hook is installed | **Approve/Deny** for clearance requests |
| Focus | you type | cmux/iTerm exact; Warp/VS Code app-level only | Always offered |
| SDK-owned sessions | real turn | only sessions Arcanum starts | Not needed: M5 "summon" launches into cmux instead |

Never `claude --resume` a session whose process is alive (two writers fork the transcript). Resume is offered only for sessions that are gone.

**Adapter interface** (daemon): `listSessions()`, `watch(cb)`, `getConversation(id, n)`, `reply(id, text, {via})`, `answerPermission(id, reqId, allow|deny)`, `focus(id)`. Each session advertises `replyCapability: keystroke | relay | none` and `focusCapability: exact | app | none`, and the UI shows the matching buttons. Example: a Warp mage's button reads **Send by raven**, not Send word.

**Hooks** are an optional accelerator in M1–M2: registry + transcript already cover sessions that are running today, and hooks only bind at session start. Hooks become necessary in M3 for (a) exact cmux surface ↔ session mapping (`SessionStart` posts `$CMUX_SURFACE_ID`) and (b) remote approval. They install additively into `~/.claude/settings.json` (which has no `hooks` key today), with a `.bak`, only after you say yes, and after auditing `cmux hooks setup` so we don't race cmux's own hooks. The relay script talks to a 0600 unix socket, never TCP.

## 7. Milestones

Each milestone ends with something you can open and react to.

| # | Name | Outcome you can see | Notes |
|---|---|---|---|
| M0 | Recon (done) | This spec plus the clickable prototype (v2: magic theme, world map, realm charter) | Theme, UX and sources validated |
| M1 | Live realms (read-only) | `pnpm start` serves the world map and realm views with **your real sessions**, live: auto-discovered realms (repo rule, §3.1), mages with real ranks and states, briefings, ravens. Charter edits saved to `~/.arcanum/realms.json` | Registry + transcript only. No hooks, no writes to Claude. 2-frame sprites as in the prototype |
| M2 | Open portal | One click focuses the exact cmux pane (with a flash); Warp/VS Code at app level; background sessions open `claude attach` in a new cmux pane; departed sessions offer resume | The safe fallback ships first. cmux pane matched via `cmux tree` titles until hooks exist |
| M3 | Send word | Reply from the UI: real keystrokes into cmux sessions, ravens (relay) for the rest; Grant seal / Refuse for permission requests | Needs hooks (§6) |
| M4 | Spellwork | Animated transitions (a mage turns to face you when it starts seeking counsel, a spell burst when you send word), map ambience (waves, smoke, crystals glinting), better fast-travel, optional chiptune sounds (off by default) | Pure UI work. Can start in parallel with M3 |
| M5 | Summon & archive | Summon a new mage into a realm with a chosen rank (opens a cmux pane running `claude --model …`); a departed archive per realm; drag realms on the map; upload custom landmark art | |
| Later | Triage | Priority beyond time order: blocking vs FYI, age, realm weight | Explicitly deferred |

## 8. Risks
- **Undocumented internals.** The registry, transcript records and peer sockets are not a public API and may change between CLI versions. Mitigation: a single adapter module per source, a version check at startup, and a degraded read-only mode.
- **Awaiting vs idle misclassification.** Mitigation: hooks give exact signals (M3). Show the raw state on hover.
- **Two writers on one session.** Never `--resume` a session whose process is alive. Always route to the live process or focus it.
- **Privacy.** Transcripts contain client work. The daemon binds to 127.0.0.1, has no telemetry, and calls nothing outside the machine.
