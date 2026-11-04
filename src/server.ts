import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { absorbRealm, loadConfig, saveConfig, updateRealm } from "./realms";
import type { Snapshot } from "./types";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png" };

export interface ServerDeps { uiDir: string; fontDirs: string[]; arcanumDir: string; getSnapshot(): Snapshot; onConfigChange(): void }

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
