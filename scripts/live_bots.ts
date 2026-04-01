/**
 * live_bots.ts
 * Simulates 20 bots trading at a relaxed pace for 4 hours.
 * Each bot acts every 4-7 minutes, staggered so only 2-4 fire at any given time.
 * Usage: BASE_URL=https://fud-markets-backend-production.up.railway.app npx tsx scripts/live_bots.ts
 */

export {};
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

const BOTS = [
  { username: "degen_alpha",    password: "botpass123" },
  { username: "moon_chaser",    password: "botpass123" },
  { username: "rug_detector",   password: "botpass123" },
  { username: "chad_longer",    password: "botpass123" },
  { username: "perma_short",    password: "botpass123" },
  { username: "fud_lord",       password: "botpass123" },
  { username: "wagmi_bro",      password: "botpass123" },
  { username: "ngmi_guy",       password: "botpass123" },
  { username: "apein_hard",     password: "botpass123" },
  { username: "exit_liquidity", password: "botpass123" },
  { username: "based_gigachad", password: "botpass123" },
  { username: "pump_enjoyer",   password: "botpass123" },
  { username: "bear_trap",      password: "botpass123" },
  { username: "solana_maxi",    password: "botpass123" },
  { username: "eth_killer",     password: "botpass123" },
  { username: "memecoin_god",   password: "botpass123" },
  { username: "liquidation_lv", password: "botpass123" },
  { username: "alpha_leak",     password: "botpass123" },
  { username: "paper_hands",    password: "botpass123" },
  { username: "diamond_hands",  password: "botpass123" },
];

const TOKENS = [
  { symbol: "DOGE",  chain: "SOL" },
  { symbol: "PEPE",  chain: "ETH" },
  { symbol: "WIF",   chain: "SOL" },
  { symbol: "BONK",  chain: "SOL" },
  { symbol: "SHIB",  chain: "ETH" },
  { symbol: "SOL",   chain: "SOL" },
  { symbol: "BTC",   chain: "ETH" },
];

const TIMEFRAMES = ["5m", "15m", "1h", "4h"];
const SIDES: ("long" | "short")[] = ["long", "short"];
const AMOUNTS = [10, 25, 50, 100, 200];

const TAGLINES = [
  "this is going to rip 🔥",
  "easy money ser",
  "ngmi if you fade this",
  "trust the chart",
  "gm. shorting everything.",
  "wen moon??",
  "breakdown incoming 📉",
  "accumulation zone",
  "buy the dip or get rekt",
  "this ends badly",
  "don't fight the trend",
  "liquidation cascade incoming",
  "based trade ser 🫡",
  "wagmi on this one",
  "nfa but probably up",
  "rug incoming, mark my words",
  "dev still has 80% supply lmao",
  "this thing is a scam and i'll short it all day",
  "printing money rn 🖨️",
  "you're all gonna get liquidated",
  "100x or zero, no in between",
  "someone has to take the other side 🫡",
  "CT is delusional about this one",
  "fade the crowd, win the bag",
];

const MESSAGES_SHORT = [
  "rug incoming, screenshot this",
  "dev is selling rn, trust",
  "seen this pattern 100x, always dumps",
  "you're catching a falling knife",
  "ngmi if you go long on this garbage",
  "this is exit liquidity, not alpha",
  "classic pump and dump setup",
  "down bad and going lower",
  "ser this is a casino and the house always wins",
  "zero by friday",
  "short and retire",
  "chart is cooked 📉",
  "no fundamentals, only vibes. bearish vibes.",
];

const MESSAGES_LONG = [
  "early, CT hasn't noticed yet",
  "this is the play ser, trust",
  "accumulation complete. up only from here",
  "diamond hands paying off rn 💎",
  "biggest short squeeze incoming",
  "bears are gonna get wrecked",
  "still cheap tbh",
  "nfa but I'm loading bags",
  "this one actually has a community",
  "up 10x from here minimum",
  "the haters are gonna fund my bags ty",
  "chart is clean, just buy",
  "vibes are immaculate 🫡",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
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
  if (!res.ok) throw new Error((data as any).error ?? `${res.status} ${path}`);
  return data;
}

