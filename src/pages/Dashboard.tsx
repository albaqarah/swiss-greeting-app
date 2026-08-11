import { BotControls } from "@/components/bot/BotControls";
import { JournalPanel } from "@/components/bot/JournalPanel";
import { MarketDetail } from "@/components/bot/MarketDetail";
import { MarketsTable } from "@/components/bot/MarketsTable";
import { PositionsPanel } from "@/components/bot/PositionsPanel";
import { SectionShell, fmtMoney, fmtPct, PnlText } from "@/components/bot/shared";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import { LogOut } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

function StatCell({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-2 border-b border-black p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0",
        className,
      )}
    >
      <p className="text-[10px] uppercase tracking-[0.2em] text-black/50">
        {label}
      </p>
      <div>
        <p className="text-xl font-bold tabular-nums leading-none">{value}</p>
        {sub && (
          <p className="mt-1.5 text-[10px] uppercase tracking-[0.12em] text-black/40">
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = useState<Id<"markets"> | null>(null);
  const [history, setHistory] = useState<{ t: number; p: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const autoRefreshed = useRef(false);

  const status = useQuery(api.dashboard.getStatus);
  const markets = useQuery(api.dashboard.listMarkets);
  const positions = useQuery(api.dashboard.listPositions);
  const trades = useQuery(api.dashboard.listTrades);
  const logs = useQuery(api.dashboard.listLogs);
  const marketDetail = useQuery(
    api.dashboard.getMarket,
    selectedId ? { marketId: selectedId } : "skip",
  );

  const refreshMarkets = useAction(api.markets.refreshMarkets);
  const runTick = useAction(api.bot.runTick);
  const getMarketHistory = useAction(api.markets.getMarketHistory);
  const setBotEnabled = useMutation(api.dashboard.setBotEnabled);
  const setAggression = useMutation(api.dashboard.setAggression);
  const resetAccount = useMutation(api.dashboard.resetAccount);

  // First visit: kick off a market refresh so the board isn't empty.
  useEffect(() => {
    if (markets && markets.length === 0 && !autoRefreshed.current) {
      autoRefreshed.current = true;
      refreshMarkets().catch((error) => console.error("refresh failed", error));
    }
  }, [markets, refreshMarkets]);

  // Preselect the most liquid market once data arrives.
  useEffect(() => {
    if (!selectedId && markets && markets.length > 0) {
      setSelectedId(markets[0]._id);
    }
  }, [markets, selectedId]);

  // Pull price history whenever the selection changes.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setHistory(null);
    getMarketHistory({ marketId: selectedId })
      .then((res) => {
        if (!cancelled) setHistory(res.points);
      })
      .catch((error) => console.error("history failed", error));
    return () => {
      cancelled = true;
    };
  }, [selectedId, getMarketHistory]);

  const loading =
    status === undefined ||
    markets === undefined ||
    positions === undefined ||
    trades === undefined ||
    logs === undefined;

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    if (
      window.confirm(
        "Reset the account? Open positions will be liquidated at market value and the journal cleared.",
      )
    ) {
      runAction(() => resetAccount());
    }
  };

  const selectedMarket =
    marketDetail && selectedId === marketDetail._id
      ? {
          ...marketDetail,
          image: marketDetail.image ?? null,
          book: marketDetail.book ?? null,
          signal: marketDetail.signal ?? null,
        }
      : null;

  const heldSide = positions?.find(
    (p) => p.marketId === selectedId,
  )?.side ?? null;

  return (
    <main className="min-h-screen bg-white font-sans text-black antialiased selection:bg-swiss-blue selection:text-white">
      {/* Top rule */}
      <div className="h-2 w-full bg-black" />

      <div className="mx-auto flex min-h-[calc(100vh-0.5rem)] w-full max-w-[1600px] flex-col px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
        {/* Header */}
        <header className="grid grid-cols-2 border border-black text-[10px] uppercase tracking-[0.2em] sm:grid-cols-4">
          <div className="flex items-center gap-2 border-b border-r border-black px-3 py-3 sm:border-b-0">
            <span className="size-2 shrink-0 bg-swiss-red" />
            <span className="font-bold">Super Genius</span>
          </div>
          <div className="flex items-center justify-end gap-2 border-b border-black px-3 py-3 sm:justify-center sm:border-b-0 sm:border-r">
            <span className="text-black/50">Control room</span>
          </div>
          <div className="hidden items-center justify-center border-r border-black px-3 py-3 sm:flex">
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                status?.config.enabled ? "text-swiss-red" : "text-black/50",
              )}
            >
              <span
                className={cn(
                  "size-1.5",
                  status?.config.enabled ? "bg-swiss-red" : "bg-black/40",
                )}
              />
              {status?.config.enabled ? "Bot armed" : "Bot paused"}
            </span>
          </div>
          <div className="col-span-2 flex items-center justify-end gap-3 border-b border-black px-3 py-3 sm:col-span-1 sm:border-b-0">
            <span className="hidden truncate md:inline">
              {user?.name ?? user?.email ?? "Genius operator"}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 font-bold transition-colors hover:text-swiss-red"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </div>
        </header>

        {loading ? (
          <div className="mt-10 flex flex-col items-center gap-4 border border-black px-6 py-20">
            <span className="size-3 animate-pulse bg-swiss-red" />
            <p className="text-[10px] uppercase tracking-[0.2em] text-black/50">
              Booting the control room…
            </p>
          </div>
        ) : (
          <>
            {/* Not-armed banner */}
            {!status && (
              <div className="mt-8 flex flex-col items-start justify-between gap-4 border border-swiss-red bg-swiss-red px-5 py-4 text-white sm:flex-row sm:items-center">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/70">
                    № 000 — First contact
                  </p>
                  <p className="mt-1 text-sm font-bold uppercase tracking-tight">
                    Fresh $1,000 virtual bankroll allocated — flip the switch to arm the bot.
                  </p>
                </div>
                <span className="size-2 shrink-0 bg-white" />
              </div>
            )}

            {/* Stats strip */}
            <section className="mt-8 grid grid-cols-2 border border-black sm:grid-cols-3 lg:grid-cols-6">
              <StatCell
                label="Bankroll"
                value={fmtMoney(status?.config.bankroll ?? 1000, 0)}
                sub="Virtual capital"
              />
              <StatCell
                label="Cash"
                value={fmtMoney(status?.config.cash ?? 0)}
                sub="Available dry powder"
              />
              <StatCell
                label="Equity"
                value={fmtMoney(status?.equity ?? 0)}
                sub="Cash + positions"
              />
              <StatCell
                label="Total P&L"
                value={<PnlText value={status?.totalPnl ?? 0} />}
                sub={
                  status && status.config.bankroll > 0
                    ? fmtPct(status.totalPnl / status.config.bankroll)
                    : "Since launch"
                }
              />
              <StatCell
                label="Win rate"
                value={
                  status?.winRate === null
                    ? "—"
                    : `${((status?.winRate ?? 0) * 100).toFixed(0)}%`
                }
                sub={`${status?.closedTradesCount ?? 0} closed trades`}
              />
              <StatCell
                label="Open positions"
                value={status?.openCount ?? 0}
                sub={`Max ${5} at once`}
              />
            </section>

            {/* Controls */}
            <div className="mt-8">
              <BotControls
                enabled={status?.config.enabled ?? false}
                aggression={status?.config.aggression ?? 0.25}
                busy={busy}
                dataAge={status?.marketsUpdatedAt ?? null}
                onToggle={(enabled) =>
                  runAction(() => setBotEnabled({ enabled }))
                }
                onAggression={(value) =>
                  runAction(() => setAggression({ aggression: value }))
                }
                onRunTick={() => runAction(() => runTick())}
                onRefresh={() => runAction(() => refreshMarkets())}
                onReset={handleReset}
              />
            </div>

            {/* Markets + microscope */}
            <div className="mt-8 grid gap-8 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <SectionShell
                  no="01"
                  title="Live markets"
                  right={
                    <span className="text-[10px] uppercase tracking-[0.2em] text-black/40">
                      {markets?.length ?? 0} tracked
                    </span>
                  }
                >
                  <div className="max-h-[560px] overflow-auto">
                    <MarketsTable
                      markets={markets ?? []}
                      selectedId={selectedId}
                      onSelect={(id) => setSelectedId(id as Id<"markets">)}
                      loading={false}
                    />
                  </div>
                </SectionShell>
              </div>
              <div className="lg:col-span-4">
                <SectionShell no="02" title="Market microscope">
                  <MarketDetail
                    market={selectedMarket}
                    history={history ?? selectedMarket?.history ?? []}
                    held={heldSide}
                  />
                </SectionShell>
              </div>
            </div>

            {/* Positions + journal */}
            <div className="mt-8 grid gap-8 lg:grid-cols-12">
              <div className="lg:col-span-6">
                <SectionShell
                  no="03"
                  title="Positions"
                  right={
                    <span className="text-[10px] uppercase tracking-[0.2em] text-black/40">
                      {positions?.length ?? 0} open
                    </span>
                  }
                >
                  <PositionsPanel positions={positions ?? []} loading={false} />
                </SectionShell>
              </div>
              <div className="lg:col-span-6">
                <SectionShell no="04" title="Genius journal">
                  <JournalPanel
                    trades={trades ?? []}
                    logs={logs ?? []}
                    loading={false}
                  />
                </SectionShell>
              </div>
            </div>

            {/* Footer */}
            <footer className="mt-auto pt-8">
              <div className="flex flex-col gap-2 border border-black bg-black px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-white sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex items-center gap-2">
                  <span className="size-2 bg-swiss-red" />
                  Paper trading only — no real orders are placed
                </div>
                <div>Data: Polymarket public APIs</div>
                <div className="flex items-center gap-2">
                  Not financial advice
                  <span className="size-2 bg-swiss-blue" />
                </div>
              </div>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
