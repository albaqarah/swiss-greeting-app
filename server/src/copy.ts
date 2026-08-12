// COPY TRADE — mirror the BUY trades of a wallet you set in .env
// (COPY_TRADE_WALLET, the 0x… address on their Polymarket profile page).
//
// How it works:
//   - Every COPY_SCAN_INTERVAL_MS we ask the Polymarket Data API for the
//     wallet's recent trades and pick up new BUYs (timestamp > last seen).
//   - Each new BUY is mirrored into the SAME paper/live account the bot uses:
//     same market, same outcome, sized by the trade's USD value capped at
//     COPY_MAX_ORDER_USD (dry: virtual cash; live: the real bridge, which is
//     still unwired by default).
//   - Exits stay under the bot's own rules (2× TP / 25% SL / near-certain) —
//     the genius decides when to sell, the wallet only tells it where to buy.
//   - One position per market+outcome; the wallet adding to a position is
//     ignored (no averaging in).

import type { DatabaseSync } from "node:sqlite";
import { botMode, type Config } from "./config.js";
import { bumpDaily } from "./daily.js";
import {
  clampPrice,
  getConfig,
  getMeta,
  insertLog,
  insertPosition,
  insertTrade,
  marketByConditionId,
  marketById,
  openPositions,
  setMeta,
  updateConfig,
  upsertMarket,
  type Market,
  type NewMarket,
} from "./db.js";
import { assertLiveReady, placeLiveOrder } from "./live.js";
import { escapeHtml, notify } from "./notify.js";
import {
  fetchGammaMarketsByConditionIds,
  truncate,
  type ParsedMarket,
} from "./polymarket.js";

const DATA_API = "https://data-api.polymarket.com";

interface WalletTrade {
  proxyWallet: string;
  side: "BUY" | "SELL";
  conditionId: string;
  size: number;
  price: number;
  timestamp: number; // epoch seconds
  title: string;
  slug: string;
  outcome: string;
  outcomeIndex: number;
  transactionHash: string;
}

export interface CopyTickResult {
  checked: boolean;
  copied: number;
  skipped: number;
}

