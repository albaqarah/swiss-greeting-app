import { cn } from "@/lib/utils";
import {
  ConfidenceBar,
  EmptyState,
  MarketRow,
  VerdictBadge,
  fmtAge,
  fmtCents,
  fmtCompact,
  fmtPct,
  fmtRemaining,
} from "./shared";

export function MarketsTable({
  markets,
  selectedId,
  onSelect,
  loading,
}: {
  markets: MarketRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 px-6 py-16">
        <span className="size-2 animate-pulse bg-swiss-red" />
        <span className="text-[10px] uppercase tracking-[0.2em] text-black/50">
          Scanning markets…
        </span>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <EmptyState text="No market data yet. Run a refresh or wait for the bot's first scan — the order books will appear here." />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-left">
        <thead>
          <tr className="border-b border-black text-[10px] uppercase tracking-[0.2em] text-black/50">
            <th className="px-4 py-2.5 font-medium">№</th>
            <th className="px-4 py-2.5 font-medium">Market</th>
            <th className="px-4 py-2.5 text-right font-medium">YES</th>
            <th className="px-4 py-2.5 text-right font-medium">NO</th>
            <th className="px-4 py-2.5 text-right font-medium">24h Vol</th>
            <th className="px-4 py-2.5 text-right font-medium">Liquidity</th>
            <th className="px-4 py-2.5 font-medium">Genius verdict</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market, i) => {
            const yes = market.outcomePrices[0] ?? 0.5;
            const no = market.outcomePrices[1] ?? 1 - yes;
            const selected = market._id === selectedId;
            return (
              <tr
                key={market._id}
                onClick={() => onSelect(market._id)}
                className={cn(
                  "cursor-pointer border-b border-black/15 transition-colors last:border-b-0",
                  selected
                    ? "bg-black/[0.04]"
                    : "hover:bg-black/[0.03]",
                )}
              >
                <td className="px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-black/40">
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td className="max-w-[340px] px-4 py-3">
                  <div className="flex items-center gap-3">
                    {market.image ? (
                      <img
                        src={market.image}
                        alt=""
                        className="hidden size-8 shrink-0 border border-black/20 object-cover sm:block"
                      />
                    ) : (
                      <span className="hidden size-8 shrink-0 border border-black/20 sm:block" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold leading-snug">
                        {market.question}
                      </p>
                      <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-black/40">
                        {market.closed
                          ? "Resolved"
                          : market.endDate
                            ? `Resolves in ${fmtRemaining(market.endDate)}`
                            : "Open"}{" "}
                        · {fmtAge(market.updatedAt)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm font-bold tabular-nums text-swiss-red">
                    {fmtCents(yes)}
                  </span>
                  <span className="ml-1 text-[10px] text-black/40">
                    {fmtPct(yes)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm font-bold tabular-nums text-swiss-blue">
                    {fmtCents(no)}
                  </span>
                  <span className="ml-1 text-[10px] text-black/40">
                    {fmtPct(no)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {market.volume24hr ? fmtCompact(market.volume24hr) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  {market.liquidity ? fmtCompact(market.liquidity) : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <VerdictBadge
                      direction={market.signal?.direction ?? null}
                      confidence={market.signal?.confidence}
                    />
                    {market.signal && (
                      <ConfidenceBar
                        direction={market.signal.direction}
                        confidence={market.signal.confidence}
                        className="w-10"
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
