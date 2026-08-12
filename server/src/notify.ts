// Telegram notifications for the control room: entry/exit alerts, the daily
// P&L report, and the morning briefing. Pure fetch — no extra dependencies.
// Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env; when either is missing
// every send is a silent no-op so the bot runs fine without it.

import type { Config } from "./config.js";

let botToken: string | null = null;
let chatId: string | null = null;

export function initTelegram(config: Config): void {
  botToken = config.telegramBotToken;
  chatId = config.telegramChatId;
}

export function telegramConfigured(): boolean {
  return !!botToken && !!chatId;
}

/** Escape text for Telegram's HTML parse mode (market titles contain &, <, >). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendTelegram(text: string): Promise<boolean> {
  if (!botToken || !chatId) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        // Never let a slow/hung Telegram hang the 5s trading loop.
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`telegram send failed (${res.status}): ${detail.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`telegram send error: ${(error as Error).message}`);
    return false;
  }
}

/** Fire-and-forget notification — never blocks the trading tick. */
export function notify(text: string): void {
  void sendTelegram(text);
}
