"use node";

// The genius engine: refreshes market data, computes signals, and runs each
// enabled user's paper-trading bot. Shared by the cron tick and manual runs.
// Actions have no ctx.db, so all database access goes through api.internal.*.

import { api } from "./_generated/api";
import { ActionCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import {
  computeSignal,
  fetchGammaMarkets,
  fetchClosedGammaMarkets,
  fetchOrderBook,
  cents,
  buyLine,
  takeProfitLine,
  stopLossLine,
  settleLine,
  truncate,
  ParsedMarket,
} from "./polymarket";

export const MAX_OPEN_POSITIONS = 5;
const MIN_SHARES = 5;
const TAKE_PROFIT_MULT = 1.15;
const STOP_LOSS_MULT = 0.75;
const SIGNAL_MAX_AGE_MS = 25 * 60 * 1000;
const BOOK_SCOPE = 12; // fetch order books for the top N markets by 24h volume

// ---------------------------------------------------------------------------
// Market data refresh
// ---------------------------------------------------------------------------

export async function refreshMarketsData(ctx: ActionCtx): Promise<{
  fetched: number;
  books: number;
}> {
  const [activeMarkets, closedMarkets] = await Promise.all([
    fetchGammaMarkets(30),
    fetchClosedGammaMarkets(100),
  ]);

  let fetched = 0;
  for (const market of activeMarkets) {
    await ctx.runMutation(api.internal.upsertMarket, {
      market: {
        gammaId: market.gammaId,
        conditionId: market.conditionId,
        question: market.question,
        slug: market.slug,
        image: market.image ?? undefined,
        outcomes: market.outcomes,
        outcomePrices: market.outcomePrices,
        clobTokenIds: market.clobTokenIds,
        volume: market.volume,
        volume24hr: market.volume24hr,
        liquidity: market.liquidity,
        startDate: market.startDate ?? undefined,
        endDate: market.endDate ?? undefined,
        active: market.active,
        closed: market.closed,
      },
      updatedAt: Date.now(),
    });
    fetched += 1;
  }

  // Reconcile recently resolved markets so open positions can settle.
  const closedById = new Map(closedMarkets.map((m) => [m.gammaId, m]));
  const stored = await ctx.runQuery(api.internal.allMarkets);
  for (const storedMarket of stored) {
    const resolved = closedById.get(storedMarket.gammaId);
    if (resolved && !storedMarket.closed) {
      await ctx.runMutation(api.internal.markMarketClosed, {
        gammaId: storedMarket.gammaId,
        outcomePrices: resolved.outcomePrices,
      });
    }
  }

  // Fetch order books for the most liquid markets and refresh signals.
  const books = await refreshBooksAndSignals(ctx, activeMarkets);

  return { fetched, books };
}

async function refreshBooksAndSignals(
  ctx: ActionCtx,
  markets: ParsedMarket[],
): Promise<number> {
  const scoped = [...markets]
    .filter((m) => m.active && !m.closed && m.clobTokenIds.length >= 2)
    .sort((a, b) => b.volume24hr - a.volume24hr)
    .slice(0, BOOK_SCOPE);

  let books = 0;
  for (const market of scoped) {
    const tokenId = market.clobTokenIds[0];
    const book = await fetchOrderBook(tokenId);
    if (!book) continue;
    books += 1;

    const existing = await ctx.runQuery(api.internal.marketByGammaId, {
      gammaId: market.gammaId,
    });
    if (!existing) continue;

    const signal = computeSignal({
      book,
      prevMid: existing.prevMid,
      volume24hr: existing.volume24hr,
      liquidity: existing.liquidity,
    });

    await ctx.runMutation(api.internal.applyBookAndSignal, {
      gammaId: market.gammaId,
      book: {
        ts: book.ts,
        bids: book.bids,
        asks: book.asks,
      },
      signal: {
        ts: signal.ts,
        mid: signal.mid,
        score: signal.score,
        direction: signal.direction,
        confidence: signal.confidence,
        reasons: signal.reasons,
      },
      prevMid: signal.mid,
      updatedAt: Date.now(),
    });
  }
  return books;
}

// ---------------------------------------------------------------------------
// Per-user paper trading
// ---------------------------------------------------------------------------

export async function runUserTick(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<void> {
  const config = await ctx.runQuery(api.internal.botConfigByUser, { userId });
  if (!config || !config.enabled) return;

  const openPositions = await ctx.runQuery(api.internal.openPositionsByUser, {
    userId,
  });
  const markets = await ctx.runQuery(api.internal.allMarkets);
  const marketById = new Map(markets.map((m) => [m._id, m]));

  const now = Date.now();
  let cash = config.cash;

  // 1) Exits: settlement, take-profit, stop-loss.
  for (const position of openPositions) {
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
      await ctx.runMutation(api.internal.closePosition, {
        positionId: position._id,
        status: "SETTLED",
        realizedPnl: pnl,
        closedAt: now,
        reason: "market resolved",
      });
      await insertTrade(ctx, {
        userId,
        marketId: market._id,
        side: position.side,
        action: "SETTLE",
        shares: position.shares,
        price,
        usd: proceeds,
        pnl,
        reason: "market resolved",
      });
      await insertLog(
        ctx,
        userId,
        "GENIUS",
        settleLine(position.side, price, pnl),
        market._id,
      );
      continue;
    }

    if (position.avgPrice <= 0) continue;
    const pnlPct = (value - position.avgPrice) / position.avgPrice;

    if (value >= position.avgPrice * TAKE_PROFIT_MULT) {
      const proceeds = position.shares * value;
      const pnl = proceeds - position.invested;
      cash += proceeds;
      await ctx.runMutation(api.internal.closePosition, {
        positionId: position._id,
        status: "CLOSED",
        realizedPnl: pnl,
        closedAt: now,
        reason: "take-profit",
      });
      await insertTrade(ctx, {
        userId,
        marketId: market._id,
        side: position.side,
        action: "SELL",
        shares: position.shares,
        price: value,
        usd: proceeds,
        pnl,
        reason: "take-profit",
      });
      await insertLog(
        ctx,
        userId,
        "GENIUS",
        takeProfitLine(position.side, value, pnlPct * 100),
        market._id,
      );
    } else if (value <= position.avgPrice * STOP_LOSS_MULT) {
      const proceeds = position.shares * value;
      const pnl = proceeds - position.invested;
      cash += proceeds;
      await ctx.runMutation(api.internal.closePosition, {
        positionId: position._id,
        status: "CLOSED",
        realizedPnl: pnl,
        closedAt: now,
        reason: "stop-loss",
      });
      await insertTrade(ctx, {
        userId,
        marketId: market._id,
        side: position.side,
        action: "SELL",
        shares: position.shares,
        price: value,
        usd: proceeds,
        pnl,
        reason: "stop-loss",
      });
      await insertLog(
        ctx,
        userId,
        "GENIUS",
        stopLossLine(position.side, value, pnlPct * 100),
        market._id,
      );
    }
  }

  // 2) Entries: only if we have room and dry powder.
  const openCount = openPositions.length;
  if (openCount < MAX_OPEN_POSITIONS && cash >= 25) {
    const held = new Set(openPositions.map((p) => p.marketId.toString()));
    const candidates = markets
      .filter((m) => {
        const signal = m.signal;
        if (!signal || signal.direction === "HOLD") return false;
        if (now - signal.ts > SIGNAL_MAX_AGE_MS) return false;
        if (m.closed || !m.active) return false;
        if (held.has(m._id.toString())) return false;
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
      if (price <= 0.02 || price >= 0.98) continue;

      const budget = cash * config.aggression * signal.confidence;
      let shares = budget / price;
      if (shares < MIN_SHARES) {
        await insertLog(
          ctx,
          userId,
          "INFO",
          `Wanted "${truncate(market.question, 50)}" but position would be ${Math.round(shares)} shares — too small even for a genius.`,
          market._id,
        );
        continue;
      }
      shares = Math.min(shares, cash / price);
      const cost = shares * price;
      cash -= cost;

      await ctx.runMutation(api.internal.insertPosition, {
        userId,
        marketId: market._id,
        side,
        shares,
        avgPrice: price,
        invested: cost,
        reason: `signal score ${signal.score.toFixed(2)}, confidence ${(signal.confidence * 100).toFixed(0)}%`,
      });
      await insertTrade(ctx, {
        userId,
        marketId: market._id,
        side,
        action: "BUY",
        shares,
        price,
        usd: cost,
        reason: signal.reasons[0] ?? "genius signal",
      });
      await insertLog(ctx, userId, "GENIUS", buyLine(side, shares, price), market._id);
      entries += 1;
    }

    if (entries === 0 && candidates.length > 0) {
      const top = candidates[0];
      await insertLog(
        ctx,
        userId,
        "INFO",
        `No new trade. Top candidate "${truncate(top.question, 50)}" — mid ${cents(top.signal?.mid ?? 0)}. Not worth my neurons today.`,
        top._id,
      );
    }
  }

  await ctx.runMutation(api.internal.updateBotCash, {
    userId,
    cash,
    lastTickAt: now,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function marketMid(market: {
  book?: { bids: { price: number }[]; asks: { price: number }[] } | null;
  outcomePrices: number[];
}): number {
  if (market.book && market.book.bids.length > 0 && market.book.asks.length > 0) {
    const bestBid = market.book.bids[0].price;
    const bestAsk = market.book.asks[0].price;
    if (bestAsk > bestBid) return (bestBid + bestAsk) / 2;
  }
  return market.outcomePrices[0] ?? 0.5;
}

function clampPrice(value: number): number {
  return Math.min(0.98, Math.max(0.02, value));
}

async function insertTrade(
  ctx: ActionCtx,
  trade: {
    userId: Id<"users">;
    marketId: Id<"markets">;
    side: "YES" | "NO";
    action: "BUY" | "SELL" | "SETTLE";
    shares: number;
    price: number;
    usd: number;
    pnl?: number;
    reason: string;
  },
): Promise<void> {
  await ctx.runMutation(api.internal.insertTrade, {
    userId: trade.userId,
    marketId: trade.marketId,
    side: trade.side,
    action: trade.action,
    shares: trade.shares,
    price: trade.price,
    usd: trade.usd,
    pnl: trade.pnl,
    reason: trade.reason,
  });
}

async function insertLog(
  ctx: ActionCtx,
  userId: Id<"users">,
  level: "INFO" | "TRADE" | "GENIUS" | "WARN",
  message: string,
  marketId?: Id<"markets">,
): Promise<void> {
  await ctx.runMutation(api.internal.insertLog, {
    userId,
    level,
    message,
    marketId,
  });
}
