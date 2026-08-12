// The genius engine — ported from the Convex version (src/convex/engine.ts) to
// run standalone on a VPS with plain Node + SQLite. No Convex, no ctx: every
// database touch goes through the store helpers in db.ts.
//
// Rules (unchanged from the Freebuff build):
//   - esports markets only (Gamma tag 64), resolving within 1h..24h
//   - entry only below 5¢ (early entry or nothing)
//   - take profit at 2× entry, stop loss at 25% below entry, near-certain exit
//     at 95¢, settlement handling for resolved markets
//   - scan loop every 5 seconds (see index.ts)

import type { DatabaseSync } from "node:sqlite";
import {
  allMarkets,
  applyBookAndSignal,
  applyBookOnly,
  closePosition,
  getConfig,
  hasOpenPositions,
  insertLog,
  insertPosition,
  insertTrade,
  marketByGammaId,
  marketById,
  markMarketClosed,
  openPositions,
  priceHistoryByMarket,
  updateConfig,
  upsertMarket,
  upsertPriceHistory,
  type Market,
  type Position,
} from "./db.js";
import {
  buyLine,
  cents,
  computeSignal,
  fetchClosedGammaMarkets,
  fetchGammaMarkets,
  fetchOrderBook,
  fetchPriceHistory,
  nearCertainLine,
  settleLine,
  stopLossLine,
  takeProfitLine,
  truncate,
  type ParsedMarket,
} from "./polymarket.js";
import { botMode } from "./config.js";
import { assertLiveReady, closeLivePosition, placeLiveOrder } from "./live.js";

export const MAX_OPEN_POSITIONS = 5;
const MIN_SHARES = 5;
const TAKE_PROFIT_MULT = 2.0; // sell when the position is worth 2× the entry
const NEAR_CERTAIN_PRICE = 0.95; // ...or when it's basically resolved — lock it
const STOP_LOSS_MULT = 0.75;
const MAX_ENTRY_PRICE = 0.05; // entry only below 5¢ — early entry or nothing
const SIGNAL_MAX_AGE_MS = 10 * 60 * 1000;
const BOOK_SCOPE = 20; // fetch order books for the top N markets (parallel)

// ---------------------------------------------------------------------------
// Market data refresh
// ---------------------------------------------------------------------------

export async function refreshMarketData(db: DatabaseSync): Promise<{
  fetched: number;
  books: number;
}> {
  // Only fetch resolved-market data when someone actually holds a position —
  // keeps the fast loop lean.
  const hasOpen = hasOpenPositions(db);
  const closedMarkets = hasOpen ? await fetchClosedGammaMarkets(100) : [];
  const activeMarkets = await fetchGammaMarkets(30);

  let fetched = 0;
  for (const market of activeMarkets) {
    upsertMarket(
      db,
      {
        gammaId: market.gammaId,
        conditionId: market.conditionId,
        question: market.question,
        slug: market.slug,
        image: market.image,
        outcomes: market.outcomes,
        outcomePrices: market.outcomePrices,
        clobTokenIds: market.clobTokenIds,
        volume: market.volume,
        volume24hr: market.volume24hr,
        liquidity: market.liquidity,
        startDate: market.startDate,
        endDate: market.endDate,
        active: market.active,
        closed: market.closed,
      },
      Date.now(),
    );
    fetched += 1;
  }

  // Reconcile recently resolved markets so open positions can settle.
  const closedById = new Map(closedMarkets.map((m) => [m.gammaId, m]));
  for (const stored of allMarkets(db)) {
    const resolved = closedById.get(stored.gammaId);
    if (resolved && !stored.closed) {
      markMarketClosed(db, stored.gammaId, resolved.outcomePrices);
    }
  }

  // Fetch order books for the most liquid markets and refresh signals.
  const books = await refreshBooksAndSignals(db, activeMarkets);

  return { fetched, books };
}

async function refreshBooksAndSignals(
  db: DatabaseSync,
  markets: ParsedMarket[],
): Promise<number> {
  const scoped = [...markets]
    .filter((m) => m.active && !m.closed && m.clobTokenIds.length >= 2)
    .sort((a, b) => b.volume24hr - a.volume24hr)
    .slice(0, BOOK_SCOPE);

  // Fetch every order book in parallel — speed is the whole point.
  const results = await Promise.allSettled(
    scoped.map(async (market) => {
      const tokenId = market.clobTokenIds[0];
      const book = await fetchOrderBook(tokenId);
      if (!book) return 0;

      const existing = marketByGammaId(db, market.gammaId);
      if (!existing) return 0;

      const signal = computeSignal({
        book,
        prevMid: existing.prevMid ?? undefined,
        volume24hr: existing.volume24hr,
        liquidity: existing.liquidity,
      });

      applyBookAndSignal(db, market.gammaId, book, signal, signal.mid, Date.now());
      return 1;
    }),
  );

  let books = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value === 1) books += 1;
  }
  return books;
}

