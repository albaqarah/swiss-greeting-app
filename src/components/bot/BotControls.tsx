import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw, RotateCcw, Zap } from "lucide-react";
import { MicroLabel } from "./shared";

export function BotControls({
  enabled,
  aggression,
  busy,
  dataAge,
  onToggle,
  onAggression,
  onRunTick,
  onRefresh,
  onReset,
}: {
  enabled: boolean;
  aggression: number;
  busy: boolean;
  dataAge: number | null;
  onToggle: (enabled: boolean) => void;
  onAggression: (value: number) => void;
  onRunTick: () => void;
  onRefresh: () => void;
  onReset: () => void;
}) {
  return (
    <section className="grid grid-cols-1 border border-black md:grid-cols-12">
      {/* Power */}
      <div className="flex items-center gap-4 border-b border-black p-4 md:col-span-3 md:border-b-0 md:border-r">
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label="Bot on/off"
          className="rounded-none data-[state=checked]:bg-swiss-red [&_[data-slot=switch-thumb]]:rounded-none"
        />
        <div>
          <MicroLabel>Bot status</MicroLabel>
          <p
            className={cn(
              "mt-0.5 text-sm font-bold uppercase tracking-[0.15em]",
              enabled ? "text-swiss-red" : "text-black/50",
            )}
          >
            {enabled ? (
              <span className="inline-flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping bg-swiss-red opacity-60" />
                  <span className="relative inline-flex size-2 bg-swiss-red" />
                </span>
                Armed
              </span>
            ) : (
              "Paused"
            )}
          </p>
        </div>
      </div>

      {/* Aggression */}
      <div className="border-b border-black p-4 md:col-span-4 md:border-b-0 md:border-r">
        <div className="flex items-baseline justify-between">
          <MicroLabel>Aggression</MicroLabel>
          <span className="text-sm font-bold tabular-nums">
            {Math.round(aggression * 100)}%
          </span>
        </div>
        <Slider
          value={[aggression * 100]}
          min={5}
          max={50}
          step={5}
          onValueChange={([v]) => onAggression((v ?? 25) / 100)}
          disabled={busy}
          className="mt-3 [&_[data-slot=slider-track]]:rounded-none [&_[data-slot=slider-track]]:bg-black/10 [&_[data-slot=slider-range]]:bg-black [&_[data-slot=slider-thumb]]:rounded-none [&_[data-slot=slider-thumb]]:border-black"
          aria-label="Aggression"
        />
        <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-black/40">
          % of cash risked per trade · 2× TP / 25% SL · entry ≤ 5¢ · esports only · max 5 positions
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 p-4 md:col-span-5">
        <button
          type="button"
          onClick={onRunTick}
          disabled={busy}
          className="inline-flex items-center gap-2 bg-black px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white transition-colors hover:bg-swiss-red disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Zap className="size-3.5" />
          )}
          Run genius now
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          className="inline-flex items-center gap-2 border border-black px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition-colors hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className="size-3.5" />
          Refresh data
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          className="inline-flex items-center gap-2 border border-swiss-red px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-swiss-red transition-colors hover:bg-swiss-red hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" />
          Reset account
        </button>
        <div className="ml-auto">
          <MicroLabel>Data age</MicroLabel>
          <p className="mt-0.5 text-xs font-bold tabular-nums">
            {dataAge ? `${Math.max(0, Math.round((Date.now() - dataAge) / 60000))}m` : "—"}
          </p>
        </div>
      </div>
    </section>
  );
}
