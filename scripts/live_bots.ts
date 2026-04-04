/**
 * live_bots.ts
 * Simulates 20 bots trading at a relaxed pace for 4 hours.
 * Each bot acts every 4-7 minutes, staggered so only 2-4 fire at any given time.
 * Usage: BASE_URL=https://fud-markets-backend-production.up.railway.app npx tsx scripts/live_bots.ts
 */

export {};
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const DURATION_MS = process.env.BOT_DURATION === "forever"
  ? Infinity
  : parseInt(process.env.BOT_DURATION ?? String(4 * 60 * 60 * 1000)); // default 4h, "forever" for persistent

const BOTS = [
  { username: "degen_alpha",    password: "botpass123", bio: "full degen. no regrets." },
  { username: "moon_chaser",    password: "botpass123", bio: "chasing pumps since 2021" },
  { username: "rug_detector",   password: "botpass123", bio: "i smell rugs before they pull" },
  { username: "chad_longer",    password: "botpass123", bio: "only longs. bears get rekt." },
  { username: "perma_short",    password: "botpass123", bio: "everything goes to zero eventually" },
  { username: "fud_lord",       password: "botpass123", bio: "spreading fear since day one" },
  { username: "wagmi_bro",      password: "botpass123", bio: "we're all gonna make it ser" },
  { username: "ngmi_guy",       password: "botpass123", bio: "narrator: they did not make it" },
  { username: "apein_hard",     password: "botpass123", bio: "ape first, think never" },
  { username: "exit_liquidity", password: "botpass123", bio: "someone has to hold the bag" },
  { username: "based_gigachad", password: "botpass123", bio: "based and conviction-pilled" },
  { username: "pump_enjoyer",   password: "botpass123", bio: "i enjoy the pump. simple as." },
  { username: "bear_trap",      password: "botpass123", bio: "setting traps since the merge" },
  { username: "solana_maxi",    password: "botpass123", bio: "sol or nothing. fast chain only." },
  { username: "eth_killer",     password: "botpass123", bio: "eth is cooked. prove me wrong." },
  { username: "memecoin_god",   password: "botpass123", bio: "turned $50 into $50k (once)" },
  { username: "liquidation_lv", password: "botpass123", bio: "i live for the liquidation candle" },
  { username: "alpha_leak",     password: "botpass123", bio: "leaking alpha nobody asked for" },
  { username: "paper_hands",    password: "botpass123", bio: "i sell every top. accidentally." },
  { username: "diamond_hands",  password: "botpass123", bio: "never sold. never will. down 90%." },
];

const TOKENS = [
  { symbol: "DOGE",  chain: "SOL", ca: "So11111111111111111111111111111111111111112" }, // wrapped DOGE on SOL
  { symbol: "PEPE",  chain: "ETH", ca: "0x6982508145454ce325ddbe47a25d4ec3d2311933" },
  { symbol: "WIF",   chain: "SOL", ca: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "BONK",  chain: "SOL", ca: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { symbol: "SHIB",  chain: "ETH", ca: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE" },
  { symbol: "SOL",   chain: "SOL", ca: "So11111111111111111111111111111111111111112" },
  { symbol: "BTC",   chain: "ETH", ca: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" }, // WBTC
];

// Weighted timeframes: short TFs get more action, long TFs less
const TIMEFRAMES_WEIGHTED = [
  "5m", "5m", "5m", "5m",     // 40%
  "15m", "15m", "15m",        // 30%
  "1h", "1h",                 // 20%
  "4h",                       // 10%
];
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
  const tok = pick(TOKENS);
  const { symbol, chain, ca } = tok;
  const timeframe = pick(TIMEFRAMES_WEIGHTED);
  const side      = pick(SIDES);
  const amount    = pick(AMOUNTS);
  const roll      = Math.random();

  if (roll < 0.35) {
    // Place limit order (maker)
    const orderMsg = side === "short" ? pick(MESSAGES_SHORT) : pick(MESSAGES_LONG);
    await req("/orders", {
      method: "POST",
      body: JSON.stringify({ symbol, chain, ca, timeframe, side, amount, is_paper: true, auto_reopen: Math.random() > 0.4, tagline: orderMsg }),
    }, token);
    return `📋 limit ${side.toUpperCase()} ${symbol} ${timeframe} $${amount}`;
  } else if (roll < 0.65) {
    // Open market + bet
    const market: any = await req("/markets", {
      method: "POST",
      body: JSON.stringify({ symbol, chain, timeframe, tagline: pick(TAGLINES), paper: true, ca }),
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
      body: JSON.stringify({ symbol, chain, ca, timeframe, side, amount, is_paper: true, message: sweepMsg }),
    }, token);
    return `⚡ sweep   ${side.toUpperCase()} ${symbol} ${timeframe} $${result.filled_amount ?? 0} filled`;
  }
}

async function botLoop(bot: { username: string; password: string }, endAt: number) {
  let token: string;
  try {
    token = await registerOrLogin(bot.username, bot.password);
    await req("/auth/paper-credit", { method: "POST", body: JSON.stringify({ amount: 2000 }) }, token).catch(() => {});
    // Set avatar + bio
    const avatarUrl = `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${bot.username}`;
    await req("/auth/update-profile", { method: "POST", body: JSON.stringify({ avatar_url: avatarUrl, bio: bot.bio ?? "" }) }, token).catch(() => {});
  } catch (e: any) {
    console.error(`[${bot.username}] login failed: ${e.message}`);
    return;
  }

  // First action immediately — no stagger, populate UI fast
  try {
    const action = await doAction(token);
    console.log(`  [${bot.username}] ${action}`);
  } catch {}

  // Small stagger after first action: 5-30s so they don't all hit second action at once
  await sleep(5000 + Math.floor(Math.random() * 25000));

  while (Date.now() < endAt) {
    try {
      const action = await doAction(token);
      console.log(`  [${bot.username}] ${action}`);
    } catch (e: any) {
      // silently skip (insufficient balance, no liquidity, etc.)
    }
    // Each bot waits 4-7 min between actions — relaxed pace
    const wait = 4 * 60 * 1000 + Math.floor(Math.random() * 3 * 60 * 1000);
    await sleep(Math.min(wait, endAt - Date.now()));
  }
}

async function main() {
  const endAt = Date.now() + DURATION_MS;
  console.log(`\n🤖 FUD.markets live bot simulation`);
  console.log(`   target:  ${BASE}`);
  console.log(`   bots:    ${BOTS.length}`);
  console.log(`   runtime: ${DURATION_MS === Infinity ? "forever (persistent)" : `${Math.round(DURATION_MS / 3600000)}h`} (~3-5 bots active per 5-min window)\n`);

  // Login all bots first
  console.log("Logging in all bots...");
  const loops = BOTS.map(bot => botLoop(bot, endAt));

  // Stagger starts slightly so they don't all hit at once
  await Promise.all(loops);

  console.log(`\n✅ ${DURATION_MS === Infinity ? "Bot loop ended" : "Done"}.\n`);
}

main().catch(console.error);
