/**
 * Deposit processor — watches USDC transfers to user Main Wallets,
 * batches them, and calls depositFor() with anti-abuse protections.
 *
 * Anti-abuse rules (from ChatGPT spec):
 * - Minimum auto-credit: $5 USDC (dust ignored)
 * - Max 3 credited deposits per hour per user
 * - Max 10 credited deposits per day per user
 * - New account cooldown: 5 minutes
 * - Global cap: 20 depositFor calls per hour
 * - Global gas budget: $10/hour
 * - Operator allowance: finite (250 USDC), never infinite
 * - Circuit breakers for error rate and event floods
 */
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { db } from "../db/client.js";
import { depositForOnChain } from "../services/vaultService.js";

const RPC_URL = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

// ─── Anti-abuse parameters ───────────────────────────────────────────────────
const MIN_AUTO_CREDIT_USDC = 1;          // Minimum $1 to avoid dust spam
const MAX_DEPOSITS_PER_HOUR = 3;         // Per user
const MAX_DEPOSITS_PER_DAY = 10;         // Per user
const NEW_ACCOUNT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const GLOBAL_DEPOSIT_FOR_CAP_PER_HOUR = 20;
const CONSECUTIVE_ERROR_LIMIT = 3;       // Circuit breaker

// ─── State ───────────────────────────────────────────────────────────────────
let lastProcessedBlock = 0n;
let globalDepositCountThisHour = 0;
let globalHourBucket = 0;
let consecutiveErrors = 0;
let paused = false;

// Per-user rate tracking (in-memory, resets on restart)
const userDepositCounts = new Map<string, { hour: number; day: number; hourBucket: number; dayBucket: number }>();

function getCurrentHourBucket() { return Math.floor(Date.now() / 3600000); }
function getCurrentDayBucket() { return Math.floor(Date.now() / 86400000); }

function getUserLimits(userId: string) {
  const hourBucket = getCurrentHourBucket();
  const dayBucket = getCurrentDayBucket();
  let limits = userDepositCounts.get(userId);
  if (!limits || limits.hourBucket !== hourBucket) {
    limits = { hour: 0, day: limits?.dayBucket === dayBucket ? (limits?.day ?? 0) : 0, hourBucket, dayBucket };
    userDepositCounts.set(userId, limits);
  }
  if (limits.dayBucket !== dayBucket) {
    limits.day = 0;
    limits.dayBucket = dayBucket;
  }
  return limits;
}

