import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Chromium browsers that can open a chromeless `--app=` window, in order of preference. */
export const APP_BROWSERS = ["Brave Browser", "Google Chrome", "Microsoft Edge", "Chromium"];
export const BUNDLE_ID = "local.arcanum.launcher";
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export interface LauncherOpts { repo: string; node: string; pathEnv: string; port: number }

/**
 * The launcher's executable: start the daemon if nothing answers on the port, then focus the
 * Arcanum window if one is open, else open a new chromeless one. Never starts anything at login.
 */
export function launcherScript(o: LauncherOpts): string {
  const url = `http://127.0.0.1:${o.port}`;
  return `#!/bin/bash
# Arcanum launcher, written by \`pnpm app install\`. Reinstall after moving the repo or changing Node.
REPO=${sq(o.repo)}
NODE=${sq(o.node)}
URL=${sq(url)}
export PATH=${sq(o.pathEnv)}
export ARCANUM_PORT=${o.port}
LOG="$HOME/.arcanum/daemon.log"

up() { /usr/bin/curl -s -o /dev/null -m 1 "$URL/api/state"; }
alert() { /usr/bin/osascript -e "display alert \\"Arcanum didn't wake\\" message \\"$1\\"" >/dev/null; }

if ! up; then
  [ -x "$NODE" ] || { alert "Node isn't at $NODE any more. Run pnpm app install again."; exit 1; }
  mkdir -p "$HOME/.arcanum"
  echo "--- $(date) started from the Dock" >>"$LOG"
  cd "$REPO" || exit 1
  nohup "$NODE" "$REPO/node_modules/tsx/dist/cli.mjs" src/main.ts >>"$LOG" 2>&1 </dev/null &
  for _ in $(seq 1 75); do up && break; sleep 0.2; done
  up || { alert "Nothing answered on $URL after 15 seconds. See ~/.arcanum/daemon.log"; exit 1; }
fi

for b in ${APP_BROWSERS.map(sq).join(" ")}; do
  [ -d "/Applications/$b.app" ] || [ -d "$HOME/Applications/$b.app" ] || continue
  # an Arcanum window already open: bring it forward instead of opening another
  if /usr/bin/pgrep -xq "$b"; then
    found=$(/usr/bin/osascript - "$URL" 2>/dev/null <<OSA
on run argv
  tell application "$b"
    repeat with w in windows
      if (URL of active tab of w) starts with (item 1 of argv) then
        set index of w to 1
        activate
        return "yes"
      end if
    end repeat
  end tell
  return "no"
end run
OSA
)
    [ "$found" = "yes" ] && exit 0
  fi
  exec /usr/bin/open -na "$b" --args --app="$URL"
done
exec /usr/bin/open "$URL"
`;
}

export function infoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Arcanum</string>
  <key>CFBundleDisplayName</key><string>Arcanum</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleExecutable</key><string>Arcanum</string>
  <key>CFBundleIconFile</key><string>Arcanum</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSAppleEventsUsageDescription</key><string>Arcanum brings its open window forward instead of opening another.</string>
</dict>
</plist>
`;
}

export const appPath = (dir = path.join(os.homedir(), "Applications")) => path.join(dir, "Arcanum.app");

/** Writes Arcanum.app (replacing an older one); the icon is built from ui/arcanum-icon.png. */
export function installApp(target: string, o: LauncherOpts, iconPng: string): void {
  rmSync(target, { recursive: true, force: true });
  const contents = path.join(target, "Contents"), macos = path.join(contents, "MacOS"), res = path.join(contents, "Resources");
  mkdirSync(macos, { recursive: true }); mkdirSync(res, { recursive: true });
  writeFileSync(path.join(contents, "Info.plist"), infoPlist());
  const exe = path.join(macos, "Arcanum");
  writeFileSync(exe, launcherScript(o)); chmodSync(exe, 0o755);

  const set = path.join(os.tmpdir(), `arcanum-${process.pid}.iconset`);
  mkdirSync(set, { recursive: true });
  try {
    for (const s of [16, 32, 128, 256, 512]) {
      execFileSync("sips", ["-z", String(s), String(s), iconPng, "--out", path.join(set, `icon_${s}x${s}.png`)], { stdio: "ignore" });
      execFileSync("sips", ["-z", String(s * 2), String(s * 2), iconPng, "--out", path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: "ignore" });
    }
    execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(res, "Arcanum.icns")]);
  } finally { rmSync(set, { recursive: true, force: true }); }
  // tell Finder and the Dock about the new bundle and icon
  execFileSync("touch", [target]);
  const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  if (existsSync(lsregister)) execFileSync(lsregister, ["-f", target], { stdio: "ignore" });
}

/** PIDs listening on the port, for `pnpm app stop`. */
export function daemonPids(port: number): number[] {
  try { return execFileSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number); }
  catch { return []; }
}
