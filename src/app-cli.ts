/* pnpm app install | uninstall | stop — the Dock launcher. Nothing here starts Arcanum at login. */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appPath, daemonPids, installApp } from "./launcher";
import { PORT } from "./paths";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cmd = process.argv[2] ?? "install", target = appPath();

if (cmd === "install") {
  installApp(target, { repo: root, node: process.execPath, pathEnv: process.env.PATH ?? "/usr/bin:/bin", port: PORT }, path.join(root, "ui", "arcanum-icon.png"));
  console.log(`Installed ${target}\nDrag it from Finder to the Dock (open ${path.dirname(target)}). Clicking it wakes Arcanum if it's asleep and opens its window.\nReinstall after moving the repo or switching Node versions.`);
} else if (cmd === "uninstall") {
  if (existsSync(target)) rmSync(target, { recursive: true }); console.log(`Removed ${target}. Also remove it from the Dock if it's pinned there.`);
} else if (cmd === "stop") {
  const pids = daemonPids(PORT);
  for (const pid of pids) process.kill(pid, "SIGTERM");
  console.log(pids.length ? `Arcanum is asleep (stopped ${pids.join(", ")} on port ${PORT}).` : `Nothing is listening on port ${PORT}.`);
} else {
  console.log("Usage: pnpm app install | uninstall | stop");
}
