// Withdrawal processor
// Sends pending withdrawals from the central treasury wallets.
// EVM treasury: EVM_TREASURY_PRIVATE_KEY
// SOL treasury: SOL_TREASURY_PRIVATE_KEY

import { db } from "../db/client.js";
import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, createTransferCheckedInstruction,
  getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

const USDC_BASE     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_SOL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

const USDC_ABI = [{
  name: "transfer",
  type: "function",
  inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }],
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

async function sendEvmFromTreasury(toAddress: string, amountUsd: number): Promise<string> {
  const privKey = process.env.EVM_TREASURY_PRIVATE_KEY as `0x${string}`;
  if (!privKey) throw new Error("EVM_TREASURY_PRIVATE_KEY not set");

  const account = privateKeyToAccount(privKey);
  const walletClient = createWalletClient({
    account, chain: base,
    transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
  });

  const amount = parseUnits(amountUsd.toString(), USDC_DECIMALS);
  const hash = await walletClient.writeContract({
    address: USDC_BASE,
    abi: USDC_ABI,
    functionName: "transfer",
    args: [toAddress as `0x${string}`, amount],
  });

  await basePublicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function sendSolFromTreasury(toAddress: string, amountUsd: number): Promise<string> {
  const privKey = process.env.SOL_TREASURY_PRIVATE_KEY;
  if (!privKey) throw new Error("SOL_TREASURY_PRIVATE_KEY not set");

  const treasuryKeypair = Keypair.fromSecretKey(bs58.decode(privKey));
  const mintPubkey  = new PublicKey(USDC_SOL_MINT);
  const toPubkey    = new PublicKey(toAddress);

  const fromAta = getAssociatedTokenAddressSync(mintPubkey, treasuryKeypair.publicKey);
  const toAta   = await getOrCreateAssociatedTokenAccount(
    solClient, treasuryKeypair, mintPubkey, toPubkey
  );

  const amount = BigInt(Math.round(amountUsd * 1_000_000));
  const ix = createTransferCheckedInstruction(
    fromAta, mintPubkey, toAta.address,
    treasuryKeypair.publicKey, amount, USDC_DECIMALS,
    [], TOKEN_PROGRAM_ID,
  );

  const { blockhash } = await solClient.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: treasuryKeypair.publicKey });
  tx.add(ix);

  const sig = await sendAndConfirmTransaction(solClient, tx, [treasuryKeypair]);
  return sig;
}

export async function processPendingWithdrawals() {
  const evmKey = process.env.EVM_TREASURY_PRIVATE_KEY;
  const solKey = process.env.SOL_TREASURY_PRIVATE_KEY;
  if (!evmKey && !solKey) return;

  const { rows: pending } = await db.query(
    `SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY requested_at LIMIT 10`
  );

  for (const w of pending as any[]) {
    try {
      let txHash: string;

      if (w.chain === "base") {
        if (!evmKey) { console.warn(`[withdrawal] EVM_TREASURY_PRIVATE_KEY not set`); continue; }
        txHash = await sendEvmFromTreasury(w.to_address, parseFloat(w.amount_usd));
      } else if (w.chain === "sol") {
        if (!solKey) { console.warn(`[withdrawal] SOL_TREASURY_PRIVATE_KEY not set`); continue; }
        txHash = await sendSolFromTreasury(w.to_address, parseFloat(w.amount_usd));
      } else {
        continue;
      }

      await db.query(
        `UPDATE withdrawals SET status = 'processed', tx_hash = $1, processed_at = NOW() WHERE id = $2`,
        [txHash, w.id]
      );
      console.log(`[withdrawal] Processed $${w.amount_usd} ${w.chain} to ${w.to_address} — tx: ${txHash}`);
    } catch (err: any) {
      console.error(`[withdrawal] Failed ${w.id}:`, err.message);
    }
  }
}
