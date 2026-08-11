"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { refreshMarketsData, runUserTick } from "./engine";

/**
 * Cron entry point (every 5 min, see convex.json): refresh market data once,
 * then run the bot for every user who has it enabled.
 */
export const tick = action({
  args: {},
  handler: async (ctx): Promise<{ marketsRefreshed: boolean; usersTicked: number }> => {
    try {
      await refreshMarketsData(ctx);
    } catch (error) {
      // Fall back to the last cached market data rather than aborting.
      console.error("market refresh failed, using cache", error);
    }

    const configs = await ctx.runQuery(api.internal.allEnabledConfigs);

    let ran = 0;
    for (const config of configs) {
      try {
        await runUserTick(ctx, config.userId);
        ran += 1;
      } catch (error) {
        console.error("bot tick failed for user", config.userId, error);
      }
    }
    return { marketsRefreshed: true, usersTicked: ran };
  },
});

/** Manual "run genius now" from the dashboard for the signed-in user. */
export const runTick = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ fetched: number; books: number; ran: boolean; reason?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Sign in to run the bot.");
    }

    let result: { fetched: number; books: number };
    try {
      result = await refreshMarketsData(ctx);
    } catch (error) {
      console.error("market refresh failed, using cache", error);
      result = { fetched: 0, books: 0 };
    }

    const config = await ctx.runQuery(api.internal.botConfigByUser, { userId });

    if (!config || !config.enabled) {
      return { ...result, ran: false, reason: "bot disabled" };
    }

    await runUserTick(ctx, userId);
    return { ...result, ran: true };
  },
});
