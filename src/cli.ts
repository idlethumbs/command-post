/* pnpm hooks plan | install | uninstall | status */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPaths, hooksInstalled, install, statusScriptOf, STATUS_MARK, uninstall, withHooks, withStatusRelay } from "./install";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = defaultPaths(root), cmd = process.argv[2] ?? "plan";
const settings = JSON.parse(readFileSync(p.settings, "utf8"));
const script = statusScriptOf(settings);

if (cmd === "plan") {
  const added = withHooks(settings).hooks;
  console.log(`Would add to ${p.settings} (everything else unchanged, backup kept):\n`);
  console.log(JSON.stringify({ hooks: Object.fromEntries(Object.entries(added).filter(([k]) => !settings.hooks?.[k] || true)) }, null, 2));
  console.log(`\nWould copy the relay to ${p.relayTarget}`);
  if (script) {
    const next = withStatusRelay(readFileSync(script, "utf8"));
    console.log(next ? `\nWould add one line to ${script}, after \`read -r json_input\` (backup kept):\n\n${next.split("\n").find(l => l.includes(STATUS_MARK))}` : `\n${script} isn't a script Arcanum recognises; it would be left alone.`);
  }
} else if (cmd === "install") {
  const r = install(p);
  console.log(`Installed. Backups:\n  ${r.backups.join("\n  ")}${r.status ? `\nStatus line relay added to ${r.status}` : ""}\nNew Claude sessions will report to Arcanum; running ones keep today's behaviour.`);
} else if (cmd === "uninstall") {
  const r = uninstall(p);
  console.log(`Removed Arcanum's hooks and status line relay. Backups:\n  ${r.backups.join("\n  ")}`);
} else {
  console.log(`hooks: ${hooksInstalled(settings) ? "installed" : "not installed"} · status relay: ${script && readFileSync(script, "utf8").includes(STATUS_MARK) ? "installed" : "not installed"}`);
}