async function registerOrLogin(username: string, password: string): Promise<string> {
  try {
    const r: any = await req("/auth/register", { method: "POST", body: JSON.stringify({ username, password }) });
    return r.token;
  } catch {
    const r: any = await req("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    return r.token;
  }
}

async function doAction(token: string) {
  const { symbol, chain } = pick(TOKENS);
  const timeframe = pick(TIMEFRAMES);
  const side      = pick(SIDES);
  const amount    = pick(AMOUNTS);
  const roll      = Math.random();

  if (roll < 0.35) {
    // Place limit order (maker)
    const orderMsg = side === "short" ? pick(MESSAGES_SHORT) : pick(MESSAGES_LONG);
    await req("/orders", {
      method: "POST",
      body: JSON.stringify({ symbol, chain, timeframe, side, amount, is_paper: true, auto_reopen: Math.random() > 0.4, tagline: orderMsg }),
    }, token);
    return `📋 limit ${side.toUpperCase()} ${symbol} ${timeframe} $${amount}`;
  } else if (roll < 0.65) {
    // Open market + bet
    const market: any = await req("/markets", {
      method: "POST",
      body: JSON.stringify({ symbol, chain, timeframe, tagline: pick(TAGLINES), paper: true }),
    }, token);
    const msg = side === "short" ? pick(MESSAGES_SHORT) : pick(MESSAGES_LONG);
    await req(`/markets/${market.id}/bet`, {
      method: "POST",
      body: JSON.stringify({ side, amount, paper: true, message: msg }),
    }, token);
    return `🎲 market  ${side.toUpperCase()} ${symbol} ${timeframe} $${amount}`;
  } else {
    // Sweep the book (taker)
    const sweepMsg = side === "short" ? pick(MESSAGES_SHORT) : pick(MESSAGES_LONG);
    const result: any = await req("/orders/sweep", {
      method: "POST",
      body: JSON.stringify({ symbol, chain, timeframe, side, amount, is_paper: true, message: sweepMsg }),
    }, token);
    return `⚡ sweep   ${side.toUpperCase()} ${symbol} ${timeframe} $${result.filled_amount ?? 0} filled`;
  }
}

async function botLoop(bot: { username: string; password: string }, endAt: number) {
  let token: string;
  try {
    token = await registerOrLogin(bot.username, bot.password);
    await req("/auth/paper-credit", { method: "POST", body: JSON.stringify({ amount: 2000 }) }, token).catch(() => {});
  } catch (e: any) {
    console.error(`[${bot.username}] login failed: ${e.message}`);
    return;
  }

  // Stagger initial start: each bot waits 0-5 min before first action
  const initialDelay = Math.floor(Math.random() * 5 * 60 * 1000);
  await sleep(Math.min(initialDelay, endAt - Date.now()));

  while (Date.now() < endAt) {
    try {
      const action = await doAction(token);
      console.log(`  [${bot.username}] ${action}`);
    } catch (e: any) {
      // silently skip (insufficient balance, no liquidity, etc.)
    }
    // Each bot waits 4-7 min between actions — relaxed pace, ~3-5 bots active per window
    const wait = 4 * 60 * 1000 + Math.floor(Math.random() * 3 * 60 * 1000);
    await sleep(Math.min(wait, endAt - Date.now()));
  }
}

async function main() {
  const endAt = Date.now() + DURATION_MS;
  console.log(`\n🤖 FUD.markets live bot simulation`);
  console.log(`   target:  ${BASE}`);
  console.log(`   bots:    ${BOTS.length}`);
  console.log(`   runtime: 4 hours (~3-5 bots active per 5-min window)\n`);

  // Login all bots first
  console.log("Logging in all bots...");
  const loops = BOTS.map(bot => botLoop(bot, endAt));

  // Stagger starts slightly so they don't all hit at once
  await Promise.all(loops);

  console.log("\n✅ 4 hours done.\n");
}

main().catch(console.error);
