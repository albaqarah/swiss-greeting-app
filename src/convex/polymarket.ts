// Pure helpers for the Polymarket public APIs + the "genius" signal engine.
// No Convex imports here — this module is only ever imported by "use node"
// action files, but keeping it dependency-free keeps it testable.

const GAMMA_URL = "https://gamma-api.polymarket.com";
const CLOB_URL = "https://clob.polymarket.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawGammaMarket {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  image?: string | null;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  volume?: string;
  volume24hr?: string;
  volume24hrNum?: number;
  liquidity?: string;
  liquidityNum?: number;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
}

export interface ParsedMarket {
  gammaId: string;
  conditionId: string;
  question: string;
  slug: string;
  image: string | null;
  outcomes: string[];
  outcomePrices: number[];
  clobTokenIds: string[];
  volume: number;
  volume24hr: number;
  liquidity: number;
  startDate: number | null;
  endDate: number | null;
  active: boolean;
  closed: boolean;
}

export interface BookLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  ts: number;
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface PricePoint {
  t: number;
  p: number;
}

export type Direction = "YES" | "NO" | "HOLD";

export interface Signal {
  ts: number;
  mid: number;
  score: number;
  direction: Direction;
  confidence: number;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function tryJson(input: string | undefined, fallback: unknown): unknown {
  if (!input) return fallback;
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const toNum = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------
// Gamma API
// ---------------------------------------------------------------------------

// The bot only plays esports markets that resolve fast: between 1h and 24h
// from now. Short enough for quick turns, long enough to actually catch a 2×
// move. Tag 64 = Esports on the Gamma API (no politics, no crypto, no fluff).
export const ESPORTS_TAG_ID = 64;
export const MIN_DURATION_MS = 60 * 60 * 1000;
export const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

export function isShortHorizon(market: ParsedMarket): boolean {
  if (!market.endDate) return false;
  const remaining = market.endDate - Date.now();
  return remaining >= MIN_DURATION_MS && remaining <= MAX_DURATION_MS;
}

export async function fetchGammaMarkets(
  limit = 30,
): Promise<ParsedMarket[]> {
  try {
    const now = new Date();
    const min = now.toISOString();
    const max = new Date(now.getTime() + MAX_DURATION_MS).toISOString();
    const url =
      `${GAMMA_URL}/markets?active=true&closed=false` +
      `&tag_id=${ESPORTS_TAG_ID}` +
      `&order=volume24hr&ascending=false&limit=${limit}` +
      `&end_date_min=${encodeURIComponent(min)}` +
      `&end_date_max=${encodeURIComponent(max)}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const raw = (await res.json()) as RawGammaMarket[];
    if (!Array.isArray(raw)) return [];
    return raw
      .map(parseGammaMarket)
      .filter((m) => m !== null && isShortHorizon(m)) as ParsedMarket[];
  } catch {
    return [];
  }
}

export function parseGammaMarket(raw: RawGammaMarket): ParsedMarket | null {
  const outcomes = tryJson(raw.outcomes, []) as string[];
  const prices = (tryJson(raw.outcomePrices, []) as unknown[]).map(toNum);
  const tokenIds = tryJson(raw.clobTokenIds, []) as string[];
  if (outcomes.length !== 2 || prices.length !== 2 || tokenIds.length < 2) {
    return null; // binary markets only — that's where genius lives
  }
  const start = raw.startDate ? Date.parse(raw.startDate) : null;
  const end = raw.endDate ? Date.parse(raw.endDate) : null;
  return {
    gammaId: String(raw.id),
    conditionId: raw.conditionId,
    question: raw.question,
    slug: raw.slug,
    image: raw.image ?? null,
    outcomes,
    outcomePrices: prices.map((p) => clamp(p, 0, 1)),
    clobTokenIds: tokenIds,
    volume: toNum(raw.volume),
    volume24hr: toNum(raw.volume24hrNum ?? raw.volume24hr),
    liquidity: toNum(raw.liquidityNum ?? raw.liquidity),
    startDate: Number.isFinite(start) ? start : null,
    endDate: Number.isFinite(end) ? end : null,
    active: raw.active !== false,
    closed: raw.closed === true,
  };
}

// ---------------------------------------------------------------------------
// CLOB API
// ---------------------------------------------------------------------------

export async function fetchOrderBook(tokenId: string): Promise<OrderBook | null> {
  try {
    const res = await fetch(`${CLOB_URL}/book?token_id=${tokenId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      bids?: { price: string; size: string }[];
      asks?: { price: string; size: string }[];
    };
    const bids = (data.bids ?? [])
      .map((l) => ({ price: toNum(l.price), size: toNum(l.size) }))
      .filter((l) => l.price > 0 && l.size > 0)
      .sort((a, b) => b.price - a.price)
      .slice(0, 12);
    const asks = (data.asks ?? [])
      .map((l) => ({ price: toNum(l.price), size: toNum(l.size) }))
      .filter((l) => l.price > 0 && l.size > 0)
      .sort((a, b) => a.price - b.price)
      .slice(0, 12);
    if (bids.length === 0 && asks.length === 0) return null;
    return { ts: Date.now(), bids, asks };
  } catch {
    return null;
  }
}

export async function fetchClosedGammaMarkets(
  limit = 100,
): Promise<ParsedMarket[]> {
  try {
    const url = `${GAMMA_URL}/markets?closed=true&order=endDate&ascending=false&limit=${limit}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const raw = (await res.json()) as RawGammaMarket[];
    if (!Array.isArray(raw)) return [];
    return raw
      .map(parseGammaMarket)
      .filter((m) => m !== null) as ParsedMarket[];
  } catch {
    return [];
  }
}

export async function fetchPriceHistory(tokenId: string): Promise<PricePoint[] | null> {
  try {
    const url = `${CLOB_URL}/prices-history?market=${tokenId}&interval=1d&fidelity=60`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { history?: { t: number; p: number }[] };
    const history = data.history ?? [];
    if (history.length === 0) return null;
    return history
      .map((h) => ({ t: h.t, p: clamp(toNum(h.p), 0, 1) }))
      .filter((h) => h.p > 0);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The genius signal
// ---------------------------------------------------------------------------

export interface SignalInput {
  book: OrderBook;
  prevMid?: number;
  volume24hr?: number;
  liquidity?: number;
}

const TOP_LEVELS = 5;
const MIN_TOTAL_DEPTH = 200;
const MAX_SPREAD = 0.15;

export function computeSignal(input: SignalInput): Signal {
  const { book, prevMid, volume24hr = 0, liquidity = 0 } = input;
  const reasons: string[] = [];

  const bestBid = book.bids[0]?.price ?? 0;
  const bestAsk = book.asks[0]?.price ?? 1;
  const mid = (bestBid + bestAsk) / 2;
  const spread = Math.max(0, bestAsk - bestBid);

  if (bestBid <= 0 || bestAsk >= 1 || bestAsk <= bestBid) {
    return {
      ts: Date.now(),
      mid,
      score: 0,
      direction: "HOLD",
      confidence: 0,
      reasons: ["No two-sided book. Even genius needs a market."],
    };
  }

  const depth = (levels: BookLevel[]) =>
    levels.slice(0, TOP_LEVELS).reduce((sum, l) => sum + l.size, 0);
  const bidDepth = depth(book.bids);
  const askDepth = depth(book.asks);
  const totalDepth = bidDepth + askDepth;

  if (totalDepth < MIN_TOTAL_DEPTH) {
    reasons.push(
      `Book too thin (${Math.round(totalDepth)} shares) — nothing to trade against.`,
    );
  }

  if (spread > MAX_SPREAD) {
    reasons.push(
      `Spread ${(spread * 100).toFixed(1)}¢ is a toll booth, not a market.`,
    );
  }

  const bidShare = totalDepth > 0 ? bidDepth / totalDepth : 0.5;
  const imbalance = (bidShare - 0.5) * 2; // +1 → buyers pressing hard
  const momentum = prevMid && prevMid > 0 ? (mid - prevMid) / prevMid : 0;
  const momentumSignal = clamp(momentum / 0.06, -1, 1);

  let score = 0.6 * imbalance + 0.4 * momentumSignal;

  // Early-entry bonus: price is still cheap and momentum just started moving.
  // Get in before the crowd does — that's where the 2× trades live.
  const earlyYes = mid < 0.3 && momentum > 0.005;
  const earlyNo = mid > 0.7 && momentum < -0.005;
  if (earlyYes || earlyNo) {
    score += (earlyYes ? 1 : -1) * 0.08;
    reasons.push(
      earlyYes
        ? `Early entry: YES ${cents(mid)} with momentum building — ahead of the crowd.`
        : `Early entry: NO ${cents(1 - mid)} with momentum building — ahead of the crowd.`,
    );
  }

  const spreadPenalty = clamp((spread - 0.02) / 0.08, 0, 1);
  let confidence =
    clamp(Math.abs(score) / 0.5, 0, 1) * (1 - spreadPenalty * 0.5);

  let direction: Direction = "HOLD";
  if (score > 0.05) direction = "YES";
  else if (score < -0.05) direction = "NO";

  if (totalDepth < MIN_TOTAL_DEPTH || spread > MAX_SPREAD) {
    direction = "HOLD";
    confidence = confidence * 0.25;
  }

  if (direction === "YES") {
    reasons.push(
      `Book depth leans YES ${(bidShare * 10).toFixed(1)}:${((1 - bidShare) * 10).toFixed(1)}.`,
    );
  } else if (direction === "NO") {
    reasons.push(
      `Book depth leans NO ${((1 - bidShare) * 10).toFixed(1)}:${(bidShare * 10).toFixed(1)}.`,
    );
  } else if (totalDepth >= MIN_TOTAL_DEPTH) {
    reasons.push(
      `Book roughly balanced (${Math.round(bidShare * 100)}% bid-side).`,
    );
  }

  if (Math.abs(momentum) >= 0.005) {
    reasons.push(
      `Momentum ${momentum > 0 ? "+" : ""}${(momentum * 100).toFixed(1)}% since last scan.`,
    );
  } else {
    reasons.push("No meaningful momentum. The crowd is napping.");
  }

  if (volume24hr > 0 && liquidity > 0) {
    const attention = volume24hr / liquidity;
    reasons.push(
      attention >= 2
        ? `24h volume ${attention.toFixed(1)}× liquidity — the crowd is watching.`
        : `Quiet market (24h vol ${(volume24hr / 1000).toFixed(0)}k).`,
    );
  }

  reasons.push(
    `Spread ${(spread * 100).toFixed(1)}¢, mid ${(mid * 100).toFixed(1)}¢.`,
  );

  return {
    ts: Date.now(),
    mid,
    score,
    direction,
    confidence: clamp(confidence, 0, 0.95),
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Genius commentary
// ---------------------------------------------------------------------------

export function cents(value: number): string {
  return `${(value * 100).toFixed(1)}¢`;
}

export function buyLine(side: Direction, shares: number, price: number): string {
  const n = Math.round(shares);
  return side === "YES"
    ? `Genius move: ${n} YES @ ${cents(price)}. The book is screaming and I'm listening.`
    : `Genius move: ${n} NO @ ${cents(price)}. The crowd is wrong, as usual.`;
}

export function takeProfitLine(side: Direction, price: number, pnlPct: number): string {
  return `Profit locked: ${side} out @ ${cents(price)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%). Even my coffee is impressed.`;
}

export function stopLossLine(side: Direction, price: number, pnlPct: number): string {
  return `Discipline: cut ${side} @ ${cents(price)} (${pnlPct.toFixed(1)}%). Genius knows when to fold.`;
}

export function nearCertainLine(
  side: Direction,
  price: number,
  pnlPct: number,
): string {
  return `Near certainty: ${side} out @ ${cents(price)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%). Locking it before the crowd does.`;
}

export function settleLine(side: Direction, price: number, pnl: number): string {
  const verdict =
    pnl >= 0
      ? "Correct call, as always."
      : "The market was wrong. Obviously.";
  return `${side} settled @ ${cents(price)} — ${verdict} (${pnl >= 0 ? "+$" : "-$"}${Math.abs(pnl).toFixed(2)}).`;
}

export function holdLine(question: string, mid: number): string {
  return `Scanned "${truncate(question, 60)}" — mid ${cents(mid)}. Not worth my neurons today.`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
