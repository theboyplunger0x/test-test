// Deposit auto-detection poller
// Polls Base (via eth_getLogs) and Solana (via getSignaturesForAddress) for
// incoming USDC transfers to each user's unique HD deposit address.

import { db } from "../db/client.js";
import { createPublicClient, http, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const USDC_BASE     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SOL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const baseClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

const solClient = new Connection(
  process.env.SOL_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  "confirmed"
);

let lastBaseBlock: bigint | null = null;
const seenSolSigs = new Set<string>();

async function creditDeposit(userId: string, chain: "base" | "sol", txHash: string, amountUsd: number) {
  const { rows: dup } = await db.query(`SELECT id FROM deposits WHERE tx_hash = $1`, [txHash]);
  if (dup.length > 0) return;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO deposits (user_id, chain, tx_hash, amount_usd, status, confirmed_at)
       VALUES ($1, $2, $3, $4, 'confirmed', NOW())`,
      [userId, chain, txHash, amountUsd]
    );
    await client.query(
      `UPDATE users SET balance_usd = balance_usd + $1 WHERE id = $2`,
      [amountUsd, userId]
    );
    await client.query("COMMIT");
    console.log(`[deposit-poller] Auto-credited $${amountUsd} USDC (${chain}) to user ${userId} — tx: ${txHash}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`[deposit-poller] Error crediting deposit ${txHash}:`, err);
  } finally {
    client.release();
  }
}

async function pollBase() {
  try {
    const { rows: users } = await db.query(
      `SELECT id, deposit_address_evm FROM users WHERE deposit_address_evm IS NOT NULL`
    );
    if (users.length === 0) return;

    const addrToUserId = new Map(users.map((u: any) => [u.deposit_address_evm.toLowerCase(), u.id as string]));

    const currentBlock = await baseClient.getBlockNumber();
    const fromBlock = lastBaseBlock ?? currentBlock - 9n;

    const logs = await baseClient.getLogs({
      address: USDC_BASE as `0x${string}`,
      event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
      fromBlock,
      toBlock: currentBlock,
    });

    lastBaseBlock = currentBlock + 1n;

    for (const log of logs) {
      const txHash = log.transactionHash;
      if (!txHash) continue;
      const to = (log.args.to as string).toLowerCase();
      const userId = addrToUserId.get(to);
      if (!userId) continue;
      const amountUsd = Number(log.args.value as bigint) / 1_000_000;
      if (amountUsd <= 0) continue;
      await creditDeposit(userId, "base", txHash, amountUsd);
    }
  } catch (err) {
    console.error("[deposit-poller] Base poll error:", err);
  }
}

async function pollSolana() {
  try {
    const { rows: users } = await db.query(
      `SELECT id, deposit_address_sol FROM users WHERE deposit_address_sol IS NOT NULL`
    );
    if (users.length === 0) return;

    for (const user of users as any[]) {
      try {
        const ata = getAssociatedTokenAddressSync(
          new PublicKey(USDC_SOL_MINT),
          new PublicKey(user.deposit_address_sol),
        );
        const sigs = await solClient.getSignaturesForAddress(ata, { limit: 20 });

        for (const sigInfo of sigs) {
          const txHash = sigInfo.signature;
          if (seenSolSigs.has(txHash)) continue;
          seenSolSigs.add(txHash);
          if (seenSolSigs.size > 2000) seenSolSigs.delete(seenSolSigs.values().next().value!);

          const { rows: dup } = await db.query(`SELECT id FROM deposits WHERE tx_hash = $1`, [txHash]);
          if (dup.length > 0) continue;

          const tx = await solClient.getParsedTransaction(txHash, { maxSupportedTransactionVersion: 0 });
          if (!tx) continue;

          for (const ix of tx.transaction.message.instructions as any[]) {
            const parsed = ix.parsed;
            if (!parsed) continue;
            if (
              (parsed.type === "transfer" || parsed.type === "transferChecked") &&
              parsed.info?.mint === USDC_SOL_MINT &&
              parsed.info?.destination === ata.toBase58()
            ) {
              const amountUsd: number =
                parsed.info.tokenAmount?.uiAmount ?? Number(parsed.info.amount) / 1_000_000;
              if (amountUsd <= 0) continue;
              await creditDeposit(user.id, "sol", txHash, amountUsd);
            }
          }
        }
      } catch (err) {
        console.error(`[deposit-poller] Solana error for ${user.deposit_address_sol}:`, err);
      }
    }
  } catch (err) {
    console.error("[deposit-poller] Solana poll error:", err);
  }
}

export async function pollDeposits() {
  await Promise.allSettled([pollBase(), pollSolana()]);
}
