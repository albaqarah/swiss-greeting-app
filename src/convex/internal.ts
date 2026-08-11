// Internal database access for the bot actions ("use node" files can't use
// ctx.db directly, so they go through these internal queries/mutations).
// Exposed as api.internal.* because the file is named internal.ts.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { api } from "./_generated/api";

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

export const hasOpenPositions = query({
  args: {},
  handler: async (ctx) => {
    const open = await ctx.db
      .query("positions")
      .filter((q) => q.eq(q.field("status"), "OPEN"))
      .first();
    return open !== null;
  },
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

// How long a claimed tick may hold the lock before it's considered stale
// (e.g. the action crashed mid-run) and another tick may take over.
export const TICK_LOCK_MS = 10 * 60 * 1000;

export const applyBookOnly = mutation({
  args: { gammaId: v.string(), book: bookValidator, updatedAt: v.number() },
  handler: async (ctx, { gammaId, book, updatedAt }) => {
    const existing = await ctx.db
      .query("markets")
      .withIndex("by_gamma_id", (q) => q.eq("gammaId", gammaId))
      .first();
    if (!existing) return null;
    await ctx.db.patch(existing._id, { book, updatedAt });
    return existing._id;
  },
});

export const claimTick = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const config = await ctx.db
      .query("botConfigs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!config || !config.enabled) {
      return { claimed: false, reason: "bot disabled" };
    }
    const now = Date.now();
    if (config.tickRunningAt && now - config.tickRunningAt < TICK_LOCK_MS) {
      return { claimed: false, reason: "tick in progress" };
    }
    await ctx.db.patch(config._id, { tickRunningAt: now });
    return { claimed: true, reason: null };
  },
});

export const releaseTick = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const config = await ctx.db
      .query("botConfigs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!config) return null;
    await ctx.db.patch(config._id, { tickRunningAt: 0 });
    return config._id;
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

// Keeps the fast scan loop alive. The bot tick reschedules itself every few
// seconds; this mutation is the single point of truth so that the 1-minute
// cron backstop, the "Run genius now" button and the loop itself can never
// accidentally spawn a second chain. Mutations on the same singleton row are
// serialized by Convex, so concurrent callers collapse into one scheduling.
export const scheduleNextTick = mutation({
  args: { intervalMs: v.number() },
  handler: async (ctx, { intervalMs }) => {
    const [state] = await ctx.db.query("schedulerState").collect();
    const now = Date.now();
    if (state && now - state.lastScheduledAt < intervalMs) {
      return { scheduled: false };
    }
    if (state) {
      await ctx.db.patch(state._id, { lastScheduledAt: now });
    } else {
      await ctx.db.insert("schedulerState", { lastScheduledAt: now });
    }
    await ctx.scheduler.runAfter(intervalMs, api.bot.tick, {});
    return { scheduled: true };
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
