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
  const app = createArcanumServer({ uiDir: ui, fontDirs: [], arcanumDir, openPortal: async (id: string) => id === "abc" ? { ok: true, precision: "exact" as const, message: "Opened." } : undefined, getSnapshot: () => ({ generatedAt: 1, realms: loadConfig(arcanumDir).realms, sessions: [] }), onConfigChange: () => changes++ });
  await new Promise<void>(r => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return { app, base, arcanumDir, changes: () => changes };
}

test("serves the page, the state and realm edits", async () => {
  const s = await setup();
  try {
    expect(await (await fetch(s.base + "/")).text()).toContain("<title>Arcanum</title>");
    const state = await (await fetch(s.base + "/api/state")).json();
    expect(state.realms.map((r: any) => r.id)).toEqual(["a", "b"]);

    const patch = await fetch(s.base + "/api/realms/a", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Alpha" }) });
    expect(patch.status).toBe(200);
    expect(loadConfig(s.arcanumDir).realms[0].name).toBe("Alpha");

    const bad = await fetch(s.base + "/api/realms/a", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ landmark: "moonbase" }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Unknown landmark/);

    const merge = await fetch(s.base + "/api/realms/a/absorb", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ other: "b" }) });
    expect(merge.status).toBe(200);
    expect(loadConfig(s.arcanumDir).realms.map(r => r.id)).toEqual(["a"]);
    expect(s.changes()).toBe(2);

    const portal = await fetch(s.base + "/api/sessions/abc/portal", { method: "POST" });
    expect(await portal.json()).toEqual({ ok: true, precision: "exact", message: "Opened." });
    expect((await fetch(s.base + "/api/sessions/zzz/portal", { method: "POST" })).status).toBe(404);
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
