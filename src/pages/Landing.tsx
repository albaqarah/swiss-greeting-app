import { motion } from "framer-motion";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

/** Greet the visitor based on their local time. */
function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return "Selamat pagi";
  if (hour >= 11 && hour < 15) return "Selamat siang";
  if (hour >= 15 && hour < 19) return "Selamat sore";
  return "Selamat malam";
}

const SPEC_ROWS = [
  { no: "01", label: "Sapaan", value: "Waktu lokalmu" },
  { no: "02", label: "Subjek", value: "Pengunjung" },
  { no: "03", label: "Lokasi", value: "Layar anda" },
  { no: "04", label: "Status", value: "Siap disapa" },
] as const;

export default function Landing() {
  const greeting = useMemo(getTimeGreeting, []);

  return (
    <main className="min-h-screen bg-white font-sans text-black antialiased selection:bg-swiss-blue selection:text-white">
      {/* Top rule */}
      <div className="h-2 w-full bg-black" />

      <div className="mx-auto flex min-h-[calc(100vh-0.5rem)] w-full max-w-[1600px] flex-col px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
        {/* Header — 12-column grid with hairline rules */}
        <motion.header
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="grid grid-cols-4 border border-black text-[10px] uppercase tracking-[0.2em]"
        >
          <div className="col-span-2 flex items-center gap-2 border-b border-r border-black px-3 py-3 sm:col-span-1 sm:border-b-0">
            <span className="size-2 shrink-0 bg-swiss-red" />
            <span className="font-bold">Bro siapa kamu?</span>
          </div>
          <div className="hidden items-center border-r border-black px-3 py-3 sm:flex">
            Program menyapa pengunjung
          </div>
          <div className="hidden items-center border-r border-black px-3 py-3 md:flex">
            Edisi V1.0
          </div>
          <div className="col-span-2 flex items-center justify-end gap-2 border-b border-black px-3 py-3 sm:col-span-1 sm:border-b-0">
            2026
            <span className="size-2 bg-swiss-blue" />
          </div>
        </motion.header>

        {/* Hero — the greeting itself */}
        <section className="relative mt-8 border border-black sm:mt-10">
          <span className="absolute left-4 top-4 hidden text-[10px] uppercase tracking-[0.2em] text-black/50 sm:block">
            № 001 — Sapaan
          </span>
          <div className="grid lg:grid-cols-12">
            <div className="border-b border-black lg:col-span-8 lg:border-b-0 lg:border-r">
              <motion.h1
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="px-4 pb-10 pt-12 text-[clamp(3.25rem,13.5vw,10.5rem)] font-bold uppercase leading-[0.88] tracking-[-0.02em] sm:px-6 sm:pt-16"
              >
                <span className="block">Bro,</span>
                <span className="block">
                  <span className="inline-block bg-swiss-blue px-[0.08em] text-white">
                    Siapa
                  </span>{" "}
                  <span className="text-swiss-red">kamu?</span>
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
                  Sapaan untukmu
                </p>
                <p className="mt-4 text-2xl font-bold uppercase leading-tight tracking-tight text-swiss-red sm:text-3xl">
                  {greeting}, bro.
                </p>
              </div>
              <div className="flex-1 p-4 sm:p-6">
                <p className="text-[10px] uppercase tracking-[0.2em] text-black/50">
                  Catatan V1
                </p>
                <p className="mt-4 text-sm leading-6 sm:text-[15px]">
                  Kamu baru saja tiba di halaman pertama kami. Kami belum tahu siapa kamu —
                  dan untuk versi satu, itu tidak masalah. Yang penting:{" "}
                  <span className="font-bold">kamu sudah disapa.</span>
                </p>
              </div>
            </motion.aside>
          </div>
        </section>

        {/* Data sapaan — specification grid */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="mt-8 grid grid-cols-2 border border-black sm:grid-cols-4"
        >
          {SPEC_ROWS.map((row, i) => (
            <div
              key={row.no}
              className={cn(
                "group flex flex-col justify-between gap-10 p-4 transition-colors hover:bg-black/[0.03] sm:p-5",
                i % 2 === 0 && "border-r",
                i < 2 && "border-b sm:border-b-0",
                i < 3 && "sm:border-r",
              )}
            >
              <div className="flex items-start justify-between gap-2 text-[10px] uppercase tracking-[0.2em]">
                <span className="text-black/40 transition-colors group-hover:text-swiss-red">
                  {row.no}
                </span>
                <span className="font-bold">{row.label}</span>
              </div>
              <p className="text-lg font-bold uppercase leading-tight tracking-tight sm:text-xl">
                {row.value}
              </p>
            </div>
          ))}
        </motion.section>

        {/* Footer rule */}
        <footer className="mt-auto pt-8">
          <div className="flex flex-col gap-3 border border-black bg-black px-4 py-4 text-[10px] uppercase tracking-[0.2em] text-white sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-center gap-2">
              <span className="size-2 bg-swiss-red" />
              © 2026 — Bro siapa kamu
            </div>
            <div>V1.0 — Hanya menyapa</div>
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
