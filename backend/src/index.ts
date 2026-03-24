import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";

import { authRoutes }        from "./routes/auth.js";
import { marketRoutes }      from "./routes/markets.js";
import { portfolioRoutes }   from "./routes/portfolio.js";
import { priceRoutes }       from "./routes/prices.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { referralRoutes }    from "./routes/referral.js";
import { depositRoutes }     from "./routes/deposits.js";
import { activityRoutes }    from "./routes/activity.js";
import { userRoutes }        from "./routes/users.js";
import { scheduleAllPendingMarkets } from "./workers/resolver.js";
import { pollDeposits }              from "./workers/depositPoller.js";
import { processPendingWithdrawals } from "./workers/withdrawalProcessor.js";
import { runMigrations }             from "./db/runMigrations.js";
import { startBot, startXAgent }     from "./fud-bot/index.js";

const app = Fastify({ logger: true });

// Plugins
await app.register(cors, { origin: true });
await app.register(jwt, { secret: process.env.JWT_SECRET! });

// Rate limiting
await app.register(rateLimit, {
  global: true,
  max: 60,
  timeWindow: "1 minute",
  ban: 3,
  errorResponseBuilder: (_req, ctx) => ({
    error: "Too many requests.",
    retryAfter: ctx.after,
  }),
});

// Auth middleware decorator
app.decorate("authenticate", async (req: any, reply: any) => {
  try {
    await req.jwtVerify();
  } catch {
    reply.status(401).send({ error: "Unauthorized" });
  }
});

// Routes
await app.register(authRoutes);
await app.register(marketRoutes);
await app.register(portfolioRoutes);
await app.register(priceRoutes);
await app.register(leaderboardRoutes);
await app.register(referralRoutes);
await app.register(depositRoutes);
await app.register(activityRoutes);
await app.register(userRoutes);

// Health check
app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

// Run DB migrations (idempotent — safe to run on every start)
await runMigrations();

// Schedule resolution for all open markets (handles restarts)
await scheduleAllPendingMarkets();

// Poll for incoming deposits every 30s
setInterval(pollDeposits, 30_000);
pollDeposits();

// Process pending withdrawals every 60s
setInterval(processPendingWithdrawals, 60_000);
processPendingWithdrawals();

// Start server
const port = parseInt(process.env.PORT ?? "3001");
await app.listen({ port, host: "0.0.0.0" });
console.log(`FUD.markets backend running on :${port}`);

// Start Telegram bot (non-blocking)
startBot().catch(e => console.error("[bot] startup error:", e));

// Start X agent (non-blocking — skips if TWITTERAPI_KEY not set)
startXAgent().catch(e => console.error("[x-agent] startup error:", e));
