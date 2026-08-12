// Server config — reads .env next to the standalone root, then process.env.

import fs from "node:fs";
import path from "node:path";

export type BotMode = "dry" | "live";

export interface Config {
  host: string;
  port: number;
  adminPin: string;
  botMode: BotMode;
  scanIntervalMs: number;
  dataDir: string;
  webDir: string;
  sessionTtlMs: number;
}

function loadDotEnv(): void {
  const candidates = [".env", "../.env"];
  for (const file of candidates) {
    const abs = path.resolve(process.cwd(), file);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
    return;
  }
}

export function loadConfig(): Config {
  loadDotEnv();
  const port = Number(process.env.PORT ?? 3456);
  const scanIntervalMs = Number(process.env.SCAN_INTERVAL_MS ?? 5000);
  const botMode: BotMode =
    (process.env.BOT_MODE ?? "dry").toLowerCase() === "live" ? "live" : "dry";
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number.isFinite(port) && port > 0 ? port : 3456,
    adminPin: process.env.ADMIN_PIN ?? "change-me",
    botMode,
    scanIntervalMs:
      Number.isFinite(scanIntervalMs) && scanIntervalMs >= 1000
        ? scanIntervalMs
        : 5000,
    dataDir: path.resolve(process.cwd(), process.env.DATA_DIR ?? "data"),
    webDir: path.resolve(process.cwd(), process.env.WEB_DIR ?? "web/dist"),
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  };
}

/** Current bot mode, read live from env (dry unless explicitly set to live). */
export function botMode(): BotMode {
  return (process.env.BOT_MODE ?? "dry").toLowerCase() === "live"
    ? "live"
    : "dry";
}
