import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type Direction = "YES" | "NO" | "HOLD";

export interface SignalView {
  ts: number;
  mid: number;
  score: number;
  direction: Direction;
  confidence: number;
  reasons: string[];
}

export interface BookLevelView {
  price: number;
  size: number;
}

export interface BookView {
  ts: number;
  bids: BookLevelView[];
  asks: BookLevelView[];
}

export interface MarketRow {
  _id: string;
  question: string;
  slug: string;
  image: string | null | undefined;
  outcomes: string[];
  outcomePrices: number[];
  volume24hr?: number;
  liquidity?: number;
  endDate?: number;
  active: boolean;
  closed: boolean;
  book?: BookView | null | undefined;
  signal?: SignalView | null | undefined;
  updatedAt: number;
  history?: { t: number; p: number }[];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtMoney(value: number, digits = 2): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function fmtCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

export function fmtCents(value: number): string {
  return `${(value * 100).toFixed(1)}¢`;
}

export function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function fmtRemaining(ts: number): string {
  const minutes = Math.max(0, Math.floor((ts - Date.now()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

export function fmtAge(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function MicroLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[10px] uppercase tracking-[0.2em] text-black/50",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function PnlText({ value, className }: { value: number; className?: string }) {
  const positive = value > 0.004;
  const negative = value < -0.004;
  return (
    <span
      className={cn(
        "font-bold tabular-nums",
        positive && "text-swiss-blue",
        negative && "text-swiss-red",
        !positive && !negative && "text-black",
        className,
      )}
    >
      {positive ? "+" : ""}
      {fmtMoney(value)}
    </span>
  );
}

export function VerdictBadge({
  direction,
  confidence,
}: {
  direction: Direction | null;
  confidence?: number;
}) {
  const conf = confidence ?? 0;
  if (!direction || direction === "HOLD") {
    return (
      <span className="inline-flex items-center gap-1.5 border border-black/40 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-black/60">
        Hold
        {conf > 0 && (
          <span className="tabular-nums">{(conf * 100).toFixed(0)}%</span>
        )}
      </span>
    );
  }
  const isYes = direction === "YES";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white",
        isYes ? "bg-swiss-red" : "bg-swiss-blue",
      )}
    >
      Buy {direction}
      <span className="opacity-80 tabular-nums">
        {(conf * 100).toFixed(0)}%
      </span>
    </span>
  );
}

export function ConfidenceBar({
  direction,
  confidence,
  className,
}: {
  direction: Direction | null;
  confidence: number;
  className?: string;
}) {
  const fill =
    direction === "YES"
      ? "bg-swiss-red"
      : direction === "NO"
        ? "bg-swiss-blue"
        : "bg-black";
  return (
    <div className={cn("h-1 w-full border border-black/30", className)}>
      <div
        className={cn("h-full", fill)}
        style={{ width: `${Math.min(100, Math.max(0, confidence * 100))}%` }}
      />
    </div>
  );
}

export function SectionShell({
  no,
  title,
  right,
  children,
  className,
}: {
  no: string;
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border border-black", className)}>
      <div className="flex items-center justify-between gap-4 border-b border-black px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] uppercase tracking-[0.2em] text-black/40">
            {no}
          </span>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em]">
            {title}
          </h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="size-2 bg-swiss-red" />
      <p className="max-w-sm text-sm leading-6 text-black/60">{text}</p>
    </div>
  );
}
