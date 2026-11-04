import { readFileSync } from "node:fs";
import path from "node:path";
import { cmuxSurfaceFor, parseCmuxTop, planPortal, type PortalCtx } from "../src/portal";
import type { ProcTable, Session } from "../src/types";

const tsv = readFileSync(path.join(__dirname, "fixtures", "cmux-top.tsv"), "utf8");
const ps: ProcTable = new Map([
  [48590, { ppid: 1, lstart: "x", comm: "zsh" }],
  [48602, { ppid: 48590, tty: "ttys011", lstart: "x", comm: "zsh" }],
  [49350, { ppid: 48602, tty: "ttys011", lstart: "x", comm: "claude" }],
  [30101, { ppid: 1, tty: "ttys016", lstart: "x", comm: "claude" }],
  [4681, { ppid: 1, tty: "ttys001", lstart: "x", comm: "claude" }],
]);

test("maps a claude pid to its cmux surface by walking parents", () => {
  const layout = parseCmuxTop(tsv);
  expect(cmuxSurfaceFor(30101, layout, ps)).toEqual({ surface: "S-3", workspace: "WS-2", window: "W-1" });
  expect(cmuxSurfaceFor(49350, layout, ps)).toEqual({ surface: "S-2", workspace: "WS-1", window: "W-1" });
  expect(cmuxSurfaceFor(4681, layout, ps)).toBeUndefined();
});

const base: Session = { id: "s", pid: 30101, realmId: "r", name: "agent-rails-e4", model: "opus", state: "counsel", since: 1, host: "cmux", where: "cmux", briefing: "", cwd: "/p/agent-rails" };
const ctx: PortalCtx = { ps, cmux: { bin: "/bin/cmux", app: "/Apps/cmux.app", layout: parseCmuxTop(tsv) } };
const cmds = (p: ReturnType<typeof planPortal>) => p.steps.map(s => [s.cmd, ...s.args].join(" "));

test("cmux: exact focus plus flash", () => {
  const p = planPortal(base, ctx);
  expect(p.precision).toBe("exact");
  expect(cmds(p)).toEqual([
    "/bin/cmux select-workspace --workspace WS-2",
    `/bin/cmux rpc surface.focus {"surface_id":"S-3"}`,
    "open -a /Apps/cmux.app",
    "/bin/cmux trigger-flash --surface S-3 --workspace WS-2",
  ]);
});

test("cmux without a matching surface just raises the app", () => {
  const p = planPortal({ ...base, pid: 4681 }, ctx);
  expect(p.precision).toBe("app");
  expect(cmds(p)).toEqual(["open -a /Apps/cmux.app"]);
});

test("Terminal.app and iTerm focus the tab by tty, passed as an argument", () => {
  const t = planPortal({ ...base, pid: 4681, host: "terminal" }, ctx);
  expect(t.precision).toBe("exact");
  expect(t.steps[0].cmd).toBe("osascript");
  expect(t.steps[0].args.at(-1)).toBe("/dev/ttys001");
  expect(t.steps[0].args.join(" ")).toContain('application "Terminal"');
  const i = planPortal({ ...base, pid: 4681, host: "iterm" }, ctx);
  expect(i.steps[0].args.join(" ")).toContain('application "iTerm2"');
});

test("tmux selects the recorded target", () => {
  const p = planPortal({ ...base, host: "tmux", tmux: "work:@1.%3" }, ctx);
  expect(cmds(p)).toEqual(["tmux select-window -t work:@1", "tmux select-pane -t %3"]);
});

test("app-level hosts", () => {
  expect(cmds(planPortal({ ...base, host: "warp" }, ctx))).toEqual(["open -a Warp"]);
  expect(cmds(planPortal({ ...base, host: "vscode" }, ctx))).toEqual(["open -a Visual Studio Code /p/agent-rails"]);
  expect(planPortal({ ...base, host: "warp" }, ctx).precision).toBe("app");
});

test("background sessions attach in a new cmux workspace; bad ids are refused", () => {
  const p = planPortal({ ...base, host: "bg", jobId: "481d6b12" }, ctx);
  expect(p.precision).toBe("exact");
  expect(cmds(p)).toEqual(["/bin/cmux new-workspace --name agent-rails-e4 --cwd /p/agent-rails --command claude attach 481d6b12", "open -a /Apps/cmux.app"]);
  const bad = planPortal({ ...base, host: "bg", jobId: "x; rm -rf ~" }, ctx);
  expect(bad.precision).toBe("none");
  expect(bad.steps).toEqual([]);
});

test("unknown hosts explain themselves", () => {
  const p = planPortal({ ...base, host: "unknown", where: "Unknown terminal" }, ctx);
  expect(p.precision).toBe("none");
  expect(p.message).toMatch(/couldn't tell which terminal/i);
});
