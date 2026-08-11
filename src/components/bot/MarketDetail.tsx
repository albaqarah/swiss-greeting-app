import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  BookLevelView,
  MarketRow,
  MicroLabel,
  VerdictBadge,
  fmtAge,
  fmtCents,
  fmtCompact,
  fmtTime,
} from "./shared";

export function MarketDetail({
  market,
  history,
  held,
}: {
  market: MarketRow | null;
  history: { t: number; p: number }[];
  held: "YES" | "NO" | null;
}) {
  if (!market) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
        <span className="size-2 bg-swiss-blue" />
        <p className="max-w-xs text-sm leading-6 text-black/60">
          Select a market to inspect its order book and the genius&apos;s reasoning.
        </p>
      </div>
    );
  }

  const signal = market.signal;
  const yes = market.outcomePrices[0] ?? 0.5;
  const book = market.book;
  const maxLevelSize = book
    ? Math.max(
        1,
        ...[...book.bids.slice(0, 6), ...book.asks.slice(0, 6)].map(
          (l) => l.size,
        ),
      )
    : 1;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="border-b border-black p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-bold leading-snug">{market.question}</p>
          {held && (
            <span
              className={cn(
                "shrink-0 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white",
                held === "YES" ? "bg-swiss-red" : "bg-swiss-blue",
              )}
            >
              Held {held}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div>
            <MicroLabel>Mid</MicroLabel>
            <p className="text-2xl font-bold tabular-nums leading-tight">
              {fmtCents(signal?.mid ?? yes)}
            </p>
          </div>
          <div>
            <MicroLabel>Updated</MicroLabel>
            <p className="text-xs font-bold tabular-nums">{fmtAge(market.updatedAt)}</p>
          </div>
          <div>
            <MicroLabel>24h Vol</MicroLabel>
            <p className="text-xs font-bold tabular-nums">
              {market.volume24hr ? `$${fmtCompact(market.volume24hr)}` : "—"}
            </p>
          </div>
          {signal && (
            <div className="ml-auto">
              <VerdictBadge direction={signal.direction} confidence={signal.confidence} />
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="border-b border-black p-4">
        <MicroLabel className="mb-2 flex items-center justify-between">
          <span>YES token — 24h price</span>
          {history.length > 0 && (
            <span className="tabular-nums">{fmtTime(history[history.length - 1].t * 1000)}</span>
          )}
        </MicroLabel>
        {history.length > 0 ? (
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={history.map((h) => ({ t: h.t * 1000, p: h.p }))}
                margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
              >
                <CartesianGrid stroke="#00000018" vertical={false} />
                <XAxis
                  dataKey="t"
                  tickFormatter={(t: number) =>
                    new Date(t).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  }
                  tick={{ fontSize: 9, fill: "#00000070" }}
                  tickLine={false}
                  axisLine={{ stroke: "#000" }}
                  minTickGap={40}
                />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fontSize: 9, fill: "#00000070" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 0,
                    border: "1px solid #000",
                    fontSize: 11,
                    fontFamily: "Helvetica, Arial, sans-serif",
                  }}
                  labelFormatter={(t: number) =>
                    new Date(t).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  }
                  formatter={(value: number) => [fmtCents(value), "Price"]}
                />
                <Area
                  type="stepAfter"
                  dataKey="p"
                  stroke="#e30613"
                  strokeWidth={1.5}
                  fill="#e30613"
                  fillOpacity={0.07}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-44 items-center justify-center">
            <p className="text-[10px] uppercase tracking-[0.2em] text-black/40">
              No price history yet — new market
            </p>
          </div>
        )}
      </div>

      {/* Order book */}
      <div className="border-b border-black p-4">
        <MicroLabel className="mb-3 flex items-center justify-between">
          <span>Order book — YES token</span>
          {book && <span className="tabular-nums">snapshot {fmtAge(book.ts)}</span>}
        </MicroLabel>
        {book && book.bids.length > 0 && book.asks.length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-swiss-blue">
                Bids
              </p>
              <div className="flex flex-col gap-1">
                {book.bids.slice(0, 6).map((level: BookLevelView, i) => (
                  <BookRow
                    key={`b${i}`}
                    level={level}
                    max={maxLevelSize}
                    tone="blue"
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-swiss-red">
                Asks
              </p>
              <div className="flex flex-col gap-1">
                {book.asks.slice(0, 6).map((level: BookLevelView, i) => (
                  <BookRow
                    key={`a${i}`}
                    level={level}
                    max={maxLevelSize}
                    tone="red"
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-[10px] uppercase tracking-[0.2em] text-black/40">
            Book not loaded for this market yet
          </p>
        )}
      </div>

      {/* Genius reasoning */}
      <div className="p-4">
        <MicroLabel className="mb-3">Genius reasoning</MicroLabel>
        {signal ? (
          <ul className="flex flex-col gap-2.5">
            {signal.reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13px] leading-5">
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0",
                    signal.direction === "YES" && "bg-swiss-red",
                    signal.direction === "NO" && "bg-swiss-blue",
                    signal.direction === "HOLD" && "bg-black",
                  )}
                />
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-[10px] uppercase tracking-[0.2em] text-black/40">
            No signal computed for this market yet
          </p>
        )}
      </div>
    </div>
  );
}

function BookRow({
  level,
  max,
  tone,
}: {
  level: BookLevelView;
  max: number;
  tone: "blue" | "red";
}) {
  const width = Math.max(6, (level.size / max) * 100);
  return (
    <div className="relative flex items-center justify-between gap-2 overflow-hidden border border-black/15 px-2 py-1.5">
      <div
        className={cn(
          "absolute inset-y-0 left-0",
          tone === "blue" ? "bg-swiss-blue/10" : "bg-swiss-red/10",
        )}
        style={{ width: `${width}%` }}
      />
      <span className="relative text-[12px] font-bold tabular-nums">
        {fmtCents(level.price)}
      </span>
      <span className="relative text-[11px] tabular-nums text-black/60">
        {fmtCompact(level.size)}
      </span>
    </div>
  );
}