// ---------------------------------------------------------------------------
// The bot tick (single account — this is a personal bot now)
// ---------------------------------------------------------------------------

export async function runUserTick(db: DatabaseSync): Promise<boolean> {
  const config = getConfig(db);
  if (!config || !config.enabled) return false;

  const mode = botMode();
  if (mode === "live") {
    const ready = assertLiveReady();
    if (!ready.ok) {
      insertLog(
        db,
        "WARN",
        `LIVE mode requested but execution is not ready: ${ready.reason}. Staying on dry paper trading.`,
      );
      return false;
    }
  }

  const openPos = openPositions(db);
  let markets = allMarkets(db);
  let marketById = new Map(markets.map((m) => [m.id, m]));

  // Refresh the live order book for every held market first. Exits must always
  // see current prices — even for markets that just resolved or dropped out of
  // the top-N refresh scope, otherwise a position sitting at 2×+ can stay open
  // forever on stale cached data.
  const heldMarkets = openPos
    .map((p) => marketById.get(p.marketId))
    .filter((m): m is Market => m !== undefined && m.clobTokenIds[0] !== undefined);
  await Promise.allSettled(
    heldMarkets.map(async (market) => {
      const tokenId = market.clobTokenIds[0];
      if (!tokenId) return;
      const book = await fetchOrderBook(tokenId);
      if (!book) return;
      applyBookOnly(db, market.gammaId, book, Date.now());
    }),
  );

  // Re-read markets so exits evaluate against the fresh books.
  markets = allMarkets(db);
  marketById = new Map(markets.map((m) => [m.id, m]));

  const now = Date.now();
  let cash = config.cash;

  // 1) Exits: settlement, take-profit, stop-loss.
  for (const position of openPos) {
    try {
      const market = marketById.get(position.marketId);
      if (!market) continue;

      const yesMid = marketMid(market);
      const value = position.side === "YES" ? yesMid : 1 - yesMid;

      if (market.closed) {
        const finalPrice =
          position.side === "YES"
            ? market.outcomePrices[0]
            : market.outcomePrices[1];
        const price = clampPrice(finalPrice ?? value);
        const proceeds = position.shares * price;
        const pnl = proceeds - position.invested;
        cash += proceeds;
        closePosition(db, position.id, "SETTLED", pnl, now, "market resolved");
        insertTrade(db, {
          marketId: market.id,
          side: position.side,
          action: "SETTLE",
          shares: position.shares,
          price,
          usd: proceeds,
          pnl,
          reason: "market resolved",
        });
        insertLog(db, "GENIUS", settleLine(position.side, price, pnl), market.id);
        continue;
      }

      if (position.avgPrice <= 0) continue;
      const pnlPct = (value - position.avgPrice) / position.avgPrice;

      const takeProfitHit = value >= position.avgPrice * TAKE_PROFIT_MULT;
      const nearCertainHit = value >= NEAR_CERTAIN_PRICE;
      if (takeProfitHit || nearCertainHit) {
        const reason = takeProfitHit ? "take-profit" : "near-certain";
        if (mode === "live") {
          try {
            await closeLivePosition({
              market,
              position,
              reason,
            });
          } catch (error) {
            insertLog(
              db,
              "WARN",
              `Live exit failed for ${position.side} @ ${cents(value)}: ${(error as Error).message}`,
              market.id,
            );
            continue;
          }
        }
        const proceeds = position.shares * value;
        const pnl = proceeds - position.invested;
        cash += proceeds;
        closePosition(db, position.id, "CLOSED", pnl, now, reason);
        insertTrade(db, {
          marketId: market.id,
          side: position.side,
          action: "SELL",
          shares: position.shares,
          price: value,
          usd: proceeds,
          pnl,
          reason,
        });
        insertLog(
          db,
          "GENIUS",
          takeProfitHit
            ? takeProfitLine(position.side, value, pnlPct * 100)
            : nearCertainLine(position.side, value, pnlPct * 100),
          market.id,
        );
      } else if (value <= position.avgPrice * STOP_LOSS_MULT) {
        if (mode === "live") {
          try {
            await closeLivePosition({ market, position, reason: "stop-loss" });
          } catch (error) {
            insertLog(
              db,
              "WARN",
              `Live exit failed for ${position.side} @ ${cents(value)}: ${(error as Error).message}`,
              market.id,
            );
            continue;
          }
        }
        const proceeds = position.shares * value;
        const pnl = proceeds - position.invested;
        cash += proceeds;
        closePosition(db, position.id, "CLOSED", pnl, now, "stop-loss");
        insertTrade(db, {
          marketId: market.id,
          side: position.side,
          action: "SELL",
          shares: position.shares,
          price: value,
          usd: proceeds,
          pnl,
          reason: "stop-loss",
        });
        insertLog(db, "GENIUS", stopLossLine(position.side, value, pnlPct * 100), market.id);
      }
    } catch (error) {
      // One bad position must never block the rest of the exits.
      console.error("exit failed for position", position.id, error);
    }
  }

  // 2) Entries: only if we have room and dry powder.
  const openCount = openPos.length;
  if (openCount < MAX_OPEN_POSITIONS && cash >= 25) {
    const held = new Set(openPos.map((p) => p.marketId));
    const candidates = markets
      .filter((m) => {
        const signal = m.signal;
        if (!signal || signal.direction === "HOLD") return false;
        if (now - signal.ts > SIGNAL_MAX_AGE_MS) return false;
        if (m.closed || !m.active) return false;
        if (held.has(m.id)) return false;
        return true;
      })
      .sort((a, b) => (b.signal?.confidence ?? 0) - (a.signal?.confidence ?? 0));

    let entries = 0;
    for (const market of candidates) {
      if (entries >= 2 || openCount + entries >= MAX_OPEN_POSITIONS) break;
      if (cash < 10) break;
      const signal = market.signal!;
      const side = signal.direction as "YES" | "NO";
      const price = clampPrice(side === "YES" ? signal.mid : 1 - signal.mid);
      // Only enter below 5¢ — early entry or nothing.
      if (price <= 0.02 || price > MAX_ENTRY_PRICE) continue;

      const budget = cash * config.aggression * signal.confidence;
      let shares = budget / price;
      if (shares < MIN_SHARES) {
        insertLog(
          db,
          "INFO",
          `Wanted "${truncate(market.question, 50)}" but position would be ${Math.round(shares)} shares — too small even for a genius.`,
          market.id,
        );
        continue;
      }
      shares = Math.min(shares, cash / price);
      const cost = shares * price;
      cash -= cost;

      if (mode === "live") {
        const tokenId = market.clobTokenIds[side === "YES" ? 0 : 1];
        try {
          await placeLiveOrder({ market, side, price, shares, budget: cost, tokenId });
        } catch (error) {
          insertLog(
            db,
            "WARN",
            `Live entry failed for "${truncate(market.question, 50)}": ${(error as Error).message}`,
            market.id,
          );
          cash += cost; // give the money back, nothing was filled
          continue;
        }
      }

      insertPosition(db, {
        marketId: market.id,
        side,
        shares,
        avgPrice: price,
        invested: cost,
        reason: `signal score ${signal.score.toFixed(2)}, confidence ${(signal.confidence * 100).toFixed(0)}%`,
      });
      insertTrade(db, {
        marketId: market.id,
        side,
        action: "BUY",
        shares,
        price,
        usd: cost,
        reason: `2× TP entry @ ${cents(price)} — early signal`,
      });
      insertLog(db, "GENIUS", buyLine(side, shares, price), market.id);
      entries += 1;
    }

    if (entries === 0 && candidates.length > 0) {
      const top = candidates[0];
      insertLog(
        db,
        "INFO",
        `No new trade. Top candidate "${truncate(top.question, 50)}" — mid ${cents(top.signal?.mid ?? 0)}. Not worth my neurons today.`,
        top.id,
      );
    }
  }

  updateConfig(db, { cash, lastTickAt: now });
  return true;
}

