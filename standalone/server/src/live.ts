// REAL-MONEY EXECUTION BRIDGE.
//
// The standalone bot ships in DRY mode only: it paper-trades a virtual $1,000
// and never touches a real wallet. This file is the seam where real Polymarket
// orders would be placed when BOT_MODE=live — and it is deliberately NOT wired
// yet. The engine calls placeLiveOrder/closeLivePosition only when BOT_MODE=live
// and every credential is present; until this bridge is implemented they throw,
// so the bot logs the refusal and stays safely on paper trading.
//
// To wire real execution (recommended only after a good dry run):
//   1. npm install @polymarket/client   (official new Polymarket SDK)
//   2. Replace the bodies of placeLiveOrder / closeLivePosition with the SDK's
//      order placement calls. The engine already handles caps & accounting.
//   3. Test with POLY_MAX_ORDER_USD=1 and a funded test wallet.

import type { Market, Position } from "./db.js";

export interface LiveEnv {
  apiKey: string | null;
  apiSecret: string | null;
  apiPassphrase: string | null;
  walletAddress: string | null;
  privateKey: string | null;
  maxOrderUsd: number;
}

export function readLiveEnv(): LiveEnv {
  return {
    apiKey: process.env.POLY_API_KEY || null,
    apiSecret: process.env.POLY_API_SECRET || null,
    apiPassphrase: process.env.POLY_API_PASSPHRASE || null,
    walletAddress: process.env.POLY_WALLET_ADDRESS || null,
    privateKey: process.env.POLY_PRIVATE_KEY || null,
    maxOrderUsd: Number(process.env.POLY_MAX_ORDER_USD ?? 10),
  };
}

/** Returns { ok: true } when live execution can go, else the missing piece. */
export function assertLiveReady(): { ok: boolean; reason: string } {
  const env = readLiveEnv();
  const missing: string[] = [];
  if (!env.apiKey) missing.push("POLY_API_KEY");
  if (!env.apiSecret) missing.push("POLY_API_SECRET");
  if (!env.apiPassphrase) missing.push("POLY_API_PASSPHRASE");
  if (!env.walletAddress) missing.push("POLY_WALLET_ADDRESS");
  if (!env.privateKey) missing.push("POLY_PRIVATE_KEY");
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `missing ${missing.join(", ")} in .env`,
    };
  }
  return { ok: true, reason: "" };
}

export interface LiveOrderInput {
  market: Market;
  side: "YES" | "NO";
  price: number;
  shares: number;
  budget: number; // expected USD cost (shares × price)
  tokenId: string;
}

export async function placeLiveOrder(input: LiveOrderInput): Promise<never> {
  const env = readLiveEnv();
  void env;
  void input;
  throw new Error(
    "LIVE execution is not wired yet. Run the bot in dry mode first; when you're " +
      "ready for real money, wire this bridge with the official @polymarket/client " +
      "SDK (see live.ts header) — never flip BOT_MODE=live until it is.",
  );
}

export interface LiveCloseInput {
  market: Market;
  position: Position;
  reason: string;
}

export async function closeLivePosition(input: LiveCloseInput): Promise<never> {
  const env = readLiveEnv();
  void env;
  void input;
  throw new Error(
    "LIVE execution is not wired yet (closeLivePosition). Run dry mode until it is.",
  );
}