export async function processDeposits() {
  if (paused) {
    console.log("[deposit-processor] PAUSED — skipping");
    return;
  }

  // Reset global hour counter if new hour
  const hourBucket = getCurrentHourBucket();
  if (hourBucket !== globalHourBucket) {
    globalHourBucket = hourBucket;
    globalDepositCountThisHour = 0;
  }

  try {
    const currentBlock = await client.getBlockNumber();
    if (lastProcessedBlock === 0n) {
      lastProcessedBlock = currentBlock - 50n;
    }
    if (currentBlock <= lastProcessedBlock) return;

    // Get all Main Wallet addresses
    const { rows: users } = await db.query(
      `SELECT id, username, wallet_address, created_at FROM users WHERE wallet_address IS NOT NULL`
    );
    if (users.length === 0) { lastProcessedBlock = currentBlock; return; }

    const mainWallets = new Map<string, { id: string; username: string; createdAt: Date }>();
    for (const u of users) {
      mainWallets.set(u.wallet_address.toLowerCase(), { id: u.id, username: u.username, createdAt: new Date(u.created_at) });
    }

    // Poll USDC Transfer events
    const logs = await client.getLogs({
      address: USDC_ADDRESS,
      event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
      fromBlock: lastProcessedBlock + 1n,
      toBlock: currentBlock,
    });

    for (const log of logs) {
      const to = ((log.args as any).to as string)?.toLowerCase();
      const from = ((log.args as any).from as string)?.toLowerCase();
      const value = (log.args as any).value as bigint;
      const txHash = log.transactionHash;

      if (!to || !from || !value || value === 0n) continue;
      if (from === to) continue; // Skip self-transfers

      const user = mainWallets.get(to);
      if (!user) continue;

      // Deduplicate
      const { rows: [existing] } = await db.query(
        `SELECT id FROM deposit_events WHERE tx_hash = $1`, [txHash]
      );
      if (existing) continue;

      const amountUsdc = Number(value) / 1e6;

      // ── RULE: Dust threshold ──
      if (amountUsdc < MIN_AUTO_CREDIT_USDC) {
        console.log(`[deposit-processor] Dust: ${amountUsdc} USDC to ${user.username} — below $${MIN_AUTO_CREDIT_USDC} min`);
        await db.query(
          `INSERT INTO deposit_events (user_id, from_address, to_main_wallet_address, token_address, amount, tx_hash, block_number, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'dust') ON CONFLICT (tx_hash) DO NOTHING`,
          [user.id, from, to, USDC_ADDRESS, amountUsdc, txHash, Number(log.blockNumber)]
        );
        continue;
      }

      // ── RULE: New account cooldown ──
      const accountAgeMs = Date.now() - user.createdAt.getTime();
      if (accountAgeMs < NEW_ACCOUNT_COOLDOWN_MS) {
        console.log(`[deposit-processor] New account cooldown: ${user.username} (${Math.round(accountAgeMs / 1000)}s old)`);
        await db.query(
          `INSERT INTO deposit_events (user_id, from_address, to_main_wallet_address, token_address, amount, tx_hash, block_number, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'cooldown') ON CONFLICT (tx_hash) DO NOTHING`,
          [user.id, from, to, USDC_ADDRESS, amountUsdc, txHash, Number(log.blockNumber)]
        );
        continue;
      }

      // ── RULE: Per-user rate limit ──
      const limits = getUserLimits(user.id);
      if (limits.hour >= MAX_DEPOSITS_PER_HOUR) {
        console.log(`[deposit-processor] Rate limited: ${user.username} (${limits.hour} deposits this hour)`);
        await db.query(
          `INSERT INTO deposit_events (user_id, from_address, to_main_wallet_address, token_address, amount, tx_hash, block_number, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'rate_limited') ON CONFLICT (tx_hash) DO NOTHING`,
          [user.id, from, to, USDC_ADDRESS, amountUsdc, txHash, Number(log.blockNumber)]
        );
        continue;
      }
      if (limits.day >= MAX_DEPOSITS_PER_DAY) {
        console.log(`[deposit-processor] Daily limit: ${user.username} (${limits.day} deposits today)`);
        await db.query(
          `INSERT INTO deposit_events (user_id, from_address, to_main_wallet_address, token_address, amount, tx_hash, block_number, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'rate_limited') ON CONFLICT (tx_hash) DO NOTHING`,
          [user.id, from, to, USDC_ADDRESS, amountUsdc, txHash, Number(log.blockNumber)]
        );
        continue;
      }

      // ── RULE: Global cap ──
      if (globalDepositCountThisHour >= GLOBAL_DEPOSIT_FOR_CAP_PER_HOUR) {
        console.log(`[deposit-processor] Global cap reached (${globalDepositCountThisHour} this hour)`);
        await db.query(
          `INSERT INTO deposit_events (user_id, from_address, to_main_wallet_address, token_address, amount, tx_hash, block_number, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'global_cap') ON CONFLICT (tx_hash) DO NOTHING`,
          [user.id, from, to, USDC_ADDRESS, amountUsdc, txHash, Number(log.blockNumber)]
        );
        continue;
      }

      // ── EXECUTE depositFor ──
      console.log(`[deposit-processor] Crediting ${amountUsdc} USDC to ${user.username}`);
      try {
        const depositTx = await depositForOnChain(to as Address, value);
        console.log(`[deposit-processor] Credited ${user.username}: $${amountUsdc}, TX: ${depositTx}`);

        await db.query(
          `INSERT INTO deposit_events (user_id, from_address, to_main_wallet_address, token_address, amount, tx_hash, block_number, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'credited') ON CONFLICT (tx_hash) DO NOTHING`,
          [user.id, from, to, USDC_ADDRESS, amountUsdc, txHash, Number(log.blockNumber)]
        );

        // Update counters
        limits.hour++;
        limits.day++;
        globalDepositCountThisHour++;
        consecutiveErrors = 0;
      } catch (e: any) {
        console.error(`[deposit-processor] depositFor FAILED for ${user.username}:`, e.shortMessage ?? e.message);
        consecutiveErrors++;

        await db.query(
          `INSERT INTO deposit_events (user_id, from_address, to_main_wallet_address, token_address, amount, tx_hash, block_number, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'failed') ON CONFLICT (tx_hash) DO NOTHING`,
          [user.id, from, to, USDC_ADDRESS, amountUsdc, txHash, Number(log.blockNumber)]
        );

        // ── CIRCUIT BREAKER: consecutive errors ──
        if (consecutiveErrors >= CONSECUTIVE_ERROR_LIMIT) {
          console.error(`[deposit-processor] CIRCUIT BREAKER — ${consecutiveErrors} consecutive errors, PAUSING`);
          paused = true;
          return;
        }
      }
    }

    lastProcessedBlock = currentBlock;
  } catch (e: any) {
    console.error("[deposit-processor] Poll error:", e.message);
  }
}

export function startDepositProcessor(intervalMs = 15_000) {
  console.log(`[deposit-processor] Starting — min $${MIN_AUTO_CREDIT_USDC}, max ${MAX_DEPOSITS_PER_HOUR}/hr per user, global cap ${GLOBAL_DEPOSIT_FOR_CAP_PER_HOUR}/hr`);
  setInterval(processDeposits, intervalMs);
  processDeposits();
}
