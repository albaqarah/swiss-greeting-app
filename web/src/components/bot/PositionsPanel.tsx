import { cn } from "@/lib/utils";
import { EmptyState, fmtCents, fmtMoney } from "./shared";

export interface PositionView {
  _id: string;
  marketId: string;
  question: string;
  slug: string;
  image: string | null;
  outcomes: string[];
  side: "YES" | "NO";
  shares: number;
  avgPrice: number;
  invested: number;
  valuePrice: number;
  unrealizedPnl: number;
  status: "OPEN" | "CLOSED" | "SETTLED";
  reason: string | null;
  closedAt: number | null;
}

export function PositionsPanel({
  positions,
  loading,
}: {
  positions: PositionView[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 px-6 py-12">
        <span className="size-2 animate-pulse bg-swiss-blue" />
        <span className="text-[10px] uppercase tracking-[0.2em] text-black/50">
          Loading positions…
        </span>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <EmptyState text="No open positions. The bot is waiting for a signal it can trust — patience is also genius." />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-left">
        <thead>
          <tr className="border-b border-black text-[10px] uppercase tracking-[0.2em] text-black/50">
            <th className="px-4 py-2.5 font-medium">Market</th>
            <th className="px-4 py-2.5 font-medium">Side</th>
            <th className="px-4 py-2.5 text-right font-medium">Shares</th>
            <th className="px-4 py-2.5 text-right font-medium">Avg</th>
            <th className="px-4 py-2.5 text-right font-medium">Now</th>
            <th className="px-4 py-2.5 text-right font-medium">Unrealized P&L</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const pnl = p.unrealizedPnl;
            return (
              <tr
                key={p._id}
                className="border-b border-black/15 last:border-b-0"
              >
                <td className="max-w-[280px] px-4 py-3">
                  <p className="truncate text-[13px] font-bold leading-snug">
                    {p.question}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-black/40">
                    {p.reason}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "inline-block px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white",
                      p.side === "YES" ? "bg-swiss-red" : "bg-swiss-blue",
                    )}
                  >
                    {p.side}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {Math.round(p.shares).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {fmtCents(p.avgPrice)}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {fmtCents(p.valuePrice)}
                </td>
                <td
                  className={cn(
                    "px-4 py-3 text-right text-sm font-bold tabular-nums",
                    pnl > 0.004 && "text-swiss-blue",
                    pnl < -0.004 && "text-swiss-red",
                  )}
                >
                  {pnl > 0.004 ? "+" : ""}
                  {fmtMoney(pnl)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
