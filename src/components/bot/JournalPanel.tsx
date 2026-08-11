import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  EmptyState,
  fmtCents,
  fmtMoney,
  fmtTime,
} from "./shared";

export interface TradeView {
  _id: string;
  action: "BUY" | "SELL" | "SETTLE";
  side: "YES" | "NO";
  shares: number;
  price: number;
  usd: number;
  pnl: number | null;
  reason: string;
  createdAt: number;
  question: string;
}

export interface LogView {
  _id: string;
  level: "INFO" | "TRADE" | "GENIUS" | "WARN";
  message: string;
  createdAt: number;
  question: string | null;
}

function LevelChip({ level }: { level: LogView["level"] }) {
  const styles: Record<LogView["level"], string> = {
    GENIUS: "bg-swiss-red text-white",
    TRADE: "bg-swiss-blue text-white",
    INFO: "bg-black text-white",
    WARN: "border border-black text-black",
  };
  return (
    <span
      className={cn(
        "inline-block shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em]",
        styles[level],
      )}
    >
      {level}
    </span>
  );
}

export function JournalPanel({
  trades,
  logs,
  loading,
}: {
  trades: TradeView[];
  logs: LogView[];
  loading: boolean;
}) {
  const [tab, setTab] = useState<"trades" | "log">("log");

  return (
    <div className="flex flex-col">
      <div className="flex border-b border-black">
        <button
          type="button"
          onClick={() => setTab("log")}
          className={cn(
            "flex-1 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors",
            tab === "log"
              ? "bg-black text-white"
              : "text-black/60 hover:bg-black/[0.04]",
          )}
        >
          Genius log
        </button>
        <button
          type="button"
          onClick={() => setTab("trades")}
          className={cn(
            "flex-1 border-l border-black px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors",
            tab === "trades"
              ? "bg-black text-white"
              : "text-black/60 hover:bg-black/[0.04]",
          )}
        >
          Trades ({trades.length})
        </button>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-3 px-6 py-12">
            <span className="size-2 animate-pulse bg-swiss-red" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-black/50">
              Loading…
            </span>
          </div>
        ) : tab === "log" ? (
          logs.length === 0 ? (
            <EmptyState text="The journal is empty. Arm the bot and the genius will start narrating." />
          ) : (
            <ul className="flex flex-col divide-y divide-black/10">
              {logs.map((log) => (
                <li key={log._id} className="flex items-start gap-3 px-4 py-3">
                  <LevelChip level={log.level} />
                  <div className="min-w-0">
                    <p className="text-[13px] leading-5">{log.message}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-black/40">
                      {fmtTime(log.createdAt)}
                      {log.question ? ` · ${log.question}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : trades.length === 0 ? (
          <EmptyState text="No trades executed yet. The genius is still deciding who's wrong." />
        ) : (
          <ul className="flex flex-col divide-y divide-black/10">
            {trades.map((trade) => (
              <li key={trade._id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={cn(
                    "inline-block shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-white",
                    trade.action === "BUY"
                      ? "bg-black"
                      : trade.action === "SELL"
                        ? "bg-swiss-blue"
                        : "bg-swiss-red",
                  )}
                >
                  {trade.action} {trade.side}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] leading-5">
                    {trade.question}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-black/40">
                    {Math.round(trade.shares).toLocaleString()} shares @{" "}
                    {fmtCents(trade.price)} · {fmtMoney(trade.usd)} ·{" "}
                    {fmtTime(trade.createdAt)}
                  </p>
                </div>
                {trade.pnl !== null && (
                  <span
                    className={cn(
                      "shrink-0 text-sm font-bold tabular-nums",
                      trade.pnl > 0.004 && "text-swiss-blue",
                      trade.pnl < -0.004 && "text-swiss-red",
                    )}
                  >
                    {trade.pnl > 0.004 ? "+" : ""}
                    {fmtMoney(trade.pnl)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
