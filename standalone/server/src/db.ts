// SQLite store for the standalone bot (Node 22+ built-in `node:sqlite` — zero
// native dependencies, nothing extra to install on the VPS).

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BookLevel {
  price: number;
  size: number;
}

export interface Book {
  ts: number;
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface Signal {
  ts: number;
  mid: number;
  score: number;
  direction: "YES" | "NO" | "HOLD";
  confidence: number;
  reasons: string[];
}

export interface Market {
  id: number;
  gammaId: string;
  conditionId: string;
  question: string;
  slug: string;
  image: string | null;
  outcomes: string[];
  outcomePrices: number[];
  clobTokenIds: string[];
  volume: number;
  volume24hr: number;
  liquidity: number;
  startDate: number | null;
  endDate: number | null;
  active: boolean;
  closed: boolean;
  updatedAt: number;
  book: Book | null;
  prevMid: number | null;
  signal: Signal | null;
}

export interface BotConfig {
  id: number;
  bankroll: number;
  cash: number;
  enabled: boolean;
  aggression: number;
  lastTickAt: number | null;
  tickRunningAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Position {
  id: number;
  marketId: number;
  side: "YES" | "NO";
  shares: number;
  avgPrice: number;
  invested: number;
  status: "OPEN" | "CLOSED" | "SETTLED";
  closedAt: number | null;
  realizedPnl: number | null;
  reason: string | null;
  createdAt: number;
}

export interface Trade {
  id: number;
  marketId: number;
  side: "YES" | "NO";
  action: "BUY" | "SELL" | "SETTLE";
  shares: number;
  price: number;
  usd: number;
  pnl: number | null;
  reason: string;
  createdAt: number;
}

export interface LogEntry {
  id: number;
  level: "INFO" | "TRADE" | "GENIUS" | "WARN";
  message: string;
  marketId: number | null;
  createdAt: number;
}

export interface PriceHistory {
  id: number;
  marketId: number;
  tokenId: string;
  points: { t: number; p: number }[];
  fetchedAt: number;
}

export interface NewMarket {
  gammaId: string;
  conditionId: string;
  question: string;
  slug: string;
  image: string | null;
  outcomes: string[];
  outcomePrices: number[];
  clobTokenIds: string[];
  volume: number;
  volume24hr: number;
  liquidity: number;
  startDate: number | null;
  endDate: number | null;
  active: boolean;
  closed: boolean;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gamma_id TEXT NOT NULL UNIQUE,
  condition_id TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  image TEXT,
  outcomes TEXT NOT NULL DEFAULT '[]',
  outcome_prices TEXT NOT NULL DEFAULT '[]',
  clob_token_ids TEXT NOT NULL DEFAULT '[]',
  volume REAL NOT NULL DEFAULT 0,
  volume24hr REAL NOT NULL DEFAULT 0,
  liquidity REAL NOT NULL DEFAULT 0,
  start_date INTEGER,
  end_date INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  closed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  book TEXT,
  prev_mid REAL,
  signal TEXT
);

CREATE TABLE IF NOT EXISTS bot_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bankroll REAL NOT NULL,
  cash REAL NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  aggression REAL NOT NULL DEFAULT 0.25,
  last_tick_at INTEGER,
  tick_running_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER NOT NULL,
  side TEXT NOT NULL,
  shares REAL NOT NULL,
  avg_price REAL NOT NULL,
  invested REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  closed_at INTEGER,
  realized_pnl REAL,
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER NOT NULL,
  side TEXT NOT NULL,
  action TEXT NOT NULL,
  shares REAL NOT NULL,
  price REAL NOT NULL,
  usd REAL NOT NULL,
  pnl REAL,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  market_id INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER NOT NULL UNIQUE,
  token_id TEXT NOT NULL,
  points TEXT NOT NULL DEFAULT '[]',
  fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id);
CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_created ON bot_logs(created_at DESC);
`;

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const asJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const asNum = (value: unknown): number =>
  typeof value === "number" ? value : Number(value ?? 0);

const asBool = (value: unknown): boolean => value === 1 || value === true;

const asStr = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

function mapMarket(row: Row): Market {
  return {
    id: asNum(row.id),
    gammaId: String(row.gamma_id ?? ""),
    conditionId: String(row.condition_id ?? ""),
    question: String(row.question ?? ""),
    slug: String(row.slug ?? ""),
    image: asStr(row.image),
    outcomes: asJson<string[]>(row.outcomes, []),
    outcomePrices: asJson<number[]>(row.outcome_prices, []),
    clobTokenIds: asJson<string[]>(row.clob_token_ids, []),
    volume: asNum(row.volume),
    volume24hr: asNum(row.volume24hr),
    liquidity: asNum(row.liquidity),
    startDate: asNum(row.start_date) || null,
    endDate: asNum(row.end_date) || null,
    active: asBool(row.active),
    closed: asBool(row.closed),
    updatedAt: asNum(row.updated_at),
    book: asJson<Book | null>(row.book, null),
    prevMid: row.prev_mid === null || row.prev_mid === undefined ? null : asNum(row.prev_mid),
    signal: asJson<Signal | null>(row.signal, null),
  };
}

function mapConfig(row: Row): BotConfig {
  return {
    id: asNum(row.id),
    bankroll: asNum(row.bankroll),
    cash: asNum(row.cash),
    enabled: asBool(row.enabled),
    aggression: asNum(row.aggression),
    lastTickAt: row.last_tick_at === null || row.last_tick_at === undefined ? null : asNum(row.last_tick_at),
    tickRunningAt: asNum(row.tick_running_at),
    createdAt: asNum(row.created_at),
    updatedAt: asNum(row.updated_at),
  };
}

function mapPosition(row: Row): Position {
  return {
    id: asNum(row.id),
    marketId: asNum(row.market_id),
    side: String(row.side) as Position["side"],
    shares: asNum(row.shares),
    avgPrice: asNum(row.avg_price),
    invested: asNum(row.invested),
    status: String(row.status) as Position["status"],
    closedAt: row.closed_at === null || row.closed_at === undefined ? null : asNum(row.closed_at),
    realizedPnl: row.realized_pnl === null || row.realized_pnl === undefined ? null : asNum(row.realized_pnl),
    reason: asStr(row.reason),
    createdAt: asNum(row.created_at),
  };
}

function mapTrade(row: Row): Trade {
  return {
    id: asNum(row.id),
    marketId: asNum(row.market_id),
    side: String(row.side) as Trade["side"],
    action: String(row.action) as Trade["action"],
    shares: asNum(row.shares),
    price: asNum(row.price),
    usd: asNum(row.usd),
    pnl: row.pnl === null || row.pnl === undefined ? null : asNum(row.pnl),
    reason: String(row.reason ?? ""),
    createdAt: asNum(row.created_at),
  };
}

function mapLog(row: Row): LogEntry {
  return {
    id: asNum(row.id),
    level: String(row.level) as LogEntry["level"],
    message: String(row.message ?? ""),
    marketId: row.market_id === null || row.market_id === undefined ? null : asNum(row.market_id),
    createdAt: asNum(row.created_at),
  };
}

function mapPriceHistory(row: Row): PriceHistory {
  return {
    id: asNum(row.id),
    marketId: asNum(row.market_id),
    tokenId: String(row.token_id ?? ""),
    points: asJson<{ t: number; p: number }[]>(row.points, []),
    fetchedAt: asNum(row.fetched_at),
  };
}

// ---------------------------------------------------------------------------
// Open / seed
// ---------------------------------------------------------------------------

export function openStore(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "genius.db"));
  db.exec(SCHEMA);

  const existing = db.prepare("SELECT id FROM bot_config WHERE id = 1").get();
  if (!existing) {
    const now = Date.now();
    db.prepare(
      "INSERT INTO bot_config (id, bankroll, cash, enabled, aggression, created_at, updated_at) VALUES (1, ?, ?, 0, 0.25, ?, ?)",
    ).run(1000, 1000, now, now);
  }
  return db;
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

export function allMarkets(db: DatabaseSync): Market[] {
  const rows = db.prepare("SELECT * FROM markets ORDER BY volume24hr DESC").all() as Row[];
  return rows.map(mapMarket);
}

export function marketByGammaId(db: DatabaseSync, gammaId: string): Market | null {
  const row = db.prepare("SELECT * FROM markets WHERE gamma_id = ?").get(gammaId) as Row | undefined;
  return row ? mapMarket(row) : null;
}

export function marketById(db: DatabaseSync, id: number): Market | null {
  const row = db.prepare("SELECT * FROM markets WHERE id = ?").get(id) as Row | undefined;
  return row ? mapMarket(row) : null;
}

export function upsertMarket(db: DatabaseSync, market: NewMarket, updatedAt: number): number {
  const existing = marketByGammaId(db, market.gammaId);
  if (existing) {
    db.prepare(
      `UPDATE markets SET condition_id = ?, question = ?, slug = ?, image = ?, outcomes = ?,
       outcome_prices = ?, clob_token_ids = ?, volume = ?, volume24hr = ?, liquidity = ?,
       start_date = ?, end_date = ?, active = ?, closed = ?, updated_at = ? WHERE id = ?`,
    ).run(
      market.conditionId, market.question, market.slug, market.image,
      JSON.stringify(market.outcomes), JSON.stringify(market.outcomePrices),
      JSON.stringify(market.clobTokenIds), market.volume, market.volume24hr,
      market.liquidity, market.startDate, market.endDate,
      market.active ? 1 : 0, market.closed ? 1 : 0, updatedAt, existing.id,
    );
    return existing.id;
  }
  const result = db.prepare(
    `INSERT INTO markets (gamma_id, condition_id, question, slug, image, outcomes, outcome_prices,
     clob_token_ids, volume, volume24hr, liquidity, start_date, end_date, active, closed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    market.gammaId, market.conditionId, market.question, market.slug, market.image,
    JSON.stringify(market.outcomes), JSON.stringify(market.outcomePrices),
    JSON.stringify(market.clobTokenIds), market.volume, market.volume24hr,
    market.liquidity, market.startDate, market.endDate,
    market.active ? 1 : 0, market.closed ? 1 : 0, updatedAt,
  );
  return Number(result.lastInsertRowid);
}

