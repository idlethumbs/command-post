# Arcanum backlog

Parked on 6 Nov 2026 by product. Pick up in any order.

## Product
- **Nudges.** Not always on: product rejected starting at login (6 Nov) and chose a Dock launcher instead (`pnpm app install`, done). Still open: macOS notifications while Arcanum is running but not focused, where clicking one opens that mage; a waiting count on the tab title.
- **Triage.** Order requests by blocking vs FYI and by age instead of time only: seals and old questions rise, "done, here's a summary" sinks.
- **Departed window.** It's 3 days for now. Make it configurable in the Grimoire if it ever feels wrong.

## Tech debt
- **Split `ui/app.js`** (~1,000 lines) into modules: sidebar, map view, realm view, comms, dialogs, live data.
- **Browser smoke test.** A Playwright run against an isolated daemon (temp `ARCANUM_DIR`, `ARCANUM_PROJECTS_DIR`, port), covering map, realm, reply box, summon dialog and found dialog.
- **Refresh the design spec.** `docs/specs/2026-11-04-arcanum-design.md` still describes the v1 soldier theme in places, and its milestones predate summon, departed, founding and mana.
- **Rename the folder** `~/projects/command-post` to `~/projects/arcanum`. Memory notes and the README path need updating with it.
- **Terminal and iTerm limits:** one-line replies and no images. Grey suggestion text can't be told from a draft there. (Grant/Refuse now works through hooks.)
- **Counsel vs done** is still read from Claude's wording. Hooks made the timing exact, not the intent.
