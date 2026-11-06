import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createArcanumServer } from "../src/server";
import { assignRealms, emptyConfig, loadConfig, saveConfig } from "../src/realms";

async function setup() {
  const ui = mkdtempSync(path.join(tmpdir(), "ui-")), arcanumDir = mkdtempSync(path.join(tmpdir(), "arc-"));
  writeFileSync(path.join(ui, "index.html"), "<title>Arcanum</title>");
  mkdirSync(path.join(ui, "sub"));
  const cfg = emptyConfig();
  assignRealms(["/p/a", "/p/b"], cfg, { gitRoot: c => c, isWilds: () => false }, 1);
  saveConfig(arcanumDir, cfg);
  let changes = 0;
  const app = createArcanumServer({ uploadsDir: path.join(arcanumDir, "uploads"), uiDir: ui, fontDirs: [], arcanumDir, sendWord: async (id: string, text: string, images: string[]) => id === "abc" ? { ok: true, message: `sent ${text}${images.length ? " +" + images.length : ""}` } : undefined,
    answerSeal: async (id: string, d: "grant" | "refuse") => id === "abc" ? { ok: true, message: d } : undefined,
    dismiss: async (id: string, o: { close: boolean }) => id === "abc" ? { ok: true, message: o.close ? "dismissed and closed" : "dismissed" } : undefined,
    openPortal: async (id: string) => id === "abc" ? { ok: true, precision: "exact" as const, message: "Opened." } : undefined, getSnapshot: () => ({ generatedAt: 1, realms: loadConfig(arcanumDir).realms, sessions: [] }), onConfigChange: () => changes++ });
  await new Promise<void>(r => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return { app, base, arcanumDir, changes: () => changes };
}

test("serves the page, the state and realm edits", async () => {
  const s = await setup();
  try {
    expect(await (await fetch(s.base + "/")).text()).toContain("<title>Arcanum</title>");
    const state: any = await (await fetch(s.base + "/api/state")).json();
    expect(state.realms.map((r: any) => r.id)).toEqual(["a", "b"]);

    const patch = await fetch(s.base + "/api/realms/a", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Alpha" }) });
    expect(patch.status).toBe(200);
    expect(loadConfig(s.arcanumDir).realms[0].name).toBe("Alpha");

    const bad = await fetch(s.base + "/api/realms/a", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ landmark: "moonbase" }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toMatch(/Unknown landmark/);

    const merge = await fetch(s.base + "/api/realms/a/absorb", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ other: "b" }) });
    expect(merge.status).toBe(200);
    expect(loadConfig(s.arcanumDir).realms.map(r => r.id)).toEqual(["a"]);
    expect(s.changes()).toBe(2);

    const portal = await fetch(s.base + "/api/sessions/abc/portal", { method: "POST" });
    expect(await portal.json()).toEqual({ ok: true, precision: "exact", message: "Opened." });
    expect((await fetch(s.base + "/api/sessions/zzz/portal", { method: "POST" })).status).toBe(404);

    const post = (u: string, b: unknown) => fetch(s.base + u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    expect(await (await post("/api/sessions/abc/send", { text: "go with b" })).json()).toEqual({ ok: true, message: "sent go with b" });
    expect(await (await post("/api/sessions/abc/seal", { decision: "grant" })).json()).toEqual({ ok: true, message: "grant" });
    expect((await post("/api/sessions/abc/seal", { decision: "maybe" })).status).toBe(400);
    expect((await post("/api/sessions/zzz/send", { text: "x" })).status).toBe(404);

    const up: any = await (await fetch(s.base + "/api/uploads", { method: "POST", headers: { "content-type": "image/png" }, body: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex") })).json();
    expect(up.id).toMatch(/^[0-9a-f]{20}\.png$/);
    expect(await (await post("/api/sessions/abc/send", { text: "look", images: [up.id] })).json()).toEqual({ ok: true, message: "sent look +1" });
    expect(await (await post("/api/sessions/abc/send", { text: "look", images: ["/etc/passwd"] })).json()).toEqual({ ok: false, message: "Unknown image." });
    expect(await (await post("/api/sessions/abc/dismiss", {})).json()).toEqual({ ok: true, message: "dismissed" });
    expect(await (await post("/api/sessions/abc/dismiss", { close: true })).json()).toEqual({ ok: true, message: "dismissed and closed" });
    expect(await (await post("/api/sessions/abc/dismiss", { close: "yes" })).json()).toEqual({ ok: true, message: "dismissed" });
    expect((await post("/api/sessions/zzz/dismiss", { close: true })).status).toBe(404);
    expect((await fetch(s.base + "/api/uploads", { method: "POST", body: "<svg/>" })).status).toBe(400);
  } finally { s.app.close(); }
});

test("refuses path traversal and foreign origins", async () => {
  const s = await setup();
  try {
    expect((await fetch(s.base + "/ui/..%2f..%2fetc%2fpasswd")).status).toBe(404);
    const evil = await fetch(s.base + "/api/realms/a", { method: "PATCH", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
    expect(evil.status).toBe(403);
  } finally { s.app.close(); }
});
