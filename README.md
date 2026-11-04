# Arcanum

A retro world map of your Claude Code sessions. Each repo is a **realm** on the map, each session is a **mage** ranked by its model (Haiku → Apprentice, Sonnet → Magician, Opus → Sorcerer, Fable → Archmage), and the **ravens** in the sidebar show who wants you, newest first.

Local only: the daemon binds to `127.0.0.1` and calls nothing outside your machine.

## Run

```sh
pnpm install
pnpm start          # http://127.0.0.1:7337  (add -- --open to open a browser)
```

Drag to pan, scroll or pinch to zoom, `0` to fit all realms, `←`/`→` + `⏎` to fast-travel, `N` for the next mage waiting on you, `⌘K` to search.

## What it reads, and what it writes

| | |
|---|---|
| Reads | `~/.claude/sessions/*.json` (live session registry), the tail of each live session's transcript under `~/.claude/projects/`, `ps` (to check that sessions are alive and which terminal hosts them), `git rev-parse` (to group folders into realms) |
| Writes | `~/.arcanum/realms.json` only: discovered realms and your charter edits (names, landmarks, banners, merges). Safe to edit by hand or delete. |
| Never | Claude Code settings, hooks or transcripts |

M1 is read-only. Replying (M3) and Open portal (M2) appear but are disabled.

## Realms

- Each git repo becomes a realm the first time a session runs in it. Worktrees join their repo.
- A repo inside a non-git folder joins that folder's realm (e.g. `orchestration/` + `orchestration/orchestrator`).
- Sessions in `$HOME`, temp dirs, or a folder holding several repos (like `~/projects`) go to **The Wilds**.
- Use **Edit realm → Absorb another realm** to group repos that belong together.

## Develop

```sh
pnpm test           # vitest
pnpm typecheck
ARCANUM_PORT=7338 ARCANUM_DIR=/tmp/arc pnpm dev   # isolated config, auto-restart
```

Design: `docs/specs/2026-11-04-arcanum-design.md` · Plan: `docs/superpowers/plans/` · Prototype: `docs/prototype/`.
