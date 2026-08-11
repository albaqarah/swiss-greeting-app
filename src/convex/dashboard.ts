import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

const DEFAULT_BANKROLL = 1000;

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

async function requireUser(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const config = await ctx.db
      .query("botConfigs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!config) return null;

    const positions = await ctx.db
      .query("positions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "OPEN"),
      )
      .collect();
    const markets = await ctx.db.query("markets").collect();
    const marketById = new Map(markets.map((m) => [m._id, m]));

    let positionValue = 0;
    let unrealizedPnl = 0;
    for (const p of positions) {
      const market = marketById.get(p.marketId);
      if (!market) continue;
      const yesMid = marketMid(market);
      const valuePrice = p.side === "YES" ? yesMid : 1 - yesMid;
      positionValue += p.shares * valuePrice;
      unrealizedPnl += p.shares * (valuePrice - p.avgPrice);
    }

    const closedTrades = await ctx.db
      .query("trades")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .collect();
    const exits = closedTrades.filter(
      (t) => (t.action === "SELL" || t.action === "SETTLE") && t.pnl !== undefined,
    );
    const wins = exits.filter((t) => (t.pnl ?? 0) > 0).length;

    const equity = config.cash + positionValue;
    const totalPnl = equity - config.bankroll;

    const marketsUpdatedAt = markets.reduce(
      (max, m) => Math.max(max, m.updatedAt),
      0,
    );

    return {
      config: {
        bankroll: config.bankroll,
        cash: config.cash,
        enabled: config.enabled,
        aggression: config.aggression,
        lastTickAt: config.lastTickAt ?? null,
      },
      equity,
      totalPnl,
      realizedPnl: totalPnl - unrealizedPnl,
      unrealizedPnl,
      openCount: positions.length,
      winRate: exits.length > 0 ? wins / exits.length : null,
      closedTradesCount: exits.length,
      marketsUpdatedAt,
    };
  },
});

export const listMarkets = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    void userId;
    const markets = await ctx.db.query("markets").collect();
    return markets
      .sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0))
      .slice(0, 30)
      .map((m) => ({
        _id: m._id,
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
  },
});

export const getMarket = query({
  args: { marketId: v.id("markets") },
  handler: async (ctx, { marketId }) => {
    const userId = await requireUser(ctx);
    void userId;
    const market = await ctx.db.get(marketId);
    if (!market) return null;
    const history = await ctx.db
      .query("priceHistory")
      .withIndex("by_market", (q) => q.eq("marketId", marketId))
      .first();
    return {
      ...market,
      history: history ? history.points : [],
    };
  },
});

export const listPositions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "OPEN"),
      )
      .collect();
    const markets = await ctx.db.query("markets").collect();
    const marketById = new Map(markets.map((m) => [m._id, m]));

    return positions.map((p) => {
      const market = marketById.get(p.marketId);
      const yesMid = market ? marketMid(market) : 0.5;
      const valuePrice = p.side === "YES" ? yesMid : 1 - yesMid;
      return {
        _id: p._id,
        marketId: p.marketId,
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
  },
});

export const listTrades = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const trades = await ctx.db
      .query("trades")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    const markets = await ctx.db.query("markets").collect();
    const marketById = new Map(markets.map((m) => [m._id, m]));
    return trades.map((t) => ({
      _id: t._id,
      action: t.action,
      side: t.side,
      shares: t.shares,
      price: t.price,
      usd: t.usd,
      pnl: t.pnl ?? null,
      reason: t.reason,
      createdAt: t.createdAt,
      question: marketById.get(t.marketId)?.question ?? "Unknown market",
    }));
  },
});

export const listLogs = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const logs = await ctx.db
      .query("botLogs")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(60);
    const markets = await ctx.db.query("markets").collect();
    const marketById = new Map(markets.map((m) => [m._id, m]));
    return logs.map((l) => ({
      _id: l._id,
      level: l.level,
      message: l.message,
      createdAt: l.createdAt,
      question: l.marketId ? (marketById.get(l.marketId)?.question ?? null) : null,
    }));
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const setBotEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("botConfigs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { enabled, updatedAt: now });
      await ctx.db.insert("botLogs", {
        userId,
        level: "INFO",
        message: enabled
          ? "Bot armed. Genius online. Watching the order books."
          : "Bot paused. Genius takes a coffee break.",
        createdAt: now,
      });
      return existing._id;
    }

    const configId = await ctx.db.insert("botConfigs", {
      userId,
      bankroll: DEFAULT_BANKROLL,
      cash: DEFAULT_BANKROLL,
      enabled,
      aggression: 0.25,
      lastTickAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("botLogs", {
      userId,
      level: "GENIUS",
      message: `Fresh $${DEFAULT_BANKROLL.toLocaleString()} of virtual genius capital allocated. Armed and scanning.`,
      createdAt: now,
    });
    return configId;
  },
});

export const setAggression = mutation({
  args: { aggression: v.number() },
  handler: async (ctx, { aggression }) => {
    const userId = await requireUser(ctx);
    const clamped = Math.min(0.5, Math.max(0.05, aggression));
    const existing = await ctx.db
      .query("botConfigs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      aggression: clamped,
      updatedAt: Date.now(),
    });
    return clamped;
  },
});

export const resetAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const config = await ctx.db
      .query("botConfigs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!config) return;

    // Liquidate open positions at the current market value.
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "OPEN"),
      )
      .collect();
    const markets = await ctx.db.query("markets").collect();
    const marketById = new Map(markets.map((m) => [m._id, m]));

    let cash = config.cash;
    for (const p of positions) {
      const market = marketById.get(p.marketId);
      if (!market) continue;
      const yesMid = marketMid(market);
      const valuePrice = p.side === "YES" ? yesMid : 1 - yesMid;
      cash += p.shares * valuePrice;
      await ctx.db.patch(p._id, {
        status: "CLOSED",
        closedAt: now,
        realizedPnl: p.shares * (valuePrice - p.avgPrice),
        reason: "account reset",
      });
    }

    await ctx.db.patch(config._id, {
      cash: config.bankroll,
      lastTickAt: now,
      updatedAt: now,
    });

    const trades = await ctx.db
      .query("trades")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .collect();
    for (const t of trades) await ctx.db.delete(t._id);
    const logs = await ctx.db
      .query("botLogs")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .collect();
    for (const l of logs) await ctx.db.delete(l._id);

    await ctx.db.insert("botLogs", {
      userId,
      level: "GENIUS",
      message: `Account reset. Fresh $${config.bankroll.toLocaleString()} of virtual genius capital. The slate is clean — and so am I.`,
      createdAt: now,
    });
  },
});
