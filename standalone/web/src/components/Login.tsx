import { Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { apiPost } from "../api";

export function Login({
  error,
  onSuccess,
}: {
  error: string | null;
  onSuccess: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(error);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setLoginError(null);
    try {
      await apiPost("/api/login", { pin });
      onSuccess();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-white font-sans text-black antialiased">
      <div className="h-2 w-full bg-black" />
      <div className="flex min-h-[calc(100vh-0.5rem)] items-center justify-center px-4">
        <div className="w-full max-w-md">
          {/* Header block */}
          <div className="flex items-center gap-3 border border-black bg-black px-5 py-4 text-white">
            <span className="size-2.5 shrink-0 bg-swiss-red" />
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">
                № 001 — Restricted area
              </p>
              <p className="text-sm font-bold uppercase tracking-[0.15em]">
                Super Genius · Control room
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="border border-t-0 border-black p-6">
            <p className="text-[10px] uppercase tracking-[0.2em] text-black/50">
              Enter access pin
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••"
                className="w-full border border-black px-3 py-3 text-lg font-bold tracking-[0.3em] outline-none placeholder:text-black/25 focus:border-swiss-red"
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || pin.length === 0}
                className="inline-flex shrink-0 items-center gap-2 bg-black px-5 text-[10px] font-bold uppercase tracking-[0.2em] text-white transition-colors hover:bg-swiss-red disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Lock className="size-3.5" />
                )}
                Enter
              </button>
            </div>

            {loginError && (
              <p className="mt-3 border border-swiss-red bg-swiss-red px-3 py-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white">
                {loginError === "wrong pin" ? "Wrong pin — try again." : loginError}
              </p>
            )}

            <p className="mt-4 text-[10px] uppercase tracking-[0.12em] text-black/40">
              Set your PIN in .env on the server (ADMIN_PIN). Sessions last 7 days.
            </p>
          </form>

          <div className="flex items-center justify-between border border-t-0 border-black px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-black/50">
            <span>Esports only · 2× TP · entry ≤ 5¢</span>
            <span className="size-2 bg-swiss-blue" />
          </div>
        </div>
      </div>
    </main>
  );
}
