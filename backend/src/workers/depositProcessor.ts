/**
 * Deposit processor — polls for USDC transfers to any user's Main Wallet
 * and calls depositFor() to credit their balance in the vault.
 *
 * Flow:
 * 1. User sends USDC to their Main Wallet (embedded wallet address)
 * 2. This poller detects the Transfer event
 * 3. Matches the recipient address to a FUD user's main_wallet_address
 * 4. Operator approves USDC and calls depositFor(mainWallet, amount) on vault
 * 5. User's vault balance updates automatically
 *
 * Each user has their own unique deposit address (their Main Wallet).
 * No ambiguity about who deposited.
 */
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { db } from "../db/client.js";
import { depositForOnChain } from "../services/vaultService.js";

const RPC_URL = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

let lastProcessedBlock = 0n;

export async function processDeposits() {
  try {
    const currentBlock = await client.getBlockNumber();
    if (lastProcessedBlock === 0n) {
      lastProcessedBlock = currentBlock - 50n;
    }
    if (currentBlock <= lastProcessedBlock) return;

    // Get all Main Wallet addresses from DB
    const { rows: users } = await db.query(
      `SELECT id, username, wallet_address FROM users WHERE wallet_address IS NOT NULL`
    );
    if (users.length === 0) { lastProcessedBlock = currentBlock; return; }

    const mainWallets = new Map<string, { id: string; username: string }>();
    for (const u of users) {
      mainWallets.set(u.wallet_address.toLowerCase(), { id: u.id, username: u.username });
    }

    // Poll all USDC Transfer events in the block range
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

      // Check if the recipient is a user's Main Wallet
      const user = mainWallets.get(to);
      if (!user) continue;

      // Skip if already processed
      const { rows: [existing] } = await db.query(
        `SELECT id FROM deposit_events WHERE tx_hash = $1`, [txHash]
      );
      if (existing) continue;

      // Skip self-transfers (e.g. vault operations)
      if (from === to) continue;

      console.log(`[deposit-processor] Detected ${Number(value) / 1e6} USDC → ${user.username} (${to.slice(0, 10)}...)`);

      try {
        // Operator calls depositFor to credit the user's Main Wallet in the vault
        // Note: operator needs USDC + approval. The USDC sits in the user's Main Wallet,
        // so we first need to transfer it to the operator, then depositFor.
        // For MVP: the operator maintains a USDC balance and mirrors deposits.
        const depositTx = await depositForOnChain(to as Address, value);
        console.log(`[deposit-processor] Credited ${user.username}: ${Number(value) / 1e6} USDC, TX: ${depositTx}`);

        await db.query(
          `INSERT INTO deposit_events (user_id, from_address, to_main_wallet_address, token_address, amount, tx_hash, block_number, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'credited')
           ON CONFLICT (tx_hash) DO NOTHING`,
          [user.id, from, to, USDC_ADDRESS, Number(value) / 1e6, txHash, Number(log.blockNumber)]
        );
      } catch (e: any) {
        console.error(`[deposit-processor] Failed to credit ${user.username}:`, e.shortMessage ?? e.message);
        // Record as detected but not credited
        await db.query(
          `INSERT INTO deposit_events (user_id, from_address, to_main_wallet_address, token_address, amount, tx_hash, block_number, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'detected')
           ON CONFLICT (tx_hash) DO NOTHING`,
          [user.id, from, to, USDC_ADDRESS, Number(value) / 1e6, txHash, Number(log.blockNumber)]
        );
      }
    }

    lastProcessedBlock = currentBlock;
  } catch (e: any) {
    console.error("[deposit-processor] Poll error:", e.message);
  }
}

export function startDepositProcessor(intervalMs = 15_000) {
  console.log("[deposit-processor] Starting — watching all Main Wallets for USDC deposits");
  setInterval(processDeposits, intervalMs);
  processDeposits();
}
