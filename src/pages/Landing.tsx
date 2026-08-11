import { motion } from "framer-motion";
import { Link } from "react-router";

const AUTH_CTA = "/auth?returnTo=%2Fdashboard";

const SPEC_ROWS = [
  {
    no: "01",
    label: "Telemetry",
    title: "Reads the order book",
    value: "Bid/ask depth imbalance, spread quality and live liquidity — scanned every minute, focused on markets that resolve within 24 hours.",
  },
  {
    no: "02",
    label: "Momentum",
    title: "Enters early",
    value: "Hunts cheap prices with fresh momentum — gets in before the crowd, at 20¢ or less, where a 5× move is actually reachable.",
  },
  {
    no: "03",
    label: "Discipline",
    title: "Rules are rules",
    value: "5× take-profit, 25% stop-loss, near-certainty lock at 95¢, max 5 open positions. Genius is knowing when to fold.",
  },
  {
    no: "04",
    label: "Journal",
    title: "Narrates itself",
    value: "Every scan, entry, exit and excuse logged in the Genius Journal. Watch the bot think in public.",
  },
] as const;

const STEPS = [
  {
    no: "01",
    title: "Sign in",
    text: "Email OTP or instant guest access. 20 seconds, no wallet needed.",
  },
  {
    no: "02",
    title: "Arm the bot",
    text: "Flip the switch. The bot starts with a virtual $1,000 bankroll and begins scanning.",
  },
  {
    no: "03",
    title: "Watch it trade",
    text: "Order books update, signals fire, and positions open with a running commentary.",
  },
  {
    no: "04",
    title: "Judge the genius",
    text: "Take-profits lock in, stop-losses get cut, and every call lands in the journal.",
  },
] as const;

const TICKER = [
  "≤ 24H MARKETS",
  "EARLY ENTRY",
  "5× TAKE-PROFIT",
  "1-MIN SCAN",
  "GENIUS JOURNAL",
] as const;

