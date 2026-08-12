// Minimal single-operator auth: one PIN (ADMIN_PIN from .env), in-memory
// sessions, httpOnly cookie. Good enough for a personal bot control room
// behind a reverse proxy; sessions reset on restart (just log in again).

import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "./config.js";

export const SESSION_COOKIE = "genius_session";

const sessions = new Map<string, number>(); // token -> expiresAt

function prune(): void {
  const now = Date.now();
  for (const [token, expiresAt] of sessions) {
    if (expiresAt < now) sessions.delete(token);
  }
}

export function login(config: Config, pin: string): string | null {
  prune();
  if (pin !== config.adminPin) return null;
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + config.sessionTtlMs);
  return token;
}

export function logout(token: string | null): void {
  if (token) sessions.delete(token);
}

export function isAuthenticated(config: Config, token: string | null): boolean {
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function readSessionToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

export function setSessionCookie(res: ServerResponse, token: string, ttlMs: number): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}
