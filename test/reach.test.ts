import { readFileSync } from "node:fs";
import path from "node:path";
import { applyReach, checkReach } from "../src/reach";
import type { ProcTable, Session } from "../src/types";

const ps: ProcTable = new Map([
  [7428, { ppid: 1, lstart: "x", comm: "Terminal" }],
  [77070, { ppid: 7428, tty: "ttys018", lstart: "x", comm: "login" }],
  [4681, { ppid: 77070, tty: "ttys019", lstart: "x", comm: "claude" }],
  [9000, { ppid: 7428, tty: "ttys030", lstart: "x", comm: "login" }],
  [9001, { ppid: 9000, tty: "ttys030", lstart: "x", comm: "claude" }],
]);
const s = (id: string, pid: number, host: Session["host"]): Session => ({ id, pid, realmId: "r", name: id, model: "opus", state: "counsel", since: 1, host, where: host, briefing: "", cwd: "/p", reply: "type", seal: false, portal: "exact" });

test("a Terminal session is reachable only if its tab still exists", async () => {
  const sessions = [s("alive", 4681, "terminal"), s("gone", 9001, "terminal"), s("warp", 1, "warp")];
  const reach = await checkReach(sessions, { ps, tabTtys: async () => new Set(["/dev/ttys018", "/dev/ttys002"]) });
  expect([...reach]).toEqual([["alive", true], ["gone", false]]);
  applyReach(sessions, reach);
  expect(sessions.map(x => [x.id, x.reply, x.portal, x.unreachable ?? false])).toEqual([
    ["alive", "type", "exact", false], ["gone", "none", "app", true], ["warp", "type", "exact", false],
  ]);
});

test("if Terminal can't be asked, its sessions count as unreachable rather than guessed", async () => {
  const reach = await checkReach([s("a", 4681, "terminal")], { ps, tabTtys: async () => undefined });
  expect(reach.get("a")).toBe(false);
});

test("when cmux refuses the socket, its unreachable sessions say why", () => {
  const sessions = [s("c", 1, "cmux"), s("t", 2, "terminal")];
  applyReach(sessions, new Map([["c", false], ["t", false]]), true);
  expect(sessions.map(x => x.blocked)).toEqual(["cmux-access", undefined]);
});