export default function Landing() {
  return (
    <main className="min-h-screen bg-white font-sans text-black antialiased selection:bg-swiss-blue selection:text-white">
      {/* Top rule */}
      <div className="h-2 w-full bg-black" />

      <div className="mx-auto flex min-h-[calc(100vh-0.5rem)] w-full max-w-[1600px] flex-col px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
        {/* Header — strict grid with hairline rules */}
        <motion.header
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="grid grid-cols-4 border border-black text-[10px] uppercase tracking-[0.2em]"
        >
          <div className="col-span-2 flex items-center gap-2 border-b border-r border-black px-3 py-3 sm:col-span-1 sm:border-b-0">
            <span className="size-2 shrink-0 bg-swiss-red" />
            <span className="font-bold">Super Genius</span>
          </div>
          <div className="hidden items-center border-r border-black px-3 py-3 sm:flex">
            Polymarket bot
          </div>
          <div className="hidden items-center border-r border-black px-3 py-3 md:flex">
            Edition V2.0
          </div>
          <div className="col-span-2 flex items-center justify-end gap-2 border-b border-black px-3 py-3 sm:col-span-1 sm:border-b-0">
            2026
            <span className="size-2 bg-swiss-blue" />
          </div>
        </motion.header>

        {/* Hero */}
        <section className="relative mt-8 border border-black sm:mt-10">
          <span className="absolute left-4 top-4 hidden text-[10px] uppercase tracking-[0.2em] text-black/50 sm:block">
            № 001 — The pitch
          </span>
          <div className="grid lg:grid-cols-12">
            <div className="border-b border-black lg:col-span-8 lg:border-b-0 lg:border-r">
              <motion.h1
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="px-4 pb-10 pt-12 text-[clamp(3.25rem,13.5vw,10.5rem)] font-bold uppercase leading-[0.88] tracking-[-0.02em] sm:px-6 sm:pt-16"
              >
                <span className="block">Super</span>
                <span className="block">
                  <span className="inline-block bg-swiss-red px-[0.08em] text-white">
                    Genius
                  </span>
                </span>
                <span className="block">
                  Bot<span className="text-swiss-blue">.</span>
                </span>
              </motion.h1>
            </div>
            <motion.aside
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="flex flex-col lg:col-span-4"
            >
              <div className="border-b border-black p-4 sm:p-6">
                <p className="text-[10px] uppercase tracking-[0.2em] text-black/50">
                  Bro, meet your new money brain
                </p>
                <p className="mt-4 text-xl font-bold uppercase leading-tight tracking-tight sm:text-2xl">
                  A prediction-market bot that reads order books, feels momentum
                  and trades Polymarket 24/7 —{" "}
                  <span className="text-swiss-red">on paper</span>.
                </p>
              </div>
              <div className="flex-1 p-4 sm:p-6">
                <p className="text-[10px] uppercase tracking-[0.2em] text-black/50">
                  What it does
                </p>
                <p className="mt-4 text-sm leading-6 sm:text-[15px]">
                  Live market data from Polymarket&apos;s public APIs. Signals
                  from order-book imbalance, momentum and liquidity. A virtual{" "}
                  <span className="font-bold">$1,000 bankroll</span>, take-profit
                  and stop-loss discipline, and a journal that narrates every
                  call. Zero real money harmed.
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                  <Link
                    to={AUTH_CTA}
                    className="inline-flex items-center justify-center gap-2 bg-black px-5 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-white transition-colors hover:bg-swiss-red"
                  >
                    Enter control room →
                  </Link>
                  <a
                    href="#manual"
                    className="inline-flex items-center justify-center gap-2 border border-black px-5 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-black transition-colors hover:bg-black hover:text-white"
                  >
                    Read the genius manual
                  </a>
                </div>
                <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-black/40">
                  Free · Paper trading · No KYC · No wallet
                </p>
              </div>
            </motion.aside>
          </div>
        </section>

        {/* Ticker */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-8 flex items-center gap-4 overflow-hidden border border-black bg-black px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-white sm:gap-8 sm:px-5"
        >
          {TICKER.map((item, i) => (
            <span key={item} className="flex shrink-0 items-center gap-2 sm:gap-8">
              <span className={i % 2 === 0 ? "bg-swiss-red" : "bg-swiss-blue"}>
                <span className="block size-2" />
              </span>
              {item}
            </span>
          ))}
        </motion.div>

        {/* Features — specification grid */}
        <section className="mt-8 grid grid-cols-1 border border-black md:grid-cols-2 xl:grid-cols-4">
          {SPEC_ROWS.map((row, i) => (
            <motion.div
              key={row.no}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.05 }}
              className={
                "group flex flex-col justify-between gap-10 p-5 transition-colors hover:bg-black/[0.03] sm:p-6 " +
                (i < 3 ? "border-b border-black md:border-b-0 " : "") +
                (i % 2 === 0 ? "md:border-r " : "") +
                (i < 2 ? "xl:border-r " : "")
              }
            >
              <div className="flex items-start justify-between gap-2 text-[10px] uppercase tracking-[0.2em]">
                <span className="text-black/40 transition-colors group-hover:text-swiss-red">
                  {row.no}
                </span>
                <span className="font-bold">{row.label}</span>
              </div>
              <div>
                <h2 className="text-lg font-bold uppercase leading-tight tracking-tight sm:text-xl">
                  {row.title}
                </h2>
                <p className="mt-3 text-sm leading-6 text-black/70">{row.value}</p>
              </div>
            </motion.div>
          ))}
        </section>

        {/* How it works */}
        <section
          id="manual"
          className="mt-8 grid grid-cols-1 border border-black sm:grid-cols-2 lg:grid-cols-4"
        >
          {STEPS.map((step, i) => (
            <motion.div
              key={step.no}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.05 }}
              className={
                "flex flex-col gap-8 p-5 sm:p-6 " +
                (i < 3 ? "border-b border-black sm:border-b-0 " : "") +
                (i % 2 === 0 ? "sm:border-r " : "") +
                (i < 2 ? "lg:border-r " : "")
              }
            >
              <div className="flex items-baseline justify-between">
                <span className="text-4xl font-bold text-black/15">{step.no}</span>
                <span className="size-2 bg-swiss-blue" />
              </div>
              <div>
                <h3 className="text-base font-bold uppercase tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-black/70">{step.text}</p>
              </div>
            </motion.div>
          ))}
        </section>

        {/* CTA band */}
        <motion.section
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mt-8 flex flex-col items-start justify-between gap-6 border border-swiss-red bg-swiss-red px-6 py-10 text-white sm:flex-row sm:items-center sm:px-10 sm:py-14"
        >
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/70">
              № 002 — The invitation
            </p>
            <h2 className="mt-3 text-4xl font-bold uppercase leading-none tracking-tight sm:text-6xl">
              Ready to witness
              <br />
              genius?
            </h2>
          </div>
          <Link
            to={AUTH_CTA}
            className="inline-flex shrink-0 items-center justify-center gap-2 bg-white px-6 py-4 text-[11px] font-bold uppercase tracking-[0.2em] text-swiss-red transition-colors hover:bg-black hover:text-white"
          >
            Enter the control room →
          </Link>
        </motion.section>

        {/* Footer */}
        <footer className="mt-auto pt-8">
          <div className="flex flex-col gap-3 border border-black bg-black px-4 py-4 text-[10px] uppercase tracking-[0.2em] text-white sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-center gap-2">
              <span className="size-2 bg-swiss-red" />
              © 2026 — Super Genius Polymarket Bot
            </div>
            <div>Paper trading only — not financial advice</div>
            <div className="flex items-center gap-2">
              Grid 12/12
              <span className="size-2 bg-swiss-blue" />
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
