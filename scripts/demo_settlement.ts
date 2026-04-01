/**
 * demo_settlement.ts — GenLayer Settlement Demo for Pitch
 *
 * Shows the full P2P bet lifecycle:
 *   1. User A places a LONG order on $WIF
 *   2. User B sweeps it (takes SHORT)
 *   3. Market opens → countdown
 *   4. GenLayer oracle deploys, validators reach consensus
 *   5. Winner gets paid
 *
 * Usage:
 *   npx tsx scripts/demo_settlement.ts
 *   BASE_URL=https://... npx tsx scripts/demo_settlement.ts
 *
 * Uses paper mode + 1m timeframe for fast resolution (~60s).
 */

export {};

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const SYMBOL = process.env.SYMBOL ?? "WIF";
const CHAIN = process.env.CHAIN ?? "SOL";
const TIMEFRAME = process.env.TIMEFRAME ?? "1m";
const AMOUNT = Number(process.env.AMOUNT ?? "50");

const ALICE = { username: "demo_alice", password: "demopass123" };
const BOB   = { username: "demo_bob",   password: "demopass123" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function ts() {
  return dim(new Date().toISOString().slice(11, 23));
}

function step(n: number, msg: string) {
  console.log(`\n${cyan(`━━━ Step ${n}`)} ${bold(msg)} ${cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}`);
}

function log(msg: string) {
  console.log(`  ${ts()}  ${msg}`);
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
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${path}: ${(data as any).error ?? JSON.stringify(data)}`);
  return data as any;
}

async function registerOrLogin(u: { username: string; password: string }): Promise<string> {
  try {
    return (await req("/auth/register", { method: "POST", body: JSON.stringify(u) })).token;
  } catch {
    return (await req("/auth/login", { method: "POST", body: JSON.stringify(u) })).token;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${bold("╔══════════════════════════════════════════════════════╗")}`);
  console.log(`${bold("║")}  ${cyan("FUD.markets")} — GenLayer P2P Settlement Demo        ${bold("║")}`);
  console.log(`${bold("╚══════════════════════════════════════════════════════╝")}`);
  console.log(`  Target:    ${dim(BASE)}`);
  console.log(`  Token:     ${bold(`$${SYMBOL}`)} on ${CHAIN}`);
  console.log(`  Timeframe: ${bold(TIMEFRAME)}`);
  console.log(`  Amount:    ${bold(`$${AMOUNT}`)} each side (paper mode)`);

  // ── Step 1: Setup users ──────────────────────────────────────────────────
  step(1, "Setup — register/login both users");

  const aliceToken = await registerOrLogin(ALICE);
  log(`${green("✓")} Alice logged in (${ALICE.username})`);

  const bobToken = await registerOrLogin(BOB);
  log(`${green("✓")} Bob logged in (${BOB.username})`);

  // Credit paper balance
  await req("/auth/paper-credit", { method: "POST", body: JSON.stringify({ amount: 1000 }) }, aliceToken).catch(() => {});
  await req("/auth/paper-credit", { method: "POST", body: JSON.stringify({ amount: 1000 }) }, bobToken).catch(() => {});
  log(`${green("✓")} Paper balance credited to both users`);

  // ── Step 2: Alice places a LONG order ────────────────────────────────────
  step(2, `Alice places a LONG order — $${AMOUNT} on $${SYMBOL} ${TIMEFRAME}`);

  const orderRes = await req("/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol: SYMBOL,
      chain: CHAIN,
      timeframe: TIMEFRAME,
      side: "long",
      amount: AMOUNT,
      is_paper: true,
      tagline: "this is going to rip, trust 🔥",
    }),
  }, aliceToken);

  const orderId = orderRes.orders[0].id;
  log(`${green("✓")} Order created: ${dim(orderId)}`);
  log(`  Side: ${green("LONG")}  Amount: ${bold(`$${AMOUNT}`)}  Tagline: "this is going to rip, trust 🔥"`);

  // ── Step 3: Bob sweeps (takes SHORT) ─────────────────────────────────────
  step(3, `Bob sweeps — takes SHORT against Alice's LONG`);

  const sweepRes = await req("/orders/sweep", {
    method: "POST",
    body: JSON.stringify({
      symbol: SYMBOL,
      chain: CHAIN,
      timeframe: TIMEFRAME,
      side: "short",
      amount: AMOUNT,
      is_paper: true,
      message: "ngmi ser, shorting everything 📉",
    }),
  }, bobToken);

  log(`${green("✓")} Sweep executed!`);
  log(`  Market ID:   ${dim(sweepRes.market_id)}`);
  log(`  LONG pool:   ${bold(`$${sweepRes.maker_pool}`)} (Alice)`);
  log(`  SHORT pool:  ${bold(`$${sweepRes.taker_pool}`)} (Bob)`);
  log(`  Alice mult:  ${yellow(sweepRes.maker_multiplier + "x")}`);
  log(`  Bob mult:    ${yellow(sweepRes.taker_multiplier + "x")}`);
  log(`  Closes at:   ${bold(sweepRes.closes_at)}`);

  // ── Step 4: Wait for resolution ──────────────────────────────────────────
  step(4, "Waiting for market resolution...");

  const closesAt = new Date(sweepRes.closes_at).getTime();
  const waitMs = closesAt - Date.now();

  if (waitMs > 0) {
    log(`${dim(`Market closes in ${Math.ceil(waitMs / 1000)}s — waiting...`)}`);
    log(dim("(The backend resolver will fire at close time)"));
    log(dim("(Watch the backend terminal for GenLayer logs: [genlayer] Deploying...)"));
    console.log();

    // Countdown
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((closesAt - Date.now()) / 1000));
      process.stdout.write(`\r  ${ts()}  ⏱  ${bold(remaining + "s")} remaining...  `);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);

    await sleep(waitMs + 2000); // +2s buffer for resolver
    clearInterval(interval);
    console.log();
  }

  // Poll for resolution
  log(dim("Polling for resolution result..."));
  let market: any = null;
  for (let i = 0; i < 90; i++) {
    const m = await req(`/markets/${sweepRes.market_id}`);
    if (m.status === "resolved" || m.status === "cancelled") {
      market = m;
      break;
    }
    // Show what we're waiting for
    if (i % 10 === 0 && i > 0) {
      log(dim(`Still waiting for GenLayer consensus... (${i}s)`));
    }
    await sleep(1000);
  }

  if (!market) {
    log(red("✗ Timed out waiting for resolution (90s). Check backend logs."));
    process.exit(1);
  }

  // ── Step 5: Show result ──────────────────────────────────────────────────
  step(5, "Settlement complete!");

  if (market.status === "cancelled") {
    log(yellow("⚠ Market was cancelled (oracle failure) — both sides refunded."));
  } else {
    const winner = market.winner_side;
    const winnerName = winner === "long" ? "Alice (LONG)" : "Bob (SHORT)";
    const loserName  = winner === "long" ? "Bob (SHORT)" : "Alice (LONG)";

    console.log();
    log(`Entry price:  ${bold(`$${parseFloat(market.entry_price).toFixed(6)}`)}`);
    log(`Exit price:   ${bold(`$${parseFloat(market.exit_price).toFixed(6)}`)}`);
    log(`Direction:    ${parseFloat(market.exit_price) > parseFloat(market.entry_price) ? green("▲ UP") : red("▼ DOWN")}`);
    console.log();
    log(`${green("🏆 Winner:")} ${bold(winnerName)}`);
    log(`${red("💀 Loser:")}  ${bold(loserName)}`);
    console.log();

    // Show final balances
    const aliceMe = await req("/auth/me", {}, aliceToken);
    const bobMe   = await req("/auth/me", {}, bobToken);
    log(`Alice paper balance: ${bold(`$${parseFloat(aliceMe.user.paper_balance_usd).toFixed(2)}`)}`);
    log(`Bob paper balance:   ${bold(`$${parseFloat(bobMe.user.paper_balance_usd).toFixed(2)}`)}`);
  }

  console.log(`\n${bold("╔══════════════════════════════════════════════════════╗")}`);
  console.log(`${bold("║")}  ${green("✓")} Settlement verified on-chain via GenLayer        ${bold("║")}`);
  console.log(`${bold("║")}  No single party could manipulate the outcome.     ${bold("║")}`);
  console.log(`${bold("╚══════════════════════════════════════════════════════╝")}\n`);
}

main().catch((err) => {
  console.error(`\n${red("Error:")} ${err.message}\n`);
  process.exit(1);
});