function shortWallet(wallet: string): string {
  return wallet.length > 10 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

export async function copyTradeTick(
  db: DatabaseSync,
  config: Config,
): Promise<CopyTickResult> {
  const wallet = config.copyTradeWallet;
  if (!wallet) return { checked: false, copied: 0, skipped: 0 };

  const botConfig = getConfig(db);
  if (!botConfig || !botConfig.enabled) {
    return { checked: false, copied: 0, skipped: 0 };
  }

  // Live mode must be ready before any real order — same guard as the engine.
  if (botMode() === "live") {
    const ready = assertLiveReady();
    if (!ready.ok) {
      insertLog(db, "WARN", `Copy trade: ${ready.reason}. No copy entries in live mode.`);
      return { checked: false, copied: 0, skipped: 0 };
    }
  }

  // Throttle scans — the Data API has rate limits, 5s polling is overkill.
  const lastScan = Number(getMeta(db, "copy_last_scan_at") ?? 0);
  if (Date.now() - lastScan < config.copyScanIntervalMs) {
    return { checked: false, copied: 0, skipped: 0 };
  }
  setMeta(db, "copy_last_scan_at", String(Date.now()));

  let trades: WalletTrade[] = [];
  try {
    const url = `${DATA_API}/trades?user=${encodeURIComponent(wallet)}&limit=50&takerOnly=false`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      insertLog(db, "WARN", `Copy trade: data-api responded ${res.status} — will retry next window.`);
      return { checked: true, copied: 0, skipped: 0 };
    }
    const raw = (await res.json()) as WalletTrade[];
    if (!Array.isArray(raw)) return { checked: true, copied: 0, skipped: 0 };
    trades = raw;
  } catch (error) {
    insertLog(db, "WARN", `Copy trade: fetch failed — ${(error as Error).message}`);
    return { checked: true, copied: 0, skipped: 0 };
  }

  let newest = 0;
  for (const t of trades) newest = Math.max(newest, t.timestamp);

  // First run: record the newest trade and start following from here. No
  // backfilling a wall of historical trades.
  const lastSeen = Number(getMeta(db, "copy_last_seen_ts") ?? 0);
  if (lastSeen === 0) {
    setMeta(db, "copy_last_seen_ts", String(newest || Math.floor(Date.now() / 1000)));
    insertLog(
      db,
      "INFO",
      `Copy trade: now watching ${shortWallet(wallet)}. First scan — catching up from now on.`,
    );
    return { checked: true, copied: 0, skipped: 0 };
  }

  // Oldest first so entries are mirrored in the order the wallet made them.
  const buys = trades
    .filter((t) => t.side === "BUY" && t.timestamp > lastSeen)
    .sort((a, b) => a.timestamp - b.timestamp);

  let copied = 0;
  let skipped = 0;
  let cash = botConfig.cash;
  const open = openPositions(db);
  const held = new Set(open.map((p) => `${p.marketId}:${p.side}`));

  for (const trade of buys) {
    try {
      // 1) Resolve the market — our DB first, then Gamma by condition id.
      let market = marketByConditionId(db, trade.conditionId);
      if (!market) {
        const parsed = (await fetchGammaMarketsByConditionIds(trade.conditionId))[0];
        if (!parsed || parsed.closed || !parsed.active) {
          skipped += 1;
          continue;
        }
        const id = upsertMarket(db, toNewMarket(parsed), Date.now());
        market = marketById(db, id);
      }
      if (!market) {
        skipped += 1;
        continue;
      }

      // 2) Only tradeable binary markets.
      const side = outcomeToSide(market, trade);
      if (!side) {
        skipped += 1;
        continue;
      }
      if (market.closed || !market.active) {
        skipped += 1;
        continue;
      }

      // 3) Size the mirror: wallet's own USD value, capped + floored.
      const tradeUsd = trade.size * trade.price;
      if (tradeUsd < config.copyMinTradeUsd) {
        skipped += 1;
        continue;
      }
      const price = clampPrice(trade.price);
      const budget = Math.min(tradeUsd, config.copyMaxOrderUsd);
      const shares = Math.floor(budget / price);
      const cost = shares * price;
      if (shares < 1) {
        skipped += 1;
        continue;
      }

      // 4) Guards: cash, max open, one position per market+outcome.
      if (cost > cash) {
        skipped += 1;
        insertLog(db, "INFO", `Copy: not enough cash for "${truncate(trade.title, 50)}" — skipped.`);
        continue;
      }
      if (open.length + copied >= config.copyMaxOpen) {
        skipped += 1;
        insertLog(db, "INFO", `Copy: max open positions (${config.copyMaxOpen}) reached — pausing.`);
        break;
      }
      if (held.has(`${market.id}:${side}`)) {
        skipped += 1;
        continue;
      }

      // 5) Live seam — same behavior as the engine's own entries.
      if (botMode() === "live") {
        const tokenId = market.clobTokenIds[side === "YES" ? 0 : 1];
        try {
          await placeLiveOrder({ market, side, price, shares, budget: cost, tokenId });
        } catch (error) {
          insertLog(
            db,
            "WARN",
            `Copy live entry failed for "${truncate(trade.title, 50)}": ${(error as Error).message}`,
            market.id,
          );
          continue;
        }
      }

      cash -= cost;
      insertPosition(db, {
        marketId: market.id,
        side,
        shares,
        avgPrice: price,
        invested: cost,
        reason: `copy: ${shortWallet(wallet)}`,
      });
      insertTrade(db, {
        marketId: market.id,
        side,
        action: "BUY",
        shares,
        price,
        usd: cost,
        reason: `copy trade (${trade.transactionHash.slice(0, 10)}…)`,
      });
      insertLog(
        db,
        "GENIUS",
        `Copy: ${side} ${Math.round(shares)} @ ${(price * 100).toFixed(1)}¢ on "${truncate(market.question, 50)}"`,
        market.id,
      );
      bumpDaily(db, { entries: 1, copy_entries: 1 });
      notify(
        `🔄 <b>COPY ENTRY</b>\n<b>${side}</b> ${Math.round(shares)} shares @ ${(price * 100).toFixed(1)}¢\n${escapeHtml(truncate(market.question, 120))}\n💵 $${cost.toFixed(2)} · 👤 ${shortWallet(wallet)}`,
      );
      copied += 1;
    } catch (error) {
      console.error("copy trade entry error:", error);
    }
  }

  updateConfig(db, { cash, lastTickAt: Date.now() });
  if (newest > lastSeen) setMeta(db, "copy_last_seen_ts", String(newest));
  if (copied > 0) {
    insertLog(
      db,
      "INFO",
      `Copy trade: ${copied} new entr${copied > 1 ? "ies" : "y"} mirrored${skipped > 0 ? `, ${skipped} skipped` : ""}.`,
    );
  }
  return { checked: true, copied, skipped };
}

function outcomeToSide(market: Market, trade: WalletTrade): "YES" | "NO" | null {
  if (trade.outcomeIndex === 0) return "YES";
  if (trade.outcomeIndex === 1) return "NO";
  const idx = market.outcomes.findIndex(
    (o) => o.toLowerCase() === String(trade.outcome).toLowerCase(),
  );
  if (idx === 0) return "YES";
  if (idx === 1) return "NO";
  return null;
}

function toNewMarket(parsed: ParsedMarket): NewMarket {
  return {
    gammaId: parsed.gammaId,
    conditionId: parsed.conditionId,
    question: parsed.question,
    slug: parsed.slug,
    image: parsed.image,
    outcomes: parsed.outcomes,
    outcomePrices: parsed.outcomePrices,
    clobTokenIds: parsed.clobTokenIds,
    volume: parsed.volume,
    volume24hr: parsed.volume24hr,
    liquidity: parsed.liquidity,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    active: parsed.active,
    closed: parsed.closed,
  };
}
