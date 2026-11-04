# Command Post — design spec

**Status:** draft for product review · 2026-11-04
**Prototype:** `docs/prototype/command-post.html` (published: https://claude.ai/artifact/7fZCWFQ7Ye6RMRcjPnKBAy) — sample data, no backend.

## 1. Problem

Many concurrent Claude Code sessions across ~6 projects, in several terminals and VS Code. The cost is context-swapping: finding which session is waiting, remembering what it was doing, and getting back to it. Command Post is a local, game-styled overview that answers three questions at a glance:

1. How many projects (operations) do I have going, and how many sessions are in each?
2. Which sessions are waiting on me, and in which project?
3. What does each waiting session want, and can I answer it without hunting for the terminal?

Non-goals for now: triage or priority scoring (we order by time), remote or cloud access, multiple users, starting new sessions (that comes later).

## 2. Theme: tactical command post

One metaphor throughout, so every UI element has an in-world name.

| System concept | In-world | Visual |
|---|---|---|
| Project (cwd root) | **Outpost** on the theatre map | Grass tile with a tent and a project-coloured flag |
| Session | **Trooper** (callsign = session name) | Pixel soldier sprite |
| Model | **Rank** | Haiku = Recruit (light helmet) · Sonnet = Sergeant (chevrons) · Opus = Captain (peaked cap, gold bars) · Fable = Commando (red beret, shades, bandolier) |
| Waiting for a reply | **Awaiting orders** | Red `!` bubble, waving |
| Waiting for permission | **Needs clearance** | Yellow `?` bubble, both hands up |
| Working | **On mission** | Typing on a field radio with a blinking antenna |
| Idle / finished | **At ease** | Sitting, drifting `z` |
| Process gone | **Off duty** | Greyed, collapsed into a "barracks" count (not on the map) |
| Notification feed | **Radio dispatches** | Ticker, latest first |
| Reply | **Issue orders** | Dialog box + text field |
| Focus terminal | **Jump to terminal** | Secondary button |

Why this theme over the alternatives (office workers, creatures, RPG party): military rank is a hierarchy people already know, so the model-to-rank mapping needs no legend; "awaiting orders" says *waiting for my input* exactly; and "issue orders" makes replying feel like the core action. The `!` bubble is borrowed from the RPG convention for "this character wants to talk to you" and works in any theme. Changing the theme later is a sprite and copy swap, because the data model below is theme-agnostic.

Visual language: 16-bit tactics game (Advance Wars / Cannon Fodder). Navy dialog frames, parchment message paper, grass-tile outposts. Fonts: Press Start 2P (display, used sparingly), Pixelify Sans (readable body), VT323 (data and timestamps). Sprites are drawn procedurally from rectangles on a 20×22 grid with an automatic 1px outline. There's no asset pipeline yet, and rank × state × frame variants are cheap.

## 3. Screens

### 3.1 HQ (overview)
- **Header stats:** outposts · troops · awaiting orders · need clearance · on mission.
- **Radio dispatches:** the 5 latest state changes that matter (awaiting / clearance / new mission), across all projects, newest first. Clicking one opens that trooper.
- **Theatre map:** one outpost card per project. The banner shows a `! n` / `? n` badge. The field shows every live trooper with their state bubble. The footer shows the latest briefing line and its age. Ordering: outposts with someone waiting first, by newest request, then by latest activity.

### 3.2 Outpost (project view)
- **Squad roster:** troopers sorted waiting-first, then newest, each with rank, age and a state chip.
- **Comms panel** for the selected trooper:
  - **Dossier:** portrait, rank and model, status and duration, position (cmux pane / Warp / VS Code / background).
  - **Briefing:** a one-paragraph "what this is about". Source: the session's `away_summary`, falling back to `ai-title`.
  - **Last transmission:** the last assistant text turn, scrollable.
  - **Issue orders:** a reply box with Send and Jump to terminal. For a clearance request, it shows the requested tool call with Approve / Deny / Jump instead.

### 3.3 Controls
Keyboard-first like a game: arrows to move, Enter to open, Esc to go back, `R` to reply, ⌘⏎ to send, and `N` to cycle through every request waiting on you, newest first, across projects. Mouse works everywhere.

## 4. Architecture

```
 ┌──────────────── browser (localhost:7337) ───────────────┐
 │  UI: Vite + vanilla TS (or Preact) · canvas sprites      │
 │  ← SSE /events      → POST /sessions/:id/reply, /focus   │
 └──────────────────────────┬──────────────────────────────┘
                            │ HTTP on 127.0.0.1 only
 ┌──────────────────────────┴──────────────────────────────┐
 │  command-post daemon (Node 20, single process)           │
 │   ├─ Registry watcher   ~/.claude/sessions/*.json        │
 │   ├─ Transcript tailer  ~/.claude/projects/*/<id>.jsonl  │
 │   ├─ Hook receiver      POST /hook  (optional, richer)   │
 │   ├─ State model        projects → sessions → events     │
 │   └─ Control adapters   reply() / focus()  (see §5)      │
 └──────────────────────────────────────────────────────────┘
```

### 4.1 Data model (theme-agnostic)
```ts
type Project = { id: string; root: string; color: string }          // grouped by git root of cwd, else cwd
type Session = {
  id: string; pid?: number; projectId: string; name: string;
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

### 4.2 Sources (verified on this machine, CLI 2.1.280)
- **Live registry** `~/.claude/sessions/<pid>.json`: sessionId, cwd, kind, entrypoint, name, `status: busy|idle|shell`, statusUpdatedAt, and a messaging socket path. Entries can outlive their process, so check the pid is alive and the procStart matches.
- **Transcript** `~/.claude/projects/<slug>/<sessionId>.jsonl`: `message.model`; `ai-title`; `system/away_summary` (an excellent ready-made briefing); assistant text blocks. Tail it from a byte offset and never re-read the whole file (these reach 8 MB+).
- **Registry status mapping:** `busy` → working (or *parked* if `parkedJobId`); `waiting` + `waitingFor:"permission prompt"` → needs clearance; `waiting` + any other `waitingFor` (input needed, dialog, sandbox) → awaiting orders; `shell` → working, shown with an "in shell" badge; no live record → gone.
- **"Awaiting" vs "idle"** is the one heuristic: the registry says `idle`, and the last assistant text ends with a question or matches the CLI's own "awaiting user" patterns → awaiting orders; otherwise at ease. `user.origin.kind` (`human` vs `peer`) tells real replies from relays. Unread state is tracked by the daemon (you've seen it once you open it in the Comms panel).
- `away_summary` is written when you *return* to the terminal, so it is often missing while you're away. The briefing falls back to the last assistant text.

### 4.3 Layout
```
command-post/
  daemon/   src/{registry,transcripts,hooks,state,adapters/*,server}.ts
  ui/       src/{hq,outpost,comms,sprites/*,sound}.ts
  docs/
```
Tests: unit tests for the transcript parser and the state reducer, using fixture JSONL captured from real sessions (scrubbed), plus a fake registry dir for watcher tests.

## 5. Control layer (replying & focusing)

Full evidence: `docs/research/2026-11-04-control-layer.md`. All tests ran on throwaway sessions only.

**Key fact:** your "Ghostty" is actually **cmux** (Ghostty embedded). cmux has a socket CLI (`cmux send / send-key / read-screen / select-workspace / focus-pane / trigger-flash`), and every session inside it has `CMUX_SURFACE_ID` in its env. Current spread: 3 sessions in cmux, 2 in Warp, 3 in VS Code, 1 background.

**Reply paths, by how much the model treats it as *you*:**

| Path | Lands as | Works for | Use |
|---|---|---|---|
| Keystrokes (`cmux send`, `tmux send-keys`, iTerm AppleScript) | a real user turn (`origin.kind: human`); can also press dialog keys | cmux, tmux, iTerm | **Primary.** Gated on registry status plus `read-screen`, so we never type into a dialog or shell by accident |
| Peer socket (`/tmp/cc-socks/<pid>.sock`, what SendMessage uses) | "another Claude session sent a message… not typed by your user". Cannot approve prompts | every live session, incl. Warp, VS Code, bg | **Fallback**, labelled in the UI as *Relay*, with a prefix saying you typed it in Command Post |
| `PermissionRequest` hook → daemon | equivalent to clicking Yes/No | sessions started after the hook is installed | **Approve/Deny** for clearance requests |
| Focus | you type | cmux/iTerm exact; Warp/VS Code app-level only | Always offered |
| SDK-owned sessions | real turn | only sessions Command Post starts | Later (M5 "deploy"), opt-in |

Never `claude --resume` a session whose process is alive (two writers fork the transcript). Resume is offered only for sessions that are gone.

**Adapter interface** (daemon): `listSessions()`, `watch(cb)`, `getConversation(id, n)`, `reply(id, text, {via})`, `answerPermission(id, reqId, allow|deny)`, `focus(id)`. Each session advertises `replyCapability: keystroke | relay | none` and `focusCapability: exact | app | none`, and the UI shows the matching buttons. Example: a Warp trooper's button reads **Send via relay**, not Send orders.

**Hooks** are an optional accelerator in M1–M2: registry + transcript already cover sessions that are running today, and hooks only bind at session start. Hooks become necessary in M3 for (a) exact cmux surface ↔ session mapping (`SessionStart` posts `$CMUX_SURFACE_ID`) and (b) remote approval. They install additively into `~/.claude/settings.json` (which has no `hooks` key today), with a `.bak`, only after you say yes, and after auditing `cmux hooks setup` so we don't race cmux's own hooks. The relay script talks to a 0600 unix socket, never TCP.

## 6. Milestones

Each milestone ends with something you can open and react to.

| # | Name | Outcome you can see | Notes |
|---|---|---|---|
| M0 | Recon (done) | This spec plus the clickable prototype | Theme, UX and sources validated |
| M1 | Live intel (read-only) | `pnpm start` serves the HQ and Outpost views with **your real sessions**, live via SSE: outposts, troopers, ranks, states, briefings, dispatch feed | Registry + transcript only. No hooks, no writes. Static 2-frame sprites as in the prototype |
| M2 | Jump to terminal | One click focuses the exact cmux pane (with a flash) for cmux sessions; Warp/VS Code at app level; background sessions open `claude attach` in a new cmux surface; gone sessions offer resume | The safe fallback ships first. cmux surface matched via `cmux tree` titles until hooks exist |
| M3 | Issue orders | Reply from the UI: real keystrokes into cmux sessions, a labelled relay for Warp/VS Code/bg; Approve/Deny for clearance requests | Needs hooks (§5) |
| M4 | Field animations | Sprite sheets per rank × state, transitions (trooper runs to the radio when a request arrives, salutes when orders are sent), map ambience, optional 8-bit sounds (off by default) | Pure UI work. Can start in parallel with M3 |
| M5 | Barracks & deploy | Off-duty list, "deploy new trooper" (start a session in a project with a chosen rank), rename callsigns | |
| Later | Triage | Priority beyond time order: blocking vs FYI, age, project weight | Explicitly deferred |

## 7. Risks
- **Undocumented internals.** The registry, transcript records and peer sockets are not a public API and may change between CLI versions. Mitigation: a single adapter module per source, a version check at startup, and a degraded read-only mode.
- **Awaiting vs idle misclassification.** Mitigation: hooks give exact signals (M3). Show the raw state on hover.
- **Two writers on one session.** Never `--resume` a session whose process is alive. Always route to the live process or focus it.
- **Privacy.** Transcripts contain client work. The daemon binds to 127.0.0.1, has no telemetry, and calls nothing outside the machine.
