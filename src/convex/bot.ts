"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { refreshMarketsData, runUserTick } from "./engine";

// How often the fast scan loop re-runs while the bot is armed. Entry prices
// below 5¢ move in seconds, so the loop has to be quick — but never launch a
// second chain: scheduleNextTick serializes on a single DB row.
export const FAST_SCAN_INTERVAL_MS = 5000;

/**
 * Heartbeat entry point (every 1 min via crons.ts — a backstop): refresh
 * market data, run the bot for every armed user, then reschedule this same
 * action in a few seconds so the scan runs continuously while anyone is armed.
 */
export const tick = action({
  args: {},
  handler: async (ctx): Promise<{ marketsRefreshed: boolean; usersTicked: number; fastLoopArmed: boolean }> => {
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

    // Keep the fast loop alive only while someone is actually trading; the
    // 1-minute cron revives the chain if it ever stalls.
    let fastLoopArmed = false;
    if (configs.length > 0) {
      const next = await ctx.runMutation(api.internal.scheduleNextTick, {
        intervalMs: FAST_SCAN_INTERVAL_MS,
      });
      fastLoopArmed = next.scheduled;
    }
    return { marketsRefreshed: true, usersTicked: ran, fastLoopArmed };
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

    // Revive the fast loop on demand (the guard keeps it to one chain).
    await ctx.runMutation(api.internal.scheduleNextTick, {
      intervalMs: FAST_SCAN_INTERVAL_MS,
    });

    return { ...result, ran: true };
  },
});
