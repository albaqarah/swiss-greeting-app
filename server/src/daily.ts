// Daily P&L tracking + the daily report and morning briefing.
//
// The "day" runs from REPORT_HOUR (default 07:00) to REPORT_HOUR + 24h, in
// REPORT_TIMEZONE (default Asia/Jakarta). Every entry/exit bumps counters in
// the current period's row (daily_stats); when the clock crosses REPORT_HOUR
// the bot sends the finished period's P&L report + a morning briefing over
// Telegram, then resets the counters for the fresh 24h.

import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.js";
import { botMode } from "./config.js";
import {
  allMarkets,
  bumpDailyStat,
  deleteDailyStats,
  getConfig,
  getDailyStats,
  getMeta,
  marketMid,
  openPositions,
  setMeta,
  type DailyStats,
} from "./db.js";
import { escapeHtml, sendTelegram, telegramConfigured } from "./notify.js";

let tz = "Asia/Jakarta";
let reportHour = 7;
let fmt: Intl.DateTimeFormat;

export function initDaily(config: Config): void {
  tz = config.reportTimezone;
  reportHour = config.reportHour;
  fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function localParts(ts: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
} {
  const parts = fmt.formatToParts(new Date(ts));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function shiftDay(p: { year: number; month: number; day: number }, delta: number) {
  const dt = new Date(Date.UTC(p.year, p.month - 1, p.day));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/** Label of the 7AM-anchored period that contains `now` (e.g. "2026-08-12"). */
export function dailyPeriodKey(now: number): string {
  const p = localParts(now);
  const d = p.hour < reportHour ? shiftDay(p, -1) : p;
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** Bump the counters of the period currently in progress. */
export function bumpDaily(
  db: DatabaseSync,
  patch: Parameters<typeof bumpDailyStat>[2],
): void {
  bumpDailyStat(db, dailyPeriodKey(Date.now()), patch);
}

// ---------------------------------------------------------------------------
// 07:00 report + briefing
// ---------------------------------------------------------------------------

let reporting = false;

/**
 * Fires the daily P&L report + morning briefing once the local clock passes
 * REPORT_HOUR. Safe to call every tick — the meta guard + in-flight flag
 * prevent double-firing.
 */
export async function maybeDailyReport(db: DatabaseSync): Promise<boolean> {
  if (reporting) return false;
  const now = Date.now();
  const parts = localParts(now);
  const currentPeriod = dailyPeriodKey(now);
  const lastReported = getMeta(db, "last_daily_report_period");
  if (parts.hour < reportHour || lastReported === currentPeriod) return false;

  reporting = true;
  try {
    const endedPeriod = dailyPeriodKey(now - 24 * 60 * 60 * 1000);
    const stats = getDailyStats(db, endedPeriod);
    await sendDailyReport(endedPeriod, stats);
    await sendMorningBriefing(db);
    // Reset the counters for the fresh 24h period.
    if (stats) deleteDailyStats(db, endedPeriod);
    setMeta(db, "last_daily_report_period", currentPeriod);
    return true;
  } finally {
    reporting = false;
  }
}

function emptyStats(day: string): DailyStats {
  return {
    day,
    entries: 0,
    copy_entries: 0,
    tp: 0,
    sl: 0,
    near_certain: 0,
    settled: 0,
    closed_other: 0,
    pnl: 0,
    wins: 0,
    losses: 0,
    win_usd: 0,
    loss_usd: 0,
  };
}

async function sendDailyReport(
  period: string,
  stats: DailyStats | null,
): Promise<void> {
  if (!telegramConfigured()) return;
  const s = stats ?? emptyStats(period);
  const closed = s.tp + s.sl + s.near_certain + s.settled + s.closed_other;
  const winRate = closed > 0 ? (s.wins / closed) * 100 : 0;
  const net = s.pnl;

  await sendTelegram(
    `📊 <b>DAILY P&L — ${escapeHtml(period)}</b>\n` +
      `⏰ Period: ${pad(reportHour)}:00 → ${pad(reportHour)}:00 (${escapeHtml(tz)})\n` +
      `━━━━━━━━━━━━━━\n` +
      `📥 Entries: <b>${s.entries}</b>${s.copy_entries > 0 ? ` (copy: ${s.copy_entries})` : ""}\n` +
      `🎯 Take profit: ${s.tp} · 🛑 Stop loss: ${s.sl}\n` +
      `💵 Near-certain: ${s.near_certain} · ✅ Settled: ${s.settled}\n` +
      `✋ Other closes: ${s.closed_other}\n` +
      `🏆 Win rate: ${winRate.toFixed(0)}% (${s.wins}/${closed})\n` +
      `━━━━━━━━━━━━━━\n` +
      `💚 Wins: +$${s.win_usd.toFixed(2)} · 🔻 Losses: -$${Math.abs(s.loss_usd).toFixed(2)}\n` +
      `📈 <b>NET P&L: ${net >= 0 ? "+" : "-"}$${Math.abs(net).toFixed(2)}</b>`,
  );
}

async function sendMorningBriefing(db: DatabaseSync): Promise<void> {
  if (!telegramConfigured()) return;
  const config = getConfig(db);
  const positions = openPositions(db);
  const markets = allMarkets(db);
  const marketByIdMap = new Map(markets.map((m) => [m.id, m]));

  let positionValue = 0;
  let unrealized = 0;
  for (const p of positions) {
    const market = marketByIdMap.get(p.marketId);
    if (!market) continue;
    const yesMid = marketMid(market);
    const valuePrice = p.side === "YES" ? yesMid : 1 - yesMid;
    positionValue += p.shares * valuePrice;
    unrealized += p.shares * (valuePrice - p.avgPrice);
  }
  const equity = (config?.cash ?? 0) + positionValue;
  const mode = botMode();

  const watch = markets
    .filter((m) => m.active && !m.closed)
    .sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0))
    .slice(0, 3)
    .map(
      (m) =>
        `• ${escapeHtml(truncateQuestion(m.question, 60))} — ${(marketMid(m) * 100).toFixed(1)}¢`,
    )
    .join("\n");

  await sendTelegram(
    `☀️ <b>MORNING BRIEFING</b>\n` +
      `━━━━━━━━━━━━━━\n` +
      `🤖 Mode: <b>${mode === "live" ? "LIVE · REAL MONEY" : "DRY RUN · PAPER"}</b>\n` +
      `⚡ Bot: ${config?.enabled ? "ARMED" : "PAUSED"}\n` +
      `💼 Equity: $${equity.toFixed(2)} (cash $${(config?.cash ?? 0).toFixed(2)})\n` +
      `📌 Open positions: ${positions.length} · Unrealized: ${unrealized >= 0 ? "+" : "-"}$${Math.abs(unrealized).toFixed(2)}\n` +
      `━━━━━━━━━━━━━━\n` +
      `🎮 Today's esports watch:\n${watch || "• (no live esports markets right now)"}`,
  );
}

function truncateQuestion(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
