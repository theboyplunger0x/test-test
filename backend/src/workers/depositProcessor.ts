/**
 * Deposit processor — polls for USDC transfers to the operator wallet
 * and calls depositFor() to credit the sender's Main Wallet in the vault.
 *
 * Flow:
 * 1. User sends USDC to the operator wallet (deposit address)
 * 2. This poller detects the Transfer event
 * 3. Looks up which FUD user has a wallet matching the sender address
 * 4. Calls depositFor(mainWallet, amount) on the vault
 * 5. User's balance updates
 */
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { db } from "../db/client.js";
import { depositForOnChain } from "../services/vaultService.js";

const RPC_URL = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const OPERATOR_ADDRESS = (process.env.FUDVAULT_OPERATOR_ADDRESS ?? "0xdcf9a51Ac5B4FA48Fd8a5bD1226d0086E126b6dF").toLowerCase() as Address;

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

let lastProcessedBlock = 0n;

/**
 * Check for new USDC transfers to the operator wallet and process them.
 */
export async function processDeposits() {
  try {
    const currentBlock = await client.getBlockNumber();
    if (lastProcessedBlock === 0n) {
      // Start from recent blocks on first run
      lastProcessedBlock = currentBlock - 100n;
    }
    if (currentBlock <= lastProcessedBlock) return;

    const logs = await client.getLogs({
      address: USDC_ADDRESS,
      event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
      fromBlock: lastProcessedBlock + 1n,
      toBlock: currentBlock,
    });

    for (const log of logs) {
      const to = (log.args as any).to?.toLowerCase();
      if (to !== OPERATOR_ADDRESS.toLowerCase()) continue;

      const from = (log.args as any).from?.toLowerCase();
      const value = (log.args as any).value as bigint;
      const txHash = log.transactionHash;

      if (!from || !value || value === 0n) continue;

      // Check if we already processed this tx
      const { rows: [existing] } = await db.query(
        `SELECT id FROM deposit_events WHERE tx_hash = $1`, [txHash]
      );
      if (existing) continue;

      // Find user by wallet address (main_wallet_address or any linked wallet)
      const { rows: [user] } = await db.query(
        `SELECT id, username, wallet_address FROM users
         WHERE LOWER(wallet_address) = $1
         LIMIT 1`,
        [from]
      );

      if (!user || !user.wallet_address) {
        console.log(`[deposit-processor] Unknown sender ${from}, skipping`);
        continue;
      }

      console.log(`[deposit-processor] Detected ${value} USDC from ${from} (user: ${user.username})`);

      try {
        // Operator needs USDC approval to the vault — should be set up at deploy time
        const depositTx = await depositForOnChain(user.wallet_address as Address, value);
        console.log(`[deposit-processor] Credited ${user.username}: ${value} USDC, TX: ${depositTx}`);

        // Record in DB
        await db.query(
          `INSERT INTO deposit_events (user_id, from_address, to_main_wallet_address, token_address, amount, tx_hash, block_number, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'credited')
           ON CONFLICT (tx_hash) DO NOTHING`,
          [user.id, from, user.wallet_address, USDC_ADDRESS, Number(value) / 1e6, txHash, Number(log.blockNumber)]
        );
      } catch (e: any) {
        console.error(`[deposit-processor] Failed to credit ${user.username}:`, e.shortMessage ?? e.message);
      }
    }

    lastProcessedBlock = currentBlock;
  } catch (e: any) {
    console.error("[deposit-processor] Poll error:", e.message);
  }
}

/**
 * Start the deposit processor polling loop.
 */
export function startDepositProcessor(intervalMs = 15_000) {
  console.log("[deposit-processor] Starting deposit processor...");
  setInterval(processDeposits, intervalMs);
  // Run immediately
  processDeposits();
}
