import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Backstop heartbeat. The bot tick reschedules itself every 5s while armed
// (see bot.ts scheduleNextTick), and this cron guarantees the chain is
// revived within a minute even after a deployment restart — no dashboard tab
// required.
crons.interval("botTick", { minutes: 1 }, api.bot.tick);

export default crons;
