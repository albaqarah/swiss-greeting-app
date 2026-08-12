// Entry point — one pm2 process runs everything:
//   - the REST API for the control room
//   - the built dashboard (static files from web/dist)
//   - the 5-second genius scan loop
//
// Start: `node server/dist/index.js` (or pm2 start ecosystem.config.cjs)

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, type Config } from "./config.js";
import { openStore } from "./db.js";
import { handleApiRequest } from "./api.js";
import { runBotTick } from "./runner.js";

const MAX_BODY_BYTES = 1024 * 1024;

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

// ---------------------------------------------------------------------------
// Static dashboard serving (web/dist) with SPA fallback
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(config: Config, res: ServerResponse, pathname: string): void {
  const webDir = path.resolve(config.webDir);
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (rel === "/") rel = "/index.html";

  let filePath = path.normalize(path.join(webDir, rel));
  if (!filePath.startsWith(webDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    // Not a real file — SPA fallback: only for extension-less paths.
    const ext = path.extname(rel);
    if (ext === "") {
      filePath = path.join(webDir, "index.html");
    } else {
      res.writeHead(404).end("Not found");
      return;
    }
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Server + loop
// ---------------------------------------------------------------------------

function start(): void {
  const config = loadConfig();
  const db = openStore(config.dataDir);

  if (config.adminPin === "change-me" || config.adminPin === "change-me-please") {
    console.warn(
      "⚠️  ADMIN_PIN is still the default! Set a real PIN in .env before exposing this bot to the internet.",
    );
  }
  console.log("────────────────────────────────────────────");
  console.log("  SUPER GENIUS BOT — self-hosted");
  console.log(`  mode:      ${config.botMode.toUpperCase()}  (${config.botMode === "dry" ? "paper trading" : "REAL MONEY"})`);
  console.log(`  scan:      every ${config.scanIntervalMs / 1000}s`);
  console.log(`  db:        ${path.join(config.dataDir, "genius.db")}`);
  console.log(`  listen:    http://${config.host}:${config.port}`);
  console.log("────────────────────────────────────────────");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const method = (req.method ?? "GET").toUpperCase();

      if (url.pathname.startsWith("/api/")) {
        const body = method === "POST" || method === "PUT" ? await readJsonBody(req) : null;
        const handled = await handleApiRequest(config, db, req, res, method, url.pathname, body);
        if (!handled) {
          res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Not found" }));
        }
        return;
      }

      if (method === "GET" || method === "HEAD") {
        serveStatic(config, res, url.pathname);
        return;
      }

      res.writeHead(405).end("Method not allowed");
    } catch (error) {
      console.error("request error:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "internal error" }));
      } else {
        res.end();
      }
    }
  });

  // The 5-second genius loop. Keeps running whether or not anyone has the
  // dashboard open — the whole point of running your own server.
  let tickCount = 0;
  const loop = setInterval(async () => {
    try {
      const result = await runBotTick(db);
      tickCount += 1;
      if (tickCount % 60 === 0) {
        console.log(
          `[tick #${tickCount}] fetched=${result.fetched} books=${result.books} ran=${result.ran}${result.reason ? ` (${result.reason})` : ""}`,
        );
      }
    } catch (error) {
      console.error("bot loop error:", error);
    }
  }, config.scanIntervalMs);

  server.listen(config.port, config.host, () => {
    console.log(`Control room ready — open http://localhost:${config.port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received — shutting down cleanly.`);
    clearInterval(loop);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // Force-exit if connections hang.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start();
