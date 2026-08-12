import { useState } from "react";
import { usePoll, type StatusData } from "./api";
import { Dashboard } from "./components/Dashboard";
import { Login } from "./components/Login";

export default function App() {
  // Poll /api/status as the auth gate: it returns 401 when the session cookie
  // is missing/expired, which makes usePoll drop `data` → we show the login.
  const [sessionKey, setSessionKey] = useState(0);
  const { data: status, error } = usePoll<StatusData | null>(
    "/api/status",
    5000,
    sessionKey,
  );

  const authed = status !== undefined;

  if (!authed) {
    return <Login error={error} onSuccess={() => setSessionKey((k) => k + 1)} />;
  }

  return (
    <Dashboard
      status={status}
      onStatusRefresh={() => setSessionKey((k) => k + 1)}
    />
  );
}
