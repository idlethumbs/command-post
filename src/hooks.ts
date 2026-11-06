import { chmodSync, existsSync, unlinkSync } from "node:fs";
import http from "node:http";

/**
 * What Claude Code tells Arcanum through hooks and the status line, per session.
 * Everything here is optional: without hooks Arcanum falls back to the registry and transcripts.
 */
export interface HookIntel {
  cmuxSurface?: string; cmuxWorkspace?: string;          // from SessionStart: the pane it really lives in
  turnEndedAt?: number; promptAt?: number;                // Stop / UserPromptSubmit
  notification?: { type: string; at: number };            // permission_prompt, idle_prompt, …
  status?: { pct?: number; window?: number; used?: number; costUsd?: number; at: number };
}
export interface PendingSeal { sessionId: string; tool: string; input: unknown; at: number; settle(decision: "grant" | "refuse" | null): void }

export const HOLD_MS = 110_000;   // under the 120 s hook timeout in settings, so a held prompt always gets an answer

export class HookStore {
  intel = new Map<string, HookIntel>();
  pending = new Map<string, PendingSeal>();
  private get(id: string) { let i = this.intel.get(id); if (!i) this.intel.set(id, i = {}); return i; }

  event(name: string, p: any, ctx: any, now = Date.now()) {
    const id = p?.session_id; if (typeof id !== "string") return;
    const i = this.get(id);
    if (name === "SessionStart") { if (ctx?.cmux_surface) i.cmuxSurface = String(ctx.cmux_surface); if (ctx?.cmux_workspace) i.cmuxWorkspace = String(ctx.cmux_workspace); }
    if (name === "UserPromptSubmit") { i.promptAt = now; i.notification = undefined; }
    if (name === "Stop") i.turnEndedAt = now;
    if (name === "Notification" && typeof p.notification_type === "string") i.notification = { type: p.notification_type, at: now };
    if (name === "SessionEnd") { this.intel.delete(id); this.pending.get(id)?.settle(null); }
  }

  /** The status line payload: exact context fullness and cost. Field names are read defensively. */
  status(p: any, now = Date.now()) {
    const id = p?.session_id; if (typeof id !== "string") return;
    const cw = p.context_window ?? {};
    const pct = typeof cw.used_percentage === "number" ? cw.used_percentage : typeof cw.remaining_percentage === "number" ? 100 - cw.remaining_percentage : undefined;
    const window = [cw.context_window_size, cw.max_tokens, cw.total, cw.size].find(x => typeof x === "number" && x > 0);
    const cu = cw.current_usage;
    const fromUsage = cu && typeof cu === "object" ? ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"].reduce((a, k) => a + (typeof cu[k] === "number" ? cu[k] : 0), 0) : undefined;
    const used = fromUsage || (window && pct !== undefined ? Math.round(window * pct / 100) : undefined);
    const costUsd = typeof p.cost?.total_cost_usd === "number" ? p.cost.total_cost_usd : undefined;
    this.get(id).status = { pct, window, used, costUsd, at: now };
  }

  /** Hold a permission request for the dashboard. Resolves with the hook's stdout (empty = let the terminal ask as usual). */
  hold(p: any, onChange: () => void): Promise<string> {
    const id = p?.session_id;
    if (typeof id !== "string") return Promise.resolve("");
    this.pending.get(id)?.settle(null);
    return new Promise(done => {
      const timer = setTimeout(() => entry.settle(null), HOLD_MS);
      const entry: PendingSeal = {
        sessionId: id, tool: String(p.tool_name ?? "a tool"), input: p.tool_input, at: Date.now(),
        settle: decision => {
          if (this.pending.get(id) !== entry) return;
          clearTimeout(timer); this.pending.delete(id); onChange();
          done(decision === null ? "" : JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest",
            decision: decision === "grant" ? { behavior: "allow" } : { behavior: "deny", message: "Refused from Arcanum." } } }));
        },
      };
      this.pending.set(id, entry); onChange();
    });
  }
}

/** A short, human summary of what a held permission request wants to do. */
export function describeRequest(tool: string, input: any): string {
  if (input && typeof input === "object") {
    if (typeof input.command === "string") return `${tool}: ${input.command}${input.description ? `\n${input.description}` : ""}`;
    if (typeof input.file_path === "string") return `${tool}: ${input.file_path}`;
    if (typeof input.url === "string") return `${tool}: ${input.url}`;
  }
  return tool;
}

/**
 * The relay's endpoint: a unix socket only your user can open (0600). Permission requests are held only while a
 * dashboard tab is open and visible; otherwise they pass straight through to the terminal's own prompt.
 */
export function createHookServer(sock: string, store: HookStore, d: { onChange(): void; dashboardVisible(): boolean }) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1 << 20) req.destroy(); });
    req.on("end", async () => {
      let p: any = {}, ctx: any = {};
      try { p = JSON.parse(body || "{}"); } catch { /* ignore malformed */ }
      try { ctx = JSON.parse(String(req.headers["x-arcanum-ctx"] ?? "{}")); } catch { /* optional */ }
      const m = /^\/hook\/(\w+)$/.exec(req.url ?? "");
      if (req.url === "/status") { store.status(p); d.onChange(); return res.end(); }
      if (!m) { res.statusCode = 404; return res.end(); }
      if (m[1] === "PermissionRequest") {
        if (!d.dashboardVisible()) return res.end("");
        return res.end(await store.hold(p, d.onChange));
      }
      store.event(m[1], p, ctx); d.onChange();
      res.end();
    });
  });
  if (existsSync(sock)) { try { unlinkSync(sock); } catch { /* stale */ } }
  server.listen(sock, () => { try { chmodSync(sock, 0o600); } catch { /* best effort */ } });
  return server;
}
