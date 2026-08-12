// Runs the bot tick single-flight: the 5s loop, the "run genius now" button
// and a manual refresh can all fire at once — this keeps them from
// double-entering or double-exiting the same account.

import type { DatabaseSync } from "node:sqlite";
import { refreshMarketData, runUserTick } from "./engine.js";

let busy = false;

export interface TickResult {
  fetched: number;
  books: number;
  ran: boolean;
  reason?: string;
}

export async function runBotTick(
  db: DatabaseSync,
  options: { refresh?: boolean } = {},
): Promise<TickResult> {
  if (busy) return { fetched: 0, books: 0, ran: false, reason: "tick in progress" };
  busy = true;
  try {
    let fetched = 0;
    let books = 0;
    if (options.refresh !== false) {
      try {
        const result = await refreshMarketData(db);
        fetched = result.fetched;
        books = result.books;
      } catch (error) {
        // Fall back to the last cached market data rather than aborting.
        console.error("market refresh failed, using cache", error);
      }
    }
    const ran = await runUserTick(db);
    return { fetched, books, ran };
  } finally {
    busy = false;
  }
}

export function isTickBusy(): boolean {
  return busy;
}
