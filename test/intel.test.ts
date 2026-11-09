import { HookStore } from "../src/hooks";
import { applyIntel } from "../src/intel";
import type { Session } from "../src/types";

const s = (id: string, o: Partial<Session> = {}): Session => ({ id, pid: 1, realmId: "r", name: id, model: "opus", state: "rest", since: 1, host: "warp", where: "Warp", briefing: "", cwd: "/p", seal: false, ...o });

test("a held request makes any session answerable; status makes mana exact and adds cost", () => {
  const store = new HookStore();
  store.pending.set("a", { sessionId: "a", tool: "Bash", input: { command: "ls" }, at: 99, settle: () => {} });
  store.event("SessionStart", { session_id: "b" }, { cmux_surface: "s-1" });
  store.status({ session_id: "b", context_window: { used_percentage: 61.6, context_window_size: 1_000_000 }, cost: { total_cost_usd: 4.2 } });
  const list = [s("a"), s("b", { mana: { used: 1, window: 200_000, pct: 0, inferred: true } }), s("c")];
  applyIntel(list, store);
  expect(list[0]).toMatchObject({ state: "seal", since: 99, seal: true, sealVia: "hook", request: "Bash: ls" });
  expect(list[1]).toMatchObject({ link: { cmuxSurface: "s-1" }, mana: { used: 616_000, window: 1_000_000, pct: 62, inferred: false }, costUsd: 4.2 });
  expect(list[2]).toEqual(s("c"));
});

test("the 5-hour usage limit from any session's status line shows on every live session", () => {
  const store = new HookStore();
  store.status({ session_id: "b", context_window: { used_percentage: 10 }, rate_limits: { five_hour: { used_percentage: 13.7, resets_at: 1_800_000_000 } } });
  const list = [s("a"), s("b")];
  applyIntel(list, store);
  expect(list.map(x => x.limits)).toEqual([{ pct: 13, resetsAt: 1_800_000_000_000 }, { pct: 13, resetsAt: 1_800_000_000_000 }]);
});
