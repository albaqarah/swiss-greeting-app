// Tiny fetch client for the control room:
// usePoll() polls a REST endpoint every few seconds (the server is local, so
// this is cheap), apiPost() fires control actions.

import { useEffect, useState } from "react";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data && typeof data.error === "string") message = data.error;
    } catch {
      // keep statusText
    }
    throw new ApiError(res.status, message || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const apiGet = <T,>(path: string): Promise<T> => request<T>(path);

export const apiPost = <T,>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/**
 * Poll a REST endpoint. `path === null` disables the poll (e.g. nothing
 * selected yet). Bumping `key` forces an immediate refetch (used after
 * login and after control actions).
 */
export function usePoll<T>(
  path: string | null,
  intervalMs = 5000,
  key = 0,
): { data: T | undefined; error: string | null } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setData(undefined);
      setError(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const load = async () => {
      try {
        const result = await request<T>(path);
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        // A 401 (session expired) makes the app fall back to the login screen.
        setData(undefined);
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    load();
    timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [path, intervalMs, key]);

  return { data, error };
}

// ---------------------------------------------------------------------------
// API shapes (mirror the server responses)
// ---------------------------------------------------------------------------

export interface StatusData {
  config: {
    bankroll: number;
    cash: number;
    enabled: boolean;
    aggression: number;
    lastTickAt: number | null;
  };
  equity: number;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openCount: number;
  winRate: number | null;
  closedTradesCount: number;
  marketsUpdatedAt: number;
  mode: "dry" | "live";
  scanIntervalMs: number;
}

export interface MetaData {
  mode: "dry" | "live";
  scanIntervalMs: number;
  version: string;
}
