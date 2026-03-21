// Deposit auto-detection poller
// Watches the EVM and SOL treasury addresses for incoming USDC.
// Matches the sender address to a pending deposit_intent and credits the user.

import { db } from "../db/client.js";
import { createPublicClient, http, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const USDC_BASE     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SOL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const EVM_TREASURY = (process.env.EVM_TREASURY_ADDRESS ?? "").toLowerCase();
const SOL_TREASURY = process.env.SOL_TREASURY_ADDRESS ?? "";

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

// ─── Credit deposit to user ───────────────────────────────────────────────────

async function creditDeposit(
  userId: string,
  intentId: string | null,
  chain: "base" | "sol",
  txHash: string,
  amountUsd: number,
) {
  const { rows: dup } = await db.query(`SELECT id FROM deposits WHERE tx_hash = $1`, [txHash]);
  if (dup.length > 0) return;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows: [deposit] } = await client.query(
      `INSERT INTO deposits (user_id, chain, tx_hash, amount_usd, status, confirmed_at)
       VALUES ($1, $2, $3, $4, 'confirmed', NOW()) RETURNING id`,
      [userId, chain, txHash, amountUsd]
    );

    await client.query(
      `UPDATE users SET balance_usd = balance_usd + $1 WHERE id = $2`,
      [amountUsd, userId]
    );

    if (intentId) {
      await client.query(
        `UPDATE deposit_intents SET status = 'fulfilled', fulfilled_deposit_id = $1 WHERE id = $2`,
        [deposit.id, intentId]
      );
    }

    await client.query("COMMIT");
    console.log(`[deposit-poller] Credited $${amountUsd} USDC (${chain}) to user ${userId} — tx: ${txHash}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`[deposit-poller] Error crediting deposit ${txHash}:`, err);
  } finally {
    client.release();
  }
}

// ─── Match incoming sender to a deposit intent ────────────────────────────────

async function matchIntent(fromAddress: string, chain: string): Promise<{ userId: string; intentId: string } | null> {
  const { rows } = await db.query(
    `SELECT id, user_id FROM deposit_intents
     WHERE from_address = $1 AND chain = $2
       AND status = 'pending' AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [fromAddress.toLowerCase(), chain]
  );
  if (rows.length === 0) return null;
  return { userId: rows[0].user_id, intentId: rows[0].id };
}

// ─── Base (EVM) poller — watches treasury ────────────────────────────────────

async function pollBase() {
  if (!EVM_TREASURY) return;

  try {
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
      if (to !== EVM_TREASURY) continue; // only care about transfers TO treasury

      const from = (log.args.from as string).toLowerCase();
      const amountUsd = Number(log.args.value as bigint) / 1_000_000;
      if (amountUsd <= 0) continue;

      const match = await matchIntent(from, "base");
      if (!match) {
        console.log(`[deposit-poller] No intent found for EVM sender ${from} ($${amountUsd})`);
        continue;
      }

      await creditDeposit(match.userId, match.intentId, "base", txHash, amountUsd);
    }
  } catch (err) {
    console.error("[deposit-poller] Base poll error:", err);
  }
}

// ─── Solana poller — watches treasury ATA ─────────────────────────────────────

async function pollSolana() {
  if (!SOL_TREASURY) return;

  try {
    const mintPubkey    = new PublicKey(USDC_SOL_MINT);
    const treasuryPubkey = new PublicKey(SOL_TREASURY);
    const treasuryAta   = getAssociatedTokenAddressSync(mintPubkey, treasuryPubkey);

    const sigs = await solClient.getSignaturesForAddress(treasuryAta, { limit: 50 });

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
          parsed.info?.destination === treasuryAta.toBase58()
        ) {
          const amountUsd: number =
            parsed.info.tokenAmount?.uiAmount ?? Number(parsed.info.amount) / 1_000_000;
          if (amountUsd <= 0) continue;

          // Sender is the source ATA owner
          const senderAta = parsed.info.source;
          if (!senderAta) continue;

          // Resolve ATA → wallet address
          let senderWallet: string;
          try {
            const info = await solClient.getParsedAccountInfo(new PublicKey(senderAta));
            senderWallet = (info.value?.data as any)?.parsed?.info?.owner;
          } catch { continue; }

          if (!senderWallet) continue;

          const match = await matchIntent(senderWallet, "sol");
          if (!match) {
            console.log(`[deposit-poller] No intent found for SOL sender ${senderWallet} ($${amountUsd})`);
            continue;
          }

          await creditDeposit(match.userId, match.intentId, "sol", txHash, amountUsd);
        }
      }
    }
  } catch (err) {
    console.error("[deposit-poller] Solana poll error:", err);
  }
}

export async function pollDeposits() {
  await Promise.allSettled([pollBase(), pollSolana()]);
}
