import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { absorbRealm, loadConfig, saveConfig, updateRealm } from "./realms";
import { MAX_IMAGE_BYTES, resolveImages, saveImage } from "./uploads";
import type { Snapshot } from "./types";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png" };

export interface PortalResult { ok: boolean; precision: "exact" | "app" | "none"; message: string }
export interface ServerDeps { uploadsDir?: string; uiDir: string; fontDirs: string[]; arcanumDir: string; getSnapshot(): Snapshot; onConfigChange(): void; openPortal(sessionId: string): Promise<PortalResult | undefined>;
  sendWord?(sessionId: string, text: string, images: string[]): Promise<{ ok: boolean; message: string } | undefined>;
  answerSeal?(sessionId: string, decision: "grant" | "refuse"): Promise<{ ok: boolean; message: string } | undefined>;
  readSeal?(sessionId: string): Promise<{ request: string; question: string } | undefined>;
  dismiss?(sessionId: string): { ok: boolean; message: string } | undefined;
  restore?(sessionId: string): { ok: boolean; message: string } | undefined;
  summon?(realmId: string, req: { model: string; land: string; prompt?: string; focus: boolean }): Promise<{ ok: boolean; message: string }> }

export function createArcanumServer(d: ServerDeps) {
  const clients = new Set<http.ServerResponse>();

  const send = (res: http.ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const serveFile = (res: http.ServerResponse, roots: string[], rel: string) => {
    for (const root of roots) {
      const file = path.resolve(root, rel);
      if (!file.startsWith(path.resolve(root) + path.sep)) continue;
      if (existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
        createReadStream(file).pipe(res);
        return;
      }
    }
    res.writeHead(404).end("Not found");
  };
  const readJson = (req: http.IncomingMessage) => new Promise<any>((ok, fail) => {
    let b = ""; req.on("data", c => { b += c; if (b.length > 64 * 1024) req.destroy(); });
    req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch { fail(new Error("Body must be JSON")); } });
  });
  const editConfig = (res: http.ServerResponse, fn: (cfg: ReturnType<typeof loadConfig>) => unknown) => {
    const cfg = loadConfig(d.arcanumDir);
    try { const out = fn(cfg); saveConfig(d.arcanumDir, cfg); d.onConfigChange(); send(res, 200, out); }
    catch (e) { send(res, 400, { error: (e as Error).message }); }
  };

  const server = http.createServer(async (req, res) => {
    // local only: refuse DNS-rebinding hosts and cross-site writes
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost"].includes(host)) return res.writeHead(403).end("Forbidden");
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return res.writeHead(403).end("Forbidden");

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let p: string;
    try { p = decodeURIComponent(url.pathname); } catch { return res.writeHead(400).end(); }

    if (req.method === "GET" && p === "/") return serveFile(res, [d.uiDir], "index.html");
    if (req.method === "GET" && p.startsWith("/ui/")) return serveFile(res, [d.uiDir], p.slice(4));
    if (req.method === "GET" && p.startsWith("/fonts/")) return serveFile(res, d.fontDirs, p.slice(7));
    if (req.method === "GET" && p === "/api/state") return send(res, 200, d.getSnapshot());
    if (req.method === "GET" && p === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`data: ${JSON.stringify(d.getSnapshot())}\n\n`);
      clients.add(res); req.on("close", () => clients.delete(res));
      return;
    }
    const pm = /^\/api\/sessions\/([\w-]+)\/portal$/.exec(p);
    if (pm && req.method === "POST") {
      const r = await d.openPortal(pm[1]).catch(e => ({ ok: false, precision: "none" as const, message: (e as Error).message }));
      return r ? send(res, 200, r) : send(res, 404, { error: "No live mage with that id." });
    }
    if (p === "/api/uploads" && req.method === "POST") {
      if (!d.uploadsDir) return send(res, 404, { error: "Uploads are off." });
      const chunks: Buffer[] = []; let size = 0, tooBig = false;
      await new Promise<void>(done => {
        req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_IMAGE_BYTES) { tooBig = true; return; } chunks.push(c); });
        req.on("end", () => done()); req.on("error", () => done());
      });
      if (tooBig) return send(res, 413, { error: "Images must be under 10 MB." });
      try { return send(res, 200, { id: saveImage(d.uploadsDir, Buffer.concat(chunks)).id }); }
      catch (e) { return send(res, 400, { error: (e as Error).message }); }
    }
    const sm = /^\/api\/sessions\/([\w-]+)\/(send|seal)$/.exec(p);
    if (sm && req.method === "POST") {
      let body: any;
      try { body = await readJson(req); } catch (e) { return send(res, 400, { error: (e as Error).message }); }
      const r = sm[2] === "send"
        ? await (async () => {
            let images: string[] = [];
            try { images = d.uploadsDir ? resolveImages(d.uploadsDir, body.images) : []; } catch (e) { return { ok: false, message: (e as Error).message }; }
            return d.sendWord?.(sm[1], String(body.text ?? ""), images);
          })()
        : body.decision === "grant" || body.decision === "refuse" ? await d.answerSeal?.(sm[1], body.decision) : (send(res, 400, { error: "decision must be grant or refuse" }), null);
      if (r === null) return;
      return r ? send(res, 200, r) : send(res, 404, { error: "No live mage with that id." });
    }
    const dm = /^\/api\/sessions\/([\w-]+)\/(dismiss|restore)$/.exec(p);
    if (dm && req.method === "POST") {
      const r = dm[2] === "dismiss" ? d.dismiss?.(dm[1]) : d.restore?.(dm[1]);
      return r ? send(res, 200, r) : send(res, 404, { error: "No mage with that id." });
    }
    const su = /^\/api\/realms\/([\w-]+)\/summon$/.exec(p);
    if (su && req.method === "POST") {
      let body: any;
      try { body = await readJson(req); } catch (e) { return send(res, 400, { error: (e as Error).message }); }
      if (!d.summon) return send(res, 404, { error: "Summoning is off." });
      return send(res, 200, await d.summon(su[1], { model: String(body.model ?? ""), land: String(body.land ?? ""), prompt: typeof body.prompt === "string" ? body.prompt : undefined, focus: body.focus !== false }));
    }
    const rm = /^\/api\/sessions\/([\w-]+)\/seal$/.exec(p);
    if (rm && req.method === "GET") return send(res, 200, (await d.readSeal?.(rm[1])) ?? {});
    const m = /^\/api\/realms\/([\w-]+)(\/absorb)?$/.exec(p);
    if (m && (req.method === "PATCH" && !m[2] || req.method === "POST" && m[2])) {
      let body: any;
      try { body = await readJson(req); } catch (e) { return send(res, 400, { error: (e as Error).message }); }
      return m[2] ? editConfig(res, cfg => absorbRealm(cfg, m[1], String(body.other ?? "")))
                  : editConfig(res, cfg => updateRealm(cfg, m[1], { name: body.name, landmark: body.landmark, banner: body.banner }));
    }
    res.writeHead(404).end("Not found");
  });

  const ping = setInterval(() => { for (const c of clients) c.write(":ping\n\n"); }, 15000);
  return {
    server,
    broadcast(s: Snapshot) { const msg = `data: ${JSON.stringify(s)}\n\n`; for (const c of clients) c.write(msg); },
    close() { clearInterval(ping); for (const c of clients) c.end(); server.close(); },
  };
}
