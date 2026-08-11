// Internal database access for the bot actions ("use node" files can't use
// ctx.db directly, so they go through these internal queries/mutations).
// Exposed as api.internal.* because the file is named internal.ts.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const bookLevel = v.object({ price: v.number(), size: v.number() });

export const bookValidator = v.object({
  ts: v.number(),
  bids: v.array(bookLevel),
  asks: v.array(bookLevel),
});

export const signalValidator = v.object({
  ts: v.number(),
  mid: v.number(),
  score: v.number(),
  direction: v.union(v.literal("YES"), v.literal("NO"), v.literal("HOLD")),
  confidence: v.number(),
  reasons: v.array(v.string()),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const allMarkets = query({
  args: {},
  handler: async (ctx) => ctx.db.query("markets").collect(),
});

export const marketByGammaId = query({
  args: { gammaId: v.string() },
  handler: async (ctx, { gammaId }) =>
    ctx.db
      .query("markets")
      .withIndex("by_gamma_id", (q) => q.eq("gammaId", gammaId))
      .first(),
});

export const botConfigByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    ctx.db
      .query("botConfigs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first(),
});

export const allEnabledConfigs = query({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("botConfigs")
      .filter((q) => q.eq(q.field("enabled"), true))
      .collect(),
});

export const openPositionsByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    ctx.db
      .query("positions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "OPEN"),
      )
      .collect(),
});

export const priceHistoryByMarket = query({
  args: { marketId: v.id("markets") },
  handler: async (ctx, { marketId }) =>
    ctx.db
      .query("priceHistory")
      .withIndex("by_market", (q) => q.eq("marketId", marketId))
      .first(),
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const upsertMarket = mutation({
  args: {
    market: v.object({
      gammaId: v.string(),
      conditionId: v.string(),
      question: v.string(),
      slug: v.string(),
      image: v.optional(v.string()),
      outcomes: v.array(v.string()),
      outcomePrices: v.array(v.number()),
      clobTokenIds: v.array(v.string()),
      volume: v.optional(v.number()),
      volume24hr: v.optional(v.number()),
      liquidity: v.optional(v.number()),
      startDate: v.optional(v.number()),
      endDate: v.optional(v.number()),
      active: v.boolean(),
      closed: v.boolean(),
    }),
    updatedAt: v.number(),
  },
  handler: async (ctx, { market, updatedAt }) => {
    const existing = await ctx.db
      .query("markets")
      .withIndex("by_gamma_id", (q) => q.eq("gammaId", market.gammaId))
      .first();
    const fields = { ...market, updatedAt };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return ctx.db.insert("markets", fields);
  },
});

export const applyBookAndSignal = mutation({
  args: {
    gammaId: v.string(),
    book: bookValidator,
    signal: signalValidator,
    prevMid: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, { gammaId, book, signal, prevMid, updatedAt }) => {
    const existing = await ctx.db
      .query("markets")
      .withIndex("by_gamma_id", (q) => q.eq("gammaId", gammaId))
      .first();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      book,
      signal,
      prevMid,
      updatedAt,
    });
    return existing._id;
  },
});

export const markMarketClosed = mutation({
  args: { gammaId: v.string(), outcomePrices: v.array(v.number()) },
  handler: async (ctx, { gammaId, outcomePrices }) => {
    const existing = await ctx.db
      .query("markets")
      .withIndex("by_gamma_id", (q) => q.eq("gammaId", gammaId))
      .first();
    if (!existing || existing.closed) return null;
    await ctx.db.patch(existing._id, {
      closed: true,
      outcomePrices,
      updatedAt: Date.now(),
    });
    return existing._id;
  },
});

export const insertPosition = mutation({
  args: {
    userId: v.id("users"),
    marketId: v.id("markets"),
    side: v.union(v.literal("YES"), v.literal("NO")),
    shares: v.number(),
    avgPrice: v.number(),
    invested: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("positions", {
      ...args,
      status: "OPEN",
    });
  },
});

export const closePosition = mutation({
  args: {
    positionId: v.id("positions"),
    status: v.union(v.literal("CLOSED"), v.literal("SETTLED")),
    realizedPnl: v.number(),
    closedAt: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, { positionId, status, realizedPnl, closedAt, reason }) => {
    await ctx.db.patch(positionId, {
      status,
      realizedPnl,
      closedAt,
      reason,
    });
  },
});

export const insertTrade = mutation({
  args: {
    userId: v.id("users"),
    marketId: v.id("markets"),
    side: v.union(v.literal("YES"), v.literal("NO")),
    action: v.union(v.literal("BUY"), v.literal("SELL"), v.literal("SETTLE")),
    shares: v.number(),
    price: v.number(),
    usd: v.number(),
    pnl: v.optional(v.number()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("trades", { ...args, createdAt: Date.now() });
  },
});

export const insertLog = mutation({
  args: {
    userId: v.id("users"),
    level: v.union(
      v.literal("INFO"),
      v.literal("TRADE"),
      v.literal("GENIUS"),
      v.literal("WARN"),
    ),
    message: v.string(),
    marketId: v.optional(v.id("markets")),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("botLogs", { ...args, createdAt: Date.now() });
  },
});

export const updateBotCash = mutation({
  args: {
    userId: v.id("users"),
    cash: v.number(),
    lastTickAt: v.number(),
  },
  handler: async (ctx, { userId, cash, lastTickAt }) => {
    const config = await ctx.db
      .query("botConfigs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!config) return null;
    await ctx.db.patch(config._id, { cash, lastTickAt, updatedAt: Date.now() });
    return config._id;
  },
});

export const upsertPriceHistory = mutation({
  args: {
    marketId: v.id("markets"),
    tokenId: v.string(),
    points: v.array(v.object({ t: v.number(), p: v.number() })),
  },
  handler: async (ctx, { marketId, tokenId, points }) => {
    const existing = await ctx.db
      .query("priceHistory")
      .withIndex("by_market", (q) => q.eq("marketId", marketId))
      .first();
    const fetchedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { tokenId, points, fetchedAt });
      return existing._id;
    }
    return ctx.db.insert("priceHistory", { marketId, tokenId, points, fetchedAt });
  },
});
