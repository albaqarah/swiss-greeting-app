"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { refreshMarketsData } from "./engine";
import { fetchPriceHistory } from "./polymarket";

/** Fetch the latest markets from the Gamma API, refresh order books and
 *  recompute genius signals. Safe to call from the UI or the cron. */
export const refreshMarkets = action({
  args: {},
  handler: async (ctx) => {
    return refreshMarketsData(ctx);
  },
});

/** Pull the last 24h of YES-token price history for a market and cache it. */
export const getMarketHistory = action({
  args: { marketId: v.id("markets") },
  handler: async (
    ctx,
    { marketId },
  ): Promise<{ points: { t: number; p: number }[] }> => {
    const cached = await ctx.runQuery(api.internal.priceHistoryByMarket, {
      marketId,
    });
    const fresh =
      cached && Date.now() - cached.fetchedAt < 15 * 60 * 1000;
    if (cached && fresh) {
      return { points: cached.points };
    }

    // Fetch fresh history from the CLOB API.
    const markets = await ctx.runQuery(api.internal.allMarkets);
    const target = markets.find((m) => m._id === marketId);
    if (!target) return { points: [] };

    const tokenId = target.clobTokenIds[0];
    const points = (await fetchPriceHistory(tokenId)) ?? [];

    await ctx.runMutation(api.internal.upsertPriceHistory, {
      marketId,
      tokenId,
      points,
    });
    return { points };
  },
});
