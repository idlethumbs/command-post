# M2 — Open Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click on **Open portal** brings you to the live session. It focuses the exact cmux pane (with a flash), the exact Terminal.app or iTerm tab (by tty), or a tmux window. Warp, VS Code and Ghostty get their app window raised. A background session opens `claude attach <job>` in a new cmux workspace. M1's rough edges get fixed along the way.

**Architecture:** `src/portal.ts` splits into a pure **planner** (session + process table + cmux layout → a list of `{cmd, args}` steps, a precision and a message) and a small **runner** that `execFile`s the steps with no shell. Every argument comes from validated sources: UUIDs from cmux output, `ttysNNN` from `ps`, job ids matching `/^[0-9a-f]{8}$/`. AppleScript gets the tty through `on run argv`, never by string interpolation. The server exposes `POST /api/sessions/:id/portal`.

**Verified facts (4 Nov, cmux 0.64):**
- `cmux top --all --processes --format tsv --id-format both` lists surface → process rows, so a claude pid is mapped to its surface by walking `ps` parents.
- `cmux select-workspace --workspace <uuid>`, `cmux rpc surface.focus {"surface_id": <uuid>}` and `cmux trigger-flash --surface <uuid> --workspace <uuid>` all work and need no hooks.
- Registry bg entries carry `jobId`; a parked interactive entry carries `parkedJobId` pointing at that bg session.

## Tasks

### Task 1: `ps` gains a tty column
- [ ] Test: `parsePs` reads `pid ppid tty lstart comm`; `tty` is `"ttys001"` or `undefined` for `??`.
- [ ] Implement: `ps -axo pid=,ppid=,tty=,lstart=,comm=`; update the regex and `ProcInfo`. Run all tests, commit.

### Task 2: cmux layout parser
- [ ] Test, using a fixture TSV copied from real output (titles scrubbed): `parseCmuxTop(tsv)` → `{ surfaceOfPid: Map<pid, surfaceUuid>, surfaces: Map<surfaceUuid, { workspace, window }> }`. `cmuxSurfaceFor(pid, layout, ps)` walks ps parents until it hits a mapped pid.
- [ ] Implement, PASS, commit.

### Task 3: Portal planner
- [ ] Table tests for `planPortal(session, ctx)`:

  | host | ctx | steps | precision |
  |---|---|---|---|
  | cmux | surface found | select-workspace, rpc surface.focus, open -a cmux, trigger-flash | exact |
  | cmux | surface not found | open -a cmux | app |
  | terminal | tty ttys001 | osascript (Terminal script, argv /dev/ttys001) | exact |
  | iterm | tty | osascript (iTerm script) | exact |
  | tmux | registry tmux target | tmux select-window, select-pane | exact |
  | warp / ghostty | — | open -a Warp / Ghostty | app |
  | vscode | cwd | open -a "Visual Studio Code" cwd | app |
  | bg | jobId 481d6b12, cmux present | cmux new-workspace --name … --cwd … --command "claude attach 481d6b12" | exact |
  | bg | jobId malformed | none, with an error message | none |
  | unknown | — | none, message says where it runs | none |

- [ ] Implement `planPortal` and `runPortal`. The runner reports the first failing step; osascript's "missing" output → `{ ok: false, message: "That tab has closed." }`.

### Task 4: Wire up
- [ ] Snapshot adds `portal: "exact" | "app" | "none"` and `note?: string` per session.
- [ ] Server: `POST /api/sessions/:id/portal`; test with an injected `openPortal`.
- [ ] UI: Open portal is enabled, labelled by precision ("Open portal" vs "Raise Warp"), and toasts the result. The realm view shows the note.

### Task 5: M1 rough edges
- [ ] **Parked sessions:** `parkedJobId` → state `rest`, with the note "Handed its work to background job …", and the bg session's name if it is live. Test it.
- [ ] **Distinct landmarks:** a new realm takes the first unused landmark, starting from its hash index; it only falls back to the hash when all 8 are taken. Test it. Existing realms keep theirs (the user may have chosen them).

### Task 6: Verify
- [ ] `pnpm test`, typecheck. Manually: Open portal on this session's own cmux pane (safe: it is already in front) → flash. Commit and update the README.
