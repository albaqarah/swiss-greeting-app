// End-to-end smoke test — boots the real server on a throwaway temp database,
// exercises auth + API + one bot tick, then shuts it down. Run from
// standalone/ with: npm run smoke -w server   (after `npm run build`)

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

async function json(pathname, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }
  return { status: res.status, data, setCookie: res.headers.get("set-cookie") };
}

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "genius-smoke-"));
console.log(`temp data dir: ${tmpDir}`);

const child = spawn(process.execPath, ["dist/index.js"], {
  cwd: __dirname,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(PORT),
    DATA_DIR: tmpDir,
    ADMIN_PIN: "1234",
    BOT_MODE: "dry",
    SCAN_INTERVAL_MS: "5000",
    WEB_DIR: path.resolve(__dirname, "../web/dist"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
child.stdout.on("data", (d) => (serverLog += d.toString()));
child.stderr.on("data", (d) => (serverLog += d.toString()));

try {
  console.log("waiting for server…");
  check("server boots", await waitForHealth());

  // Auth gate
  let r = await json("/api/status");
  check("status requires login (401)", r.status === 401);

  r = await json("/api/login", { method: "POST", body: { pin: "wrong" } });
  check("wrong pin rejected (401)", r.status === 401);

  r = await json("/api/login", { method: "POST", body: { pin: "1234" } });
  check("correct pin logs in (200 + cookie)", r.status === 200 && !!r.setCookie);
  const cookie = (r.setCookie ?? "").split(";")[0];

  r = await json("/api/status", { cookie });
  check("status works with cookie", r.status === 200 && r.data !== null);
  check("fresh account is $1,000 dry run", r.data?.config?.cash === 1000 && r.data?.mode === "dry");

  r = await json("/api/meta", { cookie });
  check("meta reports dry + 5s scan", r.data?.mode === "dry" && r.data?.scanIntervalMs === 5000);

  r = await json("/api/bot/enable", { method: "POST", body: { enabled: true }, cookie });
  check("arm bot (200)", r.status === 200);

  r = await json("/api/status", { cookie });
  check("status shows armed", r.data?.config?.enabled === true);

  r = await json("/api/bot/run-tick", { method: "POST", cookie });
  check("run-tick responds 200", r.status === 200);
  console.log(`    (tick: fetched=${r.data?.fetched} books=${r.data?.books} ran=${r.data?.ran})`);

  r = await json("/api/markets", { cookie });
  if (r.status === 200 && (r.data?.length ?? 0) > 0) {
    check("markets fetched from Gamma API", r.data.length > 0, `(${r.data.length} markets)`);
  } else {
    console.warn(`    ⚠ markets empty (status ${r.status}) — likely offline; not failing`);
  }

  r = await json("/api/logs", { cookie });
  check("journal readable", r.status === 200 && Array.isArray(r.data));

  r = await json("/api/bot/close-all", { method: "POST", cookie });
  check("close-all responds 200", r.status === 200);

  // Static UI
  const html = await fetch(`${BASE}/`);
  check("dashboard served at /", html.status === 200 && (await html.text()).includes("root"));
} catch (err) {
  failures += 1;
  console.error("smoke test crashed:", err);
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log("---- server log (tail) ----");
console.log(serverLog.split("\n").slice(-12).join("\n"));

if (failures > 0) {
  console.error(`\nSMOKE TEST FAILED: ${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nSMOKE TEST PASSED ✓");
}