export function applyBookAndSignal(
  db: DatabaseSync,
  gammaId: string,
  book: Book,
  signal: Signal,
  prevMid: number,
  updatedAt: number,
): number | null {
  const existing = marketByGammaId(db, gammaId);
  if (!existing) return null;
  db.prepare(
    "UPDATE markets SET book = ?, signal = ?, prev_mid = ?, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify(book), JSON.stringify(signal), prevMid, updatedAt, existing.id);
  return existing.id;
}

export function applyBookOnly(db: DatabaseSync, gammaId: string, book: Book, updatedAt: number): number | null {
  const existing = marketByGammaId(db, gammaId);
  if (!existing) return null;
  db.prepare("UPDATE markets SET book = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(book), updatedAt, existing.id,
  );
  return existing.id;
}

export function markMarketClosed(db: DatabaseSync, gammaId: string, outcomePrices: number[]): number | null {
  const existing = marketByGammaId(db, gammaId);
  if (!existing || existing.closed) return null;
  db.prepare(
    "UPDATE markets SET closed = 1, outcome_prices = ?, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify(outcomePrices), Date.now(), existing.id);
  return existing.id;
}

export function hasOpenPositions(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT id FROM positions WHERE status = 'OPEN' LIMIT 1").get() as Row | undefined;
  return row !== undefined;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function getConfig(db: DatabaseSync): BotConfig | null {
  const row = db.prepare("SELECT * FROM bot_config WHERE id = 1").get() as Row | undefined;
  return row ? mapConfig(row) : null;
}

export function updateConfig(
  db: DatabaseSync,
  patch: Partial<{ bankroll: number; cash: number; enabled: boolean; aggression: number; lastTickAt: number; tickRunningAt: number }>,
): void {
  const current = getConfig(db);
  if (!current) return;
  const next = {
    bankroll: patch.bankroll ?? current.bankroll,
    cash: patch.cash ?? current.cash,
    enabled: patch.enabled ?? current.enabled,
    aggression: patch.aggression ?? current.aggression,
    lastTickAt: patch.lastTickAt ?? current.lastTickAt,
    tickRunningAt: patch.tickRunningAt ?? current.tickRunningAt,
  };
  db.prepare(
    `UPDATE bot_config SET bankroll = ?, cash = ?, enabled = ?, aggression = ?,
     last_tick_at = ?, tick_running_at = ?, updated_at = ? WHERE id = 1`,
  ).run(
    next.bankroll, next.cash, next.enabled ? 1 : 0, next.aggression,
    next.lastTickAt, next.tickRunningAt, Date.now(),
  );
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export function openPositions(db: DatabaseSync): Position[] {
  const rows = db.prepare("SELECT * FROM positions WHERE status = 'OPEN'").all() as Row[];
  return rows.map(mapPosition);
}

export function insertPosition(
  db: DatabaseSync,
  position: { marketId: number; side: "YES" | "NO"; shares: number; avgPrice: number; invested: number; reason: string },
): number {
  const result = db.prepare(
    `INSERT INTO positions (market_id, side, shares, avg_price, invested, status, reason, created_at)
     VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
  ).run(
    position.marketId, position.side, position.shares, position.avgPrice,
    position.invested, position.reason, Date.now(),
  );
  return Number(result.lastInsertRowid);
}

export function closePosition(
  db: DatabaseSync,
  positionId: number,
  status: "CLOSED" | "SETTLED",
  realizedPnl: number,
  closedAt: number,
  reason: string,
): void {
  db.prepare(
    "UPDATE positions SET status = ?, realized_pnl = ?, closed_at = ?, reason = ? WHERE id = ?",
  ).run(status, realizedPnl, closedAt, reason, positionId);
}

// ---------------------------------------------------------------------------
// Trades & logs
// ---------------------------------------------------------------------------

export function insertTrade(
  db: DatabaseSync,
  trade: {
    marketId: number;
    side: "YES" | "NO";
    action: "BUY" | "SELL" | "SETTLE";
    shares: number;
    price: number;
    usd: number;
    pnl?: number;
    reason: string;
  },
): number {
  const result = db.prepare(
    `INSERT INTO trades (market_id, side, action, shares, price, usd, pnl, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    trade.marketId, trade.side, trade.action, trade.shares, trade.price, trade.usd,
    trade.pnl ?? null, trade.reason, Date.now(),
  );
  return Number(result.lastInsertRowid);
}

export function insertLog(
  db: DatabaseSync,
  level: LogEntry["level"],
  message: string,
  marketId?: number | null,
): number {
  const result = db.prepare(
    "INSERT INTO bot_logs (level, message, market_id, created_at) VALUES (?, ?, ?, ?)",
  ).run(level, message, marketId ?? null, Date.now());
  // Keep the journal from growing forever.
  db.prepare("DELETE FROM bot_logs WHERE id NOT IN (SELECT id FROM bot_logs ORDER BY created_at DESC LIMIT 5000)").run();
  return Number(result.lastInsertRowid);
}

export function listTrades(db: DatabaseSync, limit = 50): Trade[] {
  const rows = db.prepare("SELECT * FROM trades ORDER BY created_at DESC LIMIT ?").all(limit) as Row[];
  return rows.map(mapTrade);
}

export function listLogs(db: DatabaseSync, limit = 60): LogEntry[] {
  const rows = db.prepare("SELECT * FROM bot_logs ORDER BY created_at DESC LIMIT ?").all(limit) as Row[];
  return rows.map(mapLog);
}

// ---------------------------------------------------------------------------
// Price history
// ---------------------------------------------------------------------------

export function priceHistoryByMarket(db: DatabaseSync, marketId: number): PriceHistory | null {
  const row = db.prepare("SELECT * FROM price_history WHERE market_id = ?").get(marketId) as Row | undefined;
  return row ? mapPriceHistory(row) : null;
}

export function upsertPriceHistory(
  db: DatabaseSync,
  marketId: number,
  tokenId: string,
  points: { t: number; p: number }[],
): void {
  const existing = priceHistoryByMarket(db, marketId);
  if (existing) {
    db.prepare("UPDATE price_history SET token_id = ?, points = ?, fetched_at = ? WHERE id = ?").run(
      tokenId, JSON.stringify(points), Date.now(), existing.id,
    );
  } else {
    db.prepare(
      "INSERT INTO price_history (market_id, token_id, points, fetched_at) VALUES (?, ?, ?, ?)",
    ).run(marketId, tokenId, JSON.stringify(points), Date.now());
  }
}
