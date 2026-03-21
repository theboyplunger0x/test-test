// Automatic withdrawal processor
// Finds pending withdrawals and sends USDC on-chain from HD wallet addresses

import { db } from "../db/client.js";
import { createPublicClient, createWalletClient, http, parseUnits, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { Connection, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { deriveEvmPrivateKey, deriveSolKeypair } from "../lib/hdWallet.js";

const USDC_BASE     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_SOL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

const USDC_ABI = [{
  name: "transfer",
  type: "function",
  inputs: [
    { name: "to",    type: "address" },
    { name: "value", type: "uint256" },
  ],
  outputs: [{ type: "bool" }],
}] as const;

const basePublicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

const solClient = new Connection(
  process.env.SOL_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  "confirmed"
);

// ─── EVM: send USDC from HD address ──────────────────────────────────────────

async function sendEvmUsdc(fromIndex: number, toAddress: string, amountUsd: number): Promise<string> {
  const privateKey = deriveEvmPrivateKey(fromIndex);
  const account    = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
  });

  const amount = parseUnits(amountUsd.toString(), USDC_DECIMALS);

  const hash = await walletClient.writeContract({
    address: USDC_BASE,
    abi: USDC_ABI,
    functionName: "transfer",
    args: [toAddress as `0x${string}`, amount],
  });

  // Wait for confirmation
  await basePublicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ─── Solana: send USDC from HD address ───────────────────────────────────────

async function sendSolUsdc(fromIndex: number, toAddress: string, amountUsd: number): Promise<string> {
  const keypair     = deriveSolKeypair(fromIndex);
  const mintPubkey  = new PublicKey(USDC_SOL_MINT);
  const toPubkey    = new PublicKey(toAddress);

  const fromAta = getAssociatedTokenAddressSync(mintPubkey, keypair.publicKey);
  const toAta   = getAssociatedTokenAddressSync(mintPubkey, toPubkey);

  const amount = BigInt(Math.round(amountUsd * 1_000_000));

  const ix = createTransferCheckedInstruction(
    fromAta,
    mintPubkey,
    toAta,
    keypair.publicKey,
    amount,
    USDC_DECIMALS,
    [],
    TOKEN_PROGRAM_ID,
  );

  const { blockhash } = await solClient.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: keypair.publicKey });
  tx.add(ix);
  tx.sign(keypair);

  const sig = await solClient.sendRawTransaction(tx.serialize());
  await solClient.confirmTransaction(sig, "confirmed");
  return sig;
}

// ─── Find which HD index has enough USDC balance ─────────────────────────────

async function findFundedEvmIndex(amountUsd: number): Promise<number | null> {
  const { rows: users } = await db.query(
    `SELECT deposit_index, deposit_address_evm FROM users WHERE deposit_address_evm IS NOT NULL ORDER BY deposit_index`
  );

  const needed = parseUnits(amountUsd.toString(), USDC_DECIMALS);

  for (const u of users as any[]) {
    try {
      const balance = await basePublicClient.readContract({
        address: USDC_BASE,
        abi: [{ name: "balanceOf", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const,
        functionName: "balanceOf",
        args: [u.deposit_address_evm as `0x${string}`],
      });
      if ((balance as bigint) >= needed) return u.deposit_index;
    } catch { continue; }
  }
  return null;
}

async function findFundedSolIndex(amountUsd: number): Promise<number | null> {
  const { rows: users } = await db.query(
    `SELECT deposit_index, deposit_address_sol FROM users WHERE deposit_address_sol IS NOT NULL ORDER BY deposit_index`
  );

  const needed = amountUsd * 1_000_000;

  for (const u of users as any[]) {
    try {
      const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_SOL_MINT), new PublicKey(u.deposit_address_sol));
      const info = await solClient.getTokenAccountBalance(ata);
      if ((info.value.uiAmount ?? 0) >= amountUsd) return u.deposit_index;
    } catch { continue; }
  }
  return null;
}

// ─── Main: process pending withdrawals ───────────────────────────────────────

export async function processPendingWithdrawals() {
  const { rows: pending } = await db.query(
    `SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY requested_at LIMIT 10`
  );

  for (const w of pending as any[]) {
    try {
      let txHash: string;

      if (w.chain === "base") {
        const idx = await findFundedEvmIndex(parseFloat(w.amount_usd));
        if (idx === null) {
          console.warn(`[withdrawal] No funded EVM HD address for withdrawal ${w.id} ($${w.amount_usd})`);
          continue;
        }
        txHash = await sendEvmUsdc(idx, w.to_address, parseFloat(w.amount_usd));
      } else if (w.chain === "sol") {
        const idx = await findFundedSolIndex(parseFloat(w.amount_usd));
        if (idx === null) {
          console.warn(`[withdrawal] No funded SOL HD address for withdrawal ${w.id} ($${w.amount_usd})`);
          continue;
        }
        txHash = await sendSolUsdc(idx, w.to_address, parseFloat(w.amount_usd));
      } else {
        continue;
      }

      await db.query(
        `UPDATE withdrawals SET status = 'processed', tx_hash = $1, processed_at = NOW() WHERE id = $2`,
        [txHash, w.id]
      );
      console.log(`[withdrawal] Processed $${w.amount_usd} ${w.chain} to ${w.to_address} — tx: ${txHash}`);
    } catch (err: any) {
      console.error(`[withdrawal] Failed to process ${w.id}:`, err.message);
    }
  }
}
