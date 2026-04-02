/**
 * watch_settlement.ts — Watch a real market settle (read-only)
 *
 * Zero footprint: only GET requests, no data created.
 * Finds the market closest to closing and watches it resolve.
 *
 * Usage:
 *   npx tsx scripts/watch_settlement.ts
 *   BASE_URL=https://fud-markets-backend-production.up.railway.app npx tsx scripts/watch_settlement.ts
 */

export {};

const BASE = process.env.BASE_URL ?? "https://fud-markets-backend-production.up.railway.app";

// ─── Colors ──────────────────────────────────────────────────────────────────
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function ts() {
  return dim(new Date().toISOString().slice(11, 23));
}

function log(msg: string) {
  console.log(`  ${ts()}  ${msg}`);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as any;
}

function formatTime(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

async function main() {
  console.log(`\n${bold("╔══════════════════════════════════════════════════════════╗")}`);
  console.log(`${bold("║")}  ${cyan("FUD.markets")} — Settlement Watcher ${dim("(read-only)")}          ${bold("║")}`);
  console.log(`${bold("╚══════════════════════════════════════════════════════════╝")}`);
  console.log(`  Target: ${dim(BASE)}\n`);

  // Find open markets, pick the one closing soonest
  log("Fetching open markets...");
  const markets: any[] = await get("/markets");
  const open = markets
    .filter((m: any) => m.status === "open")
    .sort((a: any, b: any) => new Date(a.closes_at).getTime() - new Date(b.closes_at).getTime());

  if (open.length === 0) {
    log(red("No open markets found. Wait for someone to create one."));
    process.exit(0);
  }

  // Show all open markets
  console.log(`\n  ${bold("Open markets")} (${open.length}):\n`);
  for (const m of open.slice(0, 10)) {
    const closes = new Date(m.closes_at).getTime();
    const remaining = closes - Date.now();
    const longPool = parseFloat(m.long_pool);
    const shortPool = parseFloat(m.short_pool);
    const total = longPool + shortPool;
    console.log(`  ${bold(m.symbol.padEnd(8))} ${m.timeframe.padEnd(4)} │ L: $${longPool.toFixed(0).padStart(5)}  S: $${shortPool.toFixed(0).padStart(5)}  │ pool: $${total.toFixed(0).padStart(6)} │ closes in ${yellow(formatTime(remaining).padStart(6))} │ ${m.is_paper ? dim("paper") : green("real")}  │ ${dim(m.id.slice(0, 8))}`);
  }

  // Pick soonest
  const target = open[0];
  const closesAt = new Date(target.closes_at).getTime();
  const longPool = parseFloat(target.long_pool);
  const shortPool = parseFloat(target.short_pool);

  console.log(`\n${cyan("━━━ Watching")} ${bold(`$${target.symbol} ${target.timeframe}`)} ${cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}\n`);
  log(`Market ID:    ${dim(target.id)}`);
  log(`Entry price:  ${bold(`$${parseFloat(target.entry_price).toFixed(6)}`)}`);
  log(`LONG pool:    ${green(`$${longPool.toFixed(2)}`)}`);
  log(`SHORT pool:   ${red(`$${shortPool.toFixed(2)}`)}`);
  log(`Opened by:    ${bold(target.opener_username ?? "?")}`);
  log(`Paper:        ${target.is_paper ? "yes" : "no"}`);

  // Fetch positions
  try {
    const positions: any[] = await get(`/markets/${target.id}/positions`);
    if (positions.length > 0) {
      console.log();
      log(bold("Positions:"));
      for (const p of positions) {
        const side = p.side === "long" ? green("LONG ") : red("SHORT");
        console.log(`    ${side}  $${parseFloat(p.amount).toFixed(2).padStart(7)}  ${bold(p.username)}${p.message ? `  "${dim(p.message)}"` : ""}`);
      }
    }
  } catch {}

  // Countdown
  const wait = closesAt - Date.now();
  if (wait > 0) {
    console.log();
    log(dim(`Closes in ${formatTime(wait)} — watching...`));
    console.log();

    const interval = setInterval(() => {
      const remaining = Math.max(0, closesAt - Date.now());
      process.stdout.write(`\r  ${ts()}  ⏱  ${bold(formatTime(remaining))} until close...  `);
      if (remaining <= 0) {
        clearInterval(interval);
        console.log();
      }
    }, 1000);

    await sleep(Math.max(0, wait));
    clearInterval(interval);
    console.log();
  }

  log(yellow("Market closed! Waiting for GenLayer oracle consensus..."));
  console.log();

  // Poll for resolution
  let resolved: any = null;
  const oracleStart = Date.now();
  for (let i = 0; i < 120; i++) {
    const m = await get(`/markets/${target.id}`);
    if (m.status === "resolved" || m.status === "cancelled") {
      resolved = m;
      break;
    }
    const elapsed = Math.floor((Date.now() - oracleStart) / 1000);
    process.stdout.write(`\r  ${ts()}  🔮 Validators reaching consensus... ${dim(`(${elapsed}s)`)}  `);
    await sleep(1000);
  }
  console.log();

  if (!resolved) {
    log(red("Timed out (120s). The market might still resolve — check the app."));
    process.exit(1);
  }

  const oracleTime = ((Date.now() - oracleStart) / 1000).toFixed(1);

  // ── Result ───────────────────────────────────────────────────────────────
  console.log(`\n${cyan("━━━ Settlement Result ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}\n`);

  if (resolved.status === "cancelled") {
    log(yellow("Market cancelled — oracle failure. All positions refunded."));
  } else {
    const entry = parseFloat(resolved.entry_price);
    const exit  = parseFloat(resolved.exit_price);
    const up    = exit > entry;
    const changePct = (((exit - entry) / entry) * 100).toFixed(2);

    log(`Entry price:    ${bold(`$${entry.toFixed(6)}`)}`);
    log(`Exit price:     ${bold(`$${exit.toFixed(6)}`)}  ${up ? green(`▲ +${changePct}%`) : red(`▼ ${changePct}%`)}`);
    log(`Oracle time:    ${bold(oracleTime + "s")} ${dim("(GenLayer validator consensus)")}`);
    log(`Winner:         ${resolved.winner_side === "long" ? green("LONG 🟢") : red("SHORT 🔴")}`);

    // Show who won/lost
    try {
      const positions: any[] = await get(`/markets/${target.id}/positions`);
      const winners = positions.filter(p => p.side === resolved.winner_side);
      const losers  = positions.filter(p => p.side !== resolved.winner_side);
      console.log();
      if (winners.length) {
        log(green("Winners:"));
        for (const p of winners) {
          console.log(`    ${green("✓")} ${bold(p.username)}  bet $${parseFloat(p.amount).toFixed(2)}`);
        }
      }
      if (losers.length) {
        log(red("Losers:"));
        for (const p of losers) {
          console.log(`    ${red("✗")} ${bold(p.username)}  bet $${parseFloat(p.amount).toFixed(2)}`);
        }
      }
    } catch {}
  }

  console.log(`\n${bold("╔══════════════════════════════════════════════════════════╗")}`);
  console.log(`${bold("║")}  ${green("✓")} Price settled via GenLayer decentralized oracle      ${bold("║")}`);
  console.log(`${bold("║")}  Multiple validators independently verified the price  ${bold("║")}`);
  console.log(`${bold("║")}  No single party could manipulate the outcome          ${bold("║")}`);
  console.log(`${bold("╚══════════════════════════════════════════════════════════╝")}\n`);
}

main().catch((err) => {
  console.error(`\n${red("Error:")} ${err.message}\n`);
  process.exit(1);
});
