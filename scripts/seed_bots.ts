/**
 * seed_bots.ts
 * Creates 10 bot accounts and has them place paper trades across multiple tokens/timeframes.
 * Usage: BASE_URL=https://your-backend.railway.app npx tsx scripts/seed_bots.ts
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3001";

const BOTS = [
  { username: "degen_alpha",   password: "botpass123" },
  { username: "moon_chaser",   password: "botpass123" },
  { username: "rug_detector",  password: "botpass123" },
  { username: "chad_longer",   password: "botpass123" },
  { username: "perma_short",   password: "botpass123" },
  { username: "fud_lord",      password: "botpass123" },
  { username: "wagmi_bro",     password: "botpass123" },
  { username: "ngmi_guy",      password: "botpass123" },
  { username: "apein_hard",    password: "botpass123" },
  { username: "exit_liquidity",password: "botpass123" },
];

const TOKENS = [
  { symbol: "DOGE",  chain: "SOL" },
  { symbol: "PEPE",  chain: "ETH" },
  { symbol: "WIF",   chain: "SOL" },
  { symbol: "BONK",  chain: "SOL" },
  { symbol: "SHIB",  chain: "ETH" },
];

const TIMEFRAMES = ["5m", "15m", "1h"];
const SIDES: ("long" | "short")[] = ["long", "short"];
const AMOUNTS = [10, 25, 50, 100];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function req(path: string, opts: RequestInit = {}, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${path}`);
  return data;
}

async function registerOrLogin(username: string, password: string): Promise<string> {
  try {
    const r = await req("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    console.log(`  ✓ registered ${username}`);
    return r.token;
  } catch {
    try {
      const r = await req("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      console.log(`  ↩ logged in  ${username}`);
      return r.token;
    } catch (e: any) {
      console.error(`  ✗ failed     ${username}: ${e.message}`);
      throw e;
    }
  }
}

async function creditPaper(token: string) {
  await req("/auth/paper-credit", {
    method: "POST",
    body: JSON.stringify({ amount: 1000 }),
  }, token);
}

async function placePaperOrder(token: string, symbol: string, chain: string, timeframe: string, side: "long" | "short", amount: number) {
  // Try to place a limit order (maker intent) in the order book
  await req("/orders", {
    method: "POST",
    body: JSON.stringify({ symbol, chain, timeframe, side, amount, is_paper: true, auto_reopen: Math.random() > 0.5 }),
  }, token);
}

async function openPaperMarket(token: string, symbol: string, chain: string, timeframe: string, side: "long" | "short", amount: number) {
  // Create a market and bet on it
  const taglines = [
    `${symbol} to the moon! 🚀`,
    `${symbol} is dead, shorting everything`,
    `${symbol} ${timeframe} print incoming`,
    `easy ${side} setup on ${symbol}`,
    `${symbol} breakout or breakdown?`,
  ];
  const market = await req("/markets", {
    method: "POST",
    body: JSON.stringify({ symbol, chain, timeframe, tagline: pick(taglines), paper: true }),
  }, token);
  await req(`/markets/${market.id}/bet`, {
    method: "POST",
    body: JSON.stringify({ side, amount, paper: true }),
  }, token);
}

async function runBot(bot: { username: string; password: string }) {
  console.log(`\n── ${bot.username}`);
  let token: string;
  try {
    token = await registerOrLogin(bot.username, bot.password);
  } catch { return; }

  await creditPaper(token).catch(() => {});

  // Each bot does 3–5 actions
  const numActions = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < numActions; i++) {
    const { symbol, chain } = pick(TOKENS);
    const timeframe = pick(TIMEFRAMES);
    const side      = pick(SIDES);
    const amount    = pick(AMOUNTS);

    const doOrder = Math.random() > 0.4; // 60% place limit order, 40% open market
    try {
      if (doOrder) {
        await placePaperOrder(token, symbol, chain, timeframe, side, amount);
        console.log(`  📋 limit order  ${side.toUpperCase()} $${symbol} ${timeframe} $${amount}`);
      } else {
        await openPaperMarket(token, symbol, chain, timeframe, side, amount);
        console.log(`  🎲 market trade ${side.toUpperCase()} $${symbol} ${timeframe} $${amount}`);
      }
    } catch (e: any) {
      console.log(`  ⚠  ${e.message}`);
    }

    // Small delay between actions
    await new Promise(r => setTimeout(r, 300));
  }
}

async function main() {
  console.log(`\n🤖 FUD.markets bot seeder`);
  console.log(`   target: ${BASE}`);
  console.log(`   bots:   ${BOTS.length}`);
  console.log(`   tokens: ${TOKENS.map(t => t.symbol).join(", ")}\n`);

  // Run bots sequentially to avoid hammering the server
  for (const bot of BOTS) {
    await runBot(bot);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("\n✅ Done. Markets and orders are now open in paper mode.\n");
}

main().catch(console.error);
