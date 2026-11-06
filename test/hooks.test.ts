import { mkdtempSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHookServer, describeRequest, HookStore } from "../src/hooks";

const call = (sock: string, url: string, body: unknown, ctx?: unknown) => new Promise<string>((ok, fail) => {
  const req = http.request({ socketPath: sock, path: url, method: "POST", headers: { "content-type": "application/json", ...(ctx ? { "x-arcanum-ctx": JSON.stringify(ctx) } : {}) } }, res => {
    let b = ""; res.on("data", c => b += c); res.on("end", () => ok(b));
  });
  req.on("error", fail); req.end(JSON.stringify(body));
});

function setup(visible: boolean) {
  const sock = path.join(mkdtempSync(path.join(tmpdir(), "hk-")), "hooks.sock"), store = new HookStore();
  let changes = 0;
  const server = createHookServer(sock, store, { onChange: () => changes++, dashboardVisible: () => visible });
  return { sock, store, server, changes: () => changes, ready: new Promise(r => server.once("listening", r)) };
}

test("events record links, turns and notifications", async () => {
  const h = setup(true); await h.ready;
  try {
    await call(h.sock, "/hook/SessionStart", { session_id: "s1" }, { cmux_surface: "S-9", cmux_workspace: "W-2" });
    await call(h.sock, "/hook/UserPromptSubmit", { session_id: "s1", prompt: "go" });
    await call(h.sock, "/hook/Stop", { session_id: "s1", last_assistant_message: "Done?" });
    await call(h.sock, "/hook/Notification", { session_id: "s1", notification_type: "idle_prompt" });
    await call(h.sock, "/status", { session_id: "s1", context_window: { used_percentage: 42, context_window_size: 1_000_000, current_usage: { input_tokens: 10, output_tokens: 90, cache_creation_input_tokens: 900, cache_read_input_tokens: 419_000 } }, cost: { total_cost_usd: 3.21 } });
    const i = h.store.intel.get("s1")!;
    expect(i).toMatchObject({ cmuxSurface: "S-9", cmuxWorkspace: "W-2", notification: { type: "idle_prompt" }, status: { pct: 42, window: 1_000_000, used: 420_000, costUsd: 3.21 } });
    expect(i.turnEndedAt).toBeGreaterThanOrEqual(i.promptAt!);
    expect(h.changes()).toBe(5);
  } finally { h.server.close(); }
});

test("a permission request waits for your answer while the dashboard is visible", async () => {
  const h = setup(true); await h.ready;
  try {
    const answer = call(h.sock, "/hook/PermissionRequest", { session_id: "s1", tool_name: "Bash", tool_input: { command: "rm -rf build", description: "Clean build output" } });
    await new Promise(r => setTimeout(r, 50));
    const p = h.store.pending.get("s1")!;
    expect(describeRequest(p.tool, p.input)).toBe("Bash: rm -rf build\nClean build output");
    p.settle("grant");
    expect(JSON.parse(await answer)).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
    expect(h.store.pending.size).toBe(0);

    const refused = call(h.sock, "/hook/PermissionRequest", { session_id: "s1", tool_name: "Bash", tool_input: { command: "x" } });
    await new Promise(r => setTimeout(r, 50));
    h.store.pending.get("s1")!.settle("refuse");
    expect(JSON.parse(await refused).hookSpecificOutput.decision).toEqual({ behavior: "deny", message: "Refused from Arcanum." });
  } finally { h.server.close(); }
});

test("with no visible dashboard, a permission request passes straight through to the terminal", async () => {
  const h = setup(false); await h.ready;
  try {
    expect(await call(h.sock, "/hook/PermissionRequest", { session_id: "s1", tool_name: "Bash", tool_input: {} })).toBe("");
    expect(h.store.pending.size).toBe(0);
  } finally { h.server.close(); }
});
