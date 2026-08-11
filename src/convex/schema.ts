import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Polymarket market snapshot (cached from the Gamma API)
    markets: defineTable({
      gammaId: v.string(), // Gamma market id
      conditionId: v.string(),
      question: v.string(),
      slug: v.string(),
      image: v.optional(v.string()),
      outcomes: v.array(v.string()), // e.g. ["Yes", "No"]
      outcomePrices: v.array(v.number()), // normalized to 0..1
      clobTokenIds: v.array(v.string()), // [YES token id, NO token id]
      volume: v.optional(v.number()),
      volume24hr: v.optional(v.number()),
      liquidity: v.optional(v.number()),
      startDate: v.optional(v.number()),
      endDate: v.optional(v.number()),
      active: v.boolean(),
      closed: v.boolean(),
      updatedAt: v.number(),
      // last cached order book (YES token)
      book: v.optional(
        v.object({
          ts: v.number(),
          bids: v.array(v.object({ price: v.number(), size: v.number() })),
          asks: v.array(v.object({ price: v.number(), size: v.number() })),
        }),
      ),
      // previous mid used for momentum across ticks
      prevMid: v.optional(v.number()),
      // cached genius signal from the last bot tick
      signal: v.optional(
        v.object({
          ts: v.number(),
          mid: v.number(),
          score: v.number(),
          direction: v.union(
            v.literal("YES"),
            v.literal("NO"),
            v.literal("HOLD"),
          ),
          confidence: v.number(),
          reasons: v.array(v.string()),
        }),
      ),
      // cached news validation (anti-lose gate) for this market
      news: v.optional(
        v.object({
          ts: v.number(),
          verdict: v.union(
            v.literal("YES"),
            v.literal("NO"),
            v.literal("UNCLEAR"),
          ),
          summary: v.string(),
          headlines: v.array(v.string()),
        }),
      ),
    }).index("by_gamma_id", ["gammaId"]),

    // one paper-trading account per user
    botConfigs: defineTable({
      userId: v.id("users"),
      bankroll: v.number(), // total capital the bot started with
      cash: v.number(), // available cash
      enabled: v.boolean(),
      aggression: v.number(), // 0..1 fraction of cash risked per trade
      lastTickAt: v.optional(v.number()),
      // per-user tick lock: 0 = free, timestamp = a tick is in progress
      tickRunningAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    // open / closed paper positions
    positions: defineTable({
      userId: v.id("users"),
      marketId: v.id("markets"),
      side: v.union(v.literal("YES"), v.literal("NO")),
      shares: v.number(),
      avgPrice: v.number(), // cost per share
      invested: v.number(), // shares * avgPrice
      status: v.union(v.literal("OPEN"), v.literal("CLOSED"), v.literal("SETTLED")),
      closedAt: v.optional(v.number()),
      realizedPnl: v.optional(v.number()),
      reason: v.optional(v.string()),
    }).index("by_user_status", ["userId", "status"]),

    // executed paper trades
    trades: defineTable({
      userId: v.id("users"),
      marketId: v.id("markets"),
      side: v.union(v.literal("YES"), v.literal("NO")),
      action: v.union(v.literal("BUY"), v.literal("SELL"), v.literal("SETTLE")),
      shares: v.number(),
      price: v.number(),
      usd: v.number(),
      pnl: v.optional(v.number()),
      reason: v.string(),
      createdAt: v.number(),
    }).index("by_user_time", ["userId", "createdAt"]),

    // the genius journal
    botLogs: defineTable({
      userId: v.id("users"),
      level: v.union(
        v.literal("INFO"),
        v.literal("TRADE"),
        v.literal("GENIUS"),
        v.literal("WARN"),
      ),
      message: v.string(),
      marketId: v.optional(v.id("markets")),
      createdAt: v.number(),
    }).index("by_user_time", ["userId", "createdAt"]),

    // cached price history per market (YES token)
    priceHistory: defineTable({
      marketId: v.id("markets"),
      tokenId: v.string(),
      points: v.array(v.object({ t: v.number(), p: v.number() })),
      fetchedAt: v.number(),
    }).index("by_market", ["marketId"]),

    // single-row guard for the fast 5s scan loop (see bot.ts)
    schedulerState: defineTable({
      lastScheduledAt: v.number(),
    }),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
