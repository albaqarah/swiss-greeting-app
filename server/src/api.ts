// REST API for the control room. Response shapes match what the React
// dashboard expects — no rework needed on the UI side.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.js";
import {
  allMarkets,
  closePosition,
  getConfig,
  insertLog,
  insertTrade,
  listLogs,
  listTrades,
  marketById,
  openPositions,
  updateConfig,
} from "./db.js";
import { getMarketHistory, marketMid, refreshMarketData } from "./engine.js";
import { bumpDaily } from "./daily.js";
import { escapeHtml, notify, telegramConfigured } from "./notify.js";
import { truncate } from "./polymarket.js";
import {
  clearSessionCookie,
  isAuthenticated,
  login,
  logout,
  readSessionToken,
  setSessionCookie,
} from "./auth.js";
import { runBotTick } from "./runner.js";

const DEFAULT_BANKROLL = 1000;
const VERSION = "1.0.0";

type Body = Record<string, unknown>;

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function requireSession(config: Config, req: IncomingMessage, res: ServerResponse): boolean {
  const token = readSessionToken(req);
  if (!isAuthenticated(config, token)) {
    sendJson(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Dashboard reads
// ---------------------------------------------------------------------------

function buildStatus(db: DatabaseSync, config: Config) {
  const botConfig = getConfig(db);
  if (!botConfig) return null;

  const positions = openPositions(db);
  const markets = allMarkets(db);
  const marketByIdMap = new Map(markets.map((m) => [m.id, m]));

  let positionValue = 0;
  let unrealizedPnl = 0;
  for (const p of positions) {
    const market = marketByIdMap.get(p.marketId);
    if (!market) continue;
    const yesMid = marketMid(market);
    const valuePrice = p.side === "YES" ? yesMid : 1 - yesMid;
    positionValue += p.shares * valuePrice;
    unrealizedPnl += p.shares * (valuePrice - p.avgPrice);
  }

  const trades = listTrades(db, 500);
  const exits = trades.filter(
    (t) => (t.action === "SELL" || t.action === "SETTLE") && t.pnl !== null,
  );
  const wins = exits.filter((t) => (t.pnl ?? 0) > 0).length;

  const equity = botConfig.cash + positionValue;
  const totalPnl = equity - botConfig.bankroll;
  const marketsUpdatedAt = markets.reduce(
    (max, m) => Math.max(max, m.updatedAt),
    0,
  );

  return {
    config: {
      bankroll: botConfig.bankroll,
      cash: botConfig.cash,
      enabled: botConfig.enabled,
      aggression: botConfig.aggression,
      lastTickAt: botConfig.lastTickAt ?? null,
    },
    equity,
    totalPnl,
    realizedPnl: totalPnl - unrealizedPnl,
    unrealizedPnl,
    openCount: positions.length,
    winRate: exits.length > 0 ? wins / exits.length : null,
    closedTradesCount: exits.length,
    marketsUpdatedAt,
    mode: config.botMode,
    scanIntervalMs: config.scanIntervalMs,
  };
}

function buildMarkets(db: DatabaseSync) {
  return allMarkets(db)
    .sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0))
    .slice(0, 30)
    .map((m) => ({
      _id: String(m.id),
      question: m.question,
      slug: m.slug,
      image: m.image,
      outcomes: m.outcomes,
      outcomePrices: m.outcomePrices,
      volume24hr: m.volume24hr,
      liquidity: m.liquidity,
      endDate: m.endDate,
      active: m.active,
      closed: m.closed,
      book: m.book,
      signal: m.signal,
      updatedAt: m.updatedAt,
    }));
}

function buildMarketDetail(db: DatabaseSync, id: number) {
  const market = marketById(db, id);
  if (!market) return null;
  return {
    _id: String(market.id),
    question: market.question,
    slug: market.slug,
    image: market.image,
    outcomes: market.outcomes,
    outcomePrices: market.outcomePrices,
    volume24hr: market.volume24hr,
    liquidity: market.liquidity,
    endDate: market.endDate,
    active: market.active,
    closed: market.closed,
    book: market.book,
    signal: market.signal,
    updatedAt: market.updatedAt,
  };
}

function buildPositions(db: DatabaseSync) {
  const positions = openPositions(db);
  const markets = allMarkets(db);
  const marketByIdMap = new Map(markets.map((m) => [m.id, m]));
  return positions.map((p) => {
    const market = marketByIdMap.get(p.marketId);
    const yesMid = market ? marketMid(market) : 0.5;
    const valuePrice = p.side === "YES" ? yesMid : 1 - yesMid;
    return {
      _id: String(p.id),
      marketId: String(p.marketId),
      question: market?.question ?? "Unknown market",
      slug: market?.slug ?? "",
      image: market?.image ?? null,
      outcomes: market?.outcomes ?? ["Yes", "No"],
      side: p.side,
      shares: p.shares,
      avgPrice: p.avgPrice,
      invested: p.invested,
      valuePrice,
      unrealizedPnl: p.shares * (valuePrice - p.avgPrice),
      status: p.status,
      reason: p.reason ?? null,
      closedAt: p.closedAt ?? null,
    };
  });
}

function buildTrades(db: DatabaseSync) {
  const trades = listTrades(db, 50);
  const markets = allMarkets(db);
  const marketByIdMap = new Map(markets.map((m) => [m.id, m]));
  return trades.map((t) => ({
    _id: String(t.id),
    action: t.action,
    side: t.side,
    shares: t.shares,
    price: t.price,
    usd: t.usd,
    pnl: t.pnl ?? null,
    reason: t.reason,
    createdAt: t.createdAt,
    question: marketByIdMap.get(t.marketId)?.question ?? "Unknown market",
  }));
}

function buildLogs(db: DatabaseSync) {
  const logs = listLogs(db, 60);
  const markets = allMarkets(db);
  const marketByIdMap = new Map(markets.map((m) => [m.id, m]));
  return logs.map((l) => ({
    _id: String(l.id),
    level: l.level,
    message: l.message,
    createdAt: l.createdAt,
    question: l.marketId ? (marketByIdMap.get(l.marketId)?.question ?? null) : null,
  }));
}

// ---------------------------------------------------------------------------
// Control mutations
// ---------------------------------------------------------------------------

function setBotEnabled(db: DatabaseSync, enabled: boolean): void {
  const now = Date.now();
  const existing = getConfig(db);
  if (existing) {
    updateConfig(db, { enabled, lastTickAt: now });
    insertLog(
      db,
      "INFO",
      enabled
        ? "Bot armed. Genius online. Watching the order books."
        : "Bot paused. Genius takes a coffee break.",
    );
    return;
  }
  updateConfig(db, { bankroll: DEFAULT_BANKROLL, cash: DEFAULT_BANKROLL, enabled, aggression: 0.25, lastTickAt: now });
  insertLog(
    db,
    "GENIUS",
    `Fresh $${DEFAULT_BANKROLL.toLocaleString()} of virtual genius capital allocated. Armed and scanning.`,
  );
}

function closeAllPositions(db: DatabaseSync): number {
  const now = Date.now();
  const config = getConfig(db);
  if (!config) return 0;

  const positions = openPositions(db);
  const markets = allMarkets(db);
  const marketByIdMap = new Map(markets.map((m) => [m.id, m]));

  let cash = config.cash;
  let closed = 0;
  for (const p of positions) {
    const market = marketByIdMap.get(p.marketId);
    if (!market) continue;
    const yesMid = marketMid(market);
    const valuePrice = p.side === "YES" ? yesMid : 1 - yesMid;
    const proceeds = p.shares * valuePrice;
    const pnl = proceeds - p.invested;
    cash += proceeds;

    closePosition(db, p.id, "CLOSED", pnl, now, "closed manually");
    insertTrade(db, {
      marketId: p.marketId,
      side: p.side,
      action: "SELL",
      shares: p.shares,
      price: valuePrice,
      usd: proceeds,
      pnl,
      reason: "closed manually — all positions flat",
    });
    insertLog(
      db,
      "GENIUS",
      `Flat now: closed ${p.side} ${Math.round(p.shares)} @ ${(valuePrice * 100).toFixed(1)}¢ (${pnl >= 0 ? "+" : ""}${(((valuePrice - p.avgPrice) / p.avgPrice) * 100).toFixed(1)}%).`,
      p.marketId,
    );
    bumpDaily(db, { closed_other: 1, pnl });
    notify(
      `✋ <b>MANUAL CLOSE</b>\n<b>${p.side}</b> ${Math.round(p.shares)} shares @ ${(valuePrice * 100).toFixed(1)}¢\n${escapeHtml(truncate(market.question, 120))}\n${pnl >= 0 ? "💚 +" : "🔻 "}$${Math.abs(pnl).toFixed(2)}`,
    );
    closed += 1;
  }

  updateConfig(db, { cash, lastTickAt: now });

  if (closed > 0) {
    insertLog(
      db,
      "INFO",
      `${closed} position${closed > 1 ? "s" : ""} closed. The board is clean — waiting for fresh signals.`,
    );
  }
  return closed;
}

function resetAccount(db: DatabaseSync): void {
  const now = Date.now();
  const config = getConfig(db);
  if (!config) return;

  const positions = openPositions(db);
  const markets = allMarkets(db);
  const marketByIdMap = new Map(markets.map((m) => [m.id, m]));

  let cash = config.cash;
  for (const p of positions) {
    const market = marketByIdMap.get(p.marketId);
    if (!market) continue;
    const yesMid = marketMid(market);
    const valuePrice = p.side === "YES" ? yesMid : 1 - yesMid;
    cash += p.shares * valuePrice;
    closePosition(db, p.id, "CLOSED", p.shares * (valuePrice - p.avgPrice), now, "account reset");
  }

  updateConfig(db, { cash: config.bankroll, lastTickAt: now });

  db.prepare("DELETE FROM trades").run();
  db.prepare("DELETE FROM bot_logs").run();
  db.prepare("DELETE FROM daily_stats").run();

  insertLog(
    db,
    "GENIUS",
    `Account reset. Fresh $${config.bankroll.toLocaleString()} of virtual genius capital. The slate is clean — and so am I.`,
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleApiRequest(
  config: Config,
  db: DatabaseSync,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  pathname: string,
  body: Body | null,
): Promise<boolean> {
  try {
    // Public
    if (method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { ok: true, version: VERSION });
      return true;
    }
    if (method === "GET" && pathname === "/api/meta") {
      sendJson(res, 200, {
        mode: config.botMode,
        scanIntervalMs: config.scanIntervalMs,
        version: VERSION,
        telegramConfigured: telegramConfigured(),
        copyTradeWallet: config.copyTradeWallet,
        copyTradeEnabled: !!config.copyTradeWallet,
        copyMaxOpen: config.copyMaxOpen,
        copyMaxOrderUsd: config.copyMaxOrderUsd,
        copyMinTradeUsd: config.copyMinTradeUsd,
        copyScanIntervalMs: config.copyScanIntervalMs,
        reportTimezone: config.reportTimezone,
        reportHour: config.reportHour,
      });
      return true;
    }
    if (method === "POST" && pathname === "/api/login") {
      const pin = typeof body?.pin === "string" ? body.pin : "";
      const token = login(config, pin);
      if (!token) {
        sendJson(res, 401, { error: "wrong pin" });
        return true;
      }
      setSessionCookie(res, token, config.sessionTtlMs);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === "POST" && pathname === "/api/logout") {
      logout(readSessionToken(req));
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true });
      return true;
    }

    // Everything below requires the session cookie.
    if (!requireSession(config, req, res)) return true;

    if (method === "GET" && pathname === "/api/status") {
      sendJson(res, 200, buildStatus(db, config));
      return true;
    }
    if (method === "GET" && pathname === "/api/markets") {
      sendJson(res, 200, buildMarkets(db));
      return true;
    }
    if (method === "GET" && pathname.startsWith("/api/markets/")) {
      const id = Number(pathname.slice("/api/markets/".length));
      if (!Number.isInteger(id) || id <= 0) {
        sendJson(res, 400, { error: "invalid market id" });
        return true;
      }
      const detail = buildMarketDetail(db, id);
      if (!detail) {
        sendJson(res, 404, { error: "market not found" });
        return true;
      }
      const history = await getMarketHistory(db, id);
      sendJson(res, 200, { ...detail, history: history.points });
      return true;
    }
    if (method === "GET" && pathname === "/api/positions") {
      sendJson(res, 200, buildPositions(db));
      return true;
    }
    if (method === "GET" && pathname === "/api/trades") {
      sendJson(res, 200, buildTrades(db));
      return true;
    }
    if (method === "GET" && pathname === "/api/logs") {
      sendJson(res, 200, buildLogs(db));
      return true;
    }

    if (method === "POST" && pathname === "/api/bot/enable") {
      setBotEnabled(db, body?.enabled === true);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === "POST" && pathname === "/api/bot/aggression") {
      const value = typeof body?.aggression === "number" ? body.aggression : 0.25;
      const clamped = Math.min(0.5, Math.max(0.05, value));
      updateConfig(db, { aggression: clamped });
      sendJson(res, 200, { aggression: clamped });
      return true;
    }
    if (method === "POST" && pathname === "/api/bot/close-all") {
      const closed = closeAllPositions(db);
      sendJson(res, 200, { closed });
      return true;
    }
    if (method === "POST" && pathname === "/api/bot/reset") {
      resetAccount(db);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === "POST" && pathname === "/api/bot/run-tick") {
      const result = await runBotTick(db);
      sendJson(res, 200, result);
      return true;
    }
    if (method === "POST" && pathname === "/api/bot/refresh") {
      const result = await refreshMarketData(db);
      sendJson(res, 200, result);
      return true;
    }

    return false;
  } catch (error) {
    console.error("api error:", pathname, error);
    sendJson(res, 500, { error: "internal error" });
    return true;
  }
}
