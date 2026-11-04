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
| Writes | `~/.arcanum/realms.json`: discovered realms and your charter edits (names, landmarks, banners, merges); safe to edit by hand or delete. `~/.arcanum/uploads/`: images you attach, deleted after 7 days. `~/.arcanum/dismissed.json`: mages you've dismissed. |
| Runs | Only when you click Open portal, Send word, or Grant/Refuse: `cmux`, `osascript`, `tmux` or `open`, with arguments taken from `ps` and cmux, never through a shell |
| Never | Claude Code settings, hooks or transcripts |

## Send word and seals

In a realm, **Send word** (`R`, then `⌘⏎`) types your reply into the session's own prompt, so Claude records it as you typing.

| Where it runs | Send word | Grant / Refuse a permission prompt |
|---|---|---|
| cmux | Yes, multi-line, plus pasted or dropped images (up to 5, arriving as `[Image #n]` attachments) | Yes: presses the prompt's own Yes / No option |
| tmux | One line | Yes |
| Terminal.app / iTerm | One line (AppleScript) | No, so open the portal |
| Warp / VS Code / background | No: they can't be typed into, so open them instead | No |

Arcanum reads the screen before it types, and refuses rather than guessing:
- if you've left a half-typed draft in that prompt (Claude's grey suggestions don't count)
- if a permission or question dialog is open
- if the session is in shell mode

Sending while a session is casting queues your word until it finishes.

Every 5 seconds Arcanum checks that each session's cmux pane or Terminal/iTerm tab still exists. If it can't find one, that mage is marked **unreachable**: its reply box and seal buttons are withdrawn, so you never type into something that won't land. Terminal tabs are matched even when a wrapper (e.g. `kiro-cli-term`) runs Claude in an inner terminal.

## Summon and dismiss

- **Summon a mage** (in a realm, or from the sidebar) opens a new cmux workspace in one of the realm's folders, running `claude --model haiku|sonnet|opus|fable`, optionally with your first words. It starts in the background unless you tick **Switch to it in cmux now**, and Arcanum remembers your choice. The new mage appears in the realm within a second or two.
- **Dismiss** (× on a row, or the Dismiss button) removes a mage from Arcanum for good. **The session isn't closed**: it keeps running in its terminal. Restore it from **Dismissed mages** in the sidebar. The list lives in `~/.arcanum/dismissed.json`.

## Departed mages and Resume

Sessions whose terminal closed in the last 3 days stay in their realm as faded **departed** mages (☾). Arcanum only shows real conversations: interactive sessions where you typed or that have a title, never headless `claude -p` runs or temp folders. Select one to read its last missive and recent exchange, then:

- **Resume in cmux** opens a new cmux workspace in its folder running `claude --resume <session> --model <its rank>`, which continues the exact conversation.
- **Resume and send word** does the same, with your message as the first thing it reads.

Resume is refused if that session's process is running again, checked fresh at click time, because two copies would fork the conversation. Hide departed mages in the Grimoire, or Dismiss them one by one.

## Open portal

**Open portal** (or `P` in a realm) takes you to the live session:

| Where it runs | What happens |
|---|---|
| cmux | Focuses the exact pane and flashes it (uses the `cmux` CLI inside `cmux.app`) |
| Terminal.app / iTerm | Selects the exact tab by its tty (AppleScript) |
| tmux | Selects the recorded window and pane |
| Background (`claude --bg`) | Opens `claude attach <job>` in a new cmux workspace |
| Warp / Ghostty / VS Code | Raises the app window only; they can't be told which tab |

The first time a portal uses AppleScript, macOS asks you to allow your terminal to control Terminal or iTerm. If you said no, re-enable it in System Settings → Privacy & Security → Automation.

## Realms

- Each git repo becomes a realm the first time a session runs in it. Worktrees join their repo.
- A repo inside a non-git folder joins that folder's realm (e.g. `orchestration/` + `orchestration/orchestrator`).
- Sessions in `$HOME`, temp dirs, or a folder holding several repos (like `~/projects`) go to **The Wilds**.
- Use **Edit realm → Absorb another realm** to group repos that belong together.

## Spellwork and the Grimoire

- When a mage starts asking for you, a raven flies from its realm (or the mage) to the ravens list. The realm pulses and the mage hops.
- Sending word, granting or refusing a seal, and arriving by fast travel each have their own sparkle burst.
- The map's sea glints and cloud shadows drift.
- **Grimoire** (sidebar) holds the settings: **chiptune sounds**, off by default and synthesised in the browser with no audio files; **volume**; **motion**, which follows macOS by default, or Full / Calm; and **Preview a raven**.

## Develop

```sh
pnpm test           # vitest
pnpm typecheck
ARCANUM_PORT=7338 ARCANUM_DIR=/tmp/arc pnpm dev   # isolated config, auto-restart
```

Design: `docs/specs/2026-11-04-arcanum-design.md` · Plan: `docs/superpowers/plans/` · Prototype: `docs/prototype/`.
