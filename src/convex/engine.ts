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
  nearCertainLine,
  stopLossLine,
  settleLine,
  truncate,
  ParsedMarket,
} from "./polymarket";
import { validateMarketNews, NewsCheck } from "./news";

export const MAX_OPEN_POSITIONS = 5;
const MIN_SHARES = 5;
const TAKE_PROFIT_MULT = 2.0; // sell when the position is worth 2× the entry
const NEAR_CERTAIN_PRICE = 0.95; // ...or when it's basically resolved — lock it
const STOP_LOSS_MULT = 0.75;
const MAX_ENTRY_PRICE = 0.05; // entry only below 5¢ — early entry or nothing
const SIGNAL_MAX_AGE_MS = 10 * 60 * 1000;
const NEWS_TTL_MS = 15 * 60 * 1000; // re-check headlines at most every 15 min
const BOOK_SCOPE = 20; // fetch order books for the top N markets (parallel)

// ---------------------------------------------------------------------------
// Market data refresh
// ---------------------------------------------------------------------------

export async function refreshMarketsData(ctx: ActionCtx): Promise<{
  fetched: number;
  books: number;
}> {
  // Only fetch resolved-market data when someone actually holds a position —
  // keeps the fast loop lean.
  const hasOpenPositions = await ctx.runQuery(api.internal.hasOpenPositions);
  const closedMarkets = hasOpenPositions
    ? await fetchClosedGammaMarkets(100)
    : [];
  const [activeMarkets] = await Promise.all([fetchGammaMarkets(30)]);

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

  // Fetch every order book in parallel — speed is the whole point.
  const results = await Promise.allSettled(
    scoped.map(async (market) => {
      const tokenId = market.clobTokenIds[0];
      const book = await fetchOrderBook(tokenId);
      if (!book) return 0;

      const existing = await ctx.runQuery(api.internal.marketByGammaId, {
        gammaId: market.gammaId,
      });
      if (!existing) return 0;

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
// Per-user paper trading
// ---------------------------------------------------------------------------

export async function runUserTick(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<void> {
  // One tick per user at a time: the cron, the "Run genius now" button and the
  // dashboard watchdog can all fire at the same moment. The lock keeps them
  // from double-exiting or double-entering the same account.
  const claim = await ctx.runMutation(api.internal.claimTick, { userId });
  if (!claim.claimed) return;
  try {
    await runUserTickLocked(ctx, userId);
  } finally {
    await ctx.runMutation(api.internal.releaseTick, { userId });
  }
}

async function runUserTickLocked(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<void> {
  const config = await ctx.runQuery(api.internal.botConfigByUser, { userId });
  if (!config || !config.enabled) return;

  const openPositions = await ctx.runQuery(api.internal.openPositionsByUser, {
    userId,
  });
  let markets = await ctx.runQuery(api.internal.allMarkets);
  let marketById = new Map(markets.map((m) => [m._id, m]));

  // Refresh the live order book for every held market first. Exits must always
  // see current prices — even for markets that just resolved or dropped out of
  // the top-N refresh scope, otherwise a position sitting at 2×+ can stay open
  // forever on stale cached data.
  const heldMarkets = openPositions
    .map((p) => marketById.get(p.marketId))
    .filter(
      (m): m is NonNullable<typeof m> =>
        m !== undefined && m.clobTokenIds[0] !== undefined,
    );
  await Promise.allSettled(
    heldMarkets.map(async (market) => {
      const tokenId = market.clobTokenIds[0];
      if (!tokenId) return;
      const book = await fetchOrderBook(tokenId);
      if (!book) return;
      await ctx.runMutation(api.internal.applyBookOnly, {
        gammaId: market.gammaId,
        book,
        updatedAt: Date.now(),
      });
    }),
  );

  // Re-read markets so exits evaluate against the fresh books.
  markets = await ctx.runQuery(api.internal.allMarkets);
  marketById = new Map(markets.map((m) => [m._id, m]));

  const now = Date.now();
  let cash = config.cash;

  // 1) Exits: settlement, take-profit, stop-loss.
  for (const position of openPositions) {
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

      const takeProfitHit = value >= position.avgPrice * TAKE_PROFIT_MULT;
      const nearCertainHit = value >= NEAR_CERTAIN_PRICE;
      if (takeProfitHit || nearCertainHit) {
        const reason = takeProfitHit ? "take-profit" : "near-certain";
        const proceeds = position.shares * value;
        const pnl = proceeds - position.invested;
        cash += proceeds;
        await ctx.runMutation(api.internal.closePosition, {
          positionId: position._id,
          status: "CLOSED",
          realizedPnl: pnl,
          closedAt: now,
          reason,
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
          reason,
        });
        await insertLog(
          ctx,
          userId,
          "GENIUS",
          takeProfitHit
            ? takeProfitLine(position.side, value, pnlPct * 100)
            : nearCertainLine(position.side, value, pnlPct * 100),
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
    } catch (error) {
      // One bad position must never block the rest of the exits.
      console.error("exit failed for position", position._id, error);
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
      // Only enter below 5¢ — early entry or nothing.
      if (price <= 0.02 || price > MAX_ENTRY_PRICE) continue;

      // Anti-lose gate: never trade a side the news doesn't back. Cache the
      // check on the market doc so the 5s loop doesn't hammer the LLM.
      let news: NewsCheck | null = market.news ?? null;
      if (!news || now - news.ts > NEWS_TTL_MS) {
        news = await validateMarketNews(market.question, market.outcomes);
        if (news) {
          await ctx.runMutation(api.internal.applyMarketNews, {
            gammaId: market.gammaId,
            news,
          });
        }
      }
      if (!news || news.verdict === "UNCLEAR") {
        await insertLog(
          ctx,
          userId,
          "INFO",
          `News check on "${truncate(market.question, 50)}" came back unclear — no news, no trade.`,
          market._id,
        );
        continue;
      }
      if (news.verdict !== side) {
        await insertLog(
          ctx,
          userId,
          "INFO",
          `News favors ${news.verdict} but the book says ${side} on "${truncate(market.question, 40)}" — trusting the news, skipping.`,
          market._id,
        );
        continue;
      }

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
        reason: `2× TP entry @ ${cents(price)} — ${news?.summary ?? "early signal"}`,
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

// Mid of the YES token. Works with a two-sided book, a one-sided book (the
// visible side is the best estimate of where it trades), or falls back to the
// last Gamma outcome price. One-sided books are exactly what you get when a
// market is basically resolved — the exit logic must still see ~100¢.
function marketMid(market: {
  book?: { bids: { price: number }[]; asks: { price: number }[] } | null;
  outcomePrices: number[];
}): number {
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