// ---------------------------------------------------------------------------
// Price history (cached 15 min, used by the dashboard microscope)
// ---------------------------------------------------------------------------

export async function getMarketHistory(
  db: DatabaseSync,
  marketId: number,
): Promise<{ points: { t: number; p: number }[] }> {
  const cached = priceHistoryByMarket(db, marketId);
  const fresh = cached && Date.now() - cached.fetchedAt < 15 * 60 * 1000;
  if (cached && fresh) {
    return { points: cached.points };
  }
  const target = marketById(db, marketId);
  if (!target) return { points: [] };
  const tokenId = target.clobTokenIds[0];
  const points = (await fetchPriceHistory(tokenId)) ?? [];
  upsertPriceHistory(db, marketId, tokenId, points);
  return { points };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Mid of the YES token. Works with a two-sided book, a one-sided book (the
// visible side is the best estimate of where it trades), or falls back to the
// last Gamma outcome price. One-sided books are exactly what you get when a
// market is basically resolved — the exit logic must still see ~100¢.
export function marketMid(market: Market): number {
  const book = market.book;
  if (book && (book.bids.length > 0 || book.asks.length > 0)) {
    const bestBid = book.bids[0]?.price;
    const bestAsk = book.asks[0]?.price;
    if (bestBid !== undefined && bestAsk !== undefined) {
      return (bestBid + bestAsk) / 2;
    }
    if (bestAsk !== undefined) return bestAsk;
    if (bestBid !== undefined) return bestBid;
  }
  return market.outcomePrices[0] ?? 0.5;
}

export function clampPrice(value: number): number {
  return Math.min(0.98, Math.max(0.02, value));
}

// Keep the type import happy for positions that reference markets (unused by
// default, but handy for debugging and future features).
export function positionQuestion(position: Position, marketById: Map<number, Market>): string {
  return marketById.get(position.marketId)?.question ?? "Unknown market";
}
