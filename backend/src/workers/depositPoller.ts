// Deposit auto-detection poller
// Polls Base (via eth_getLogs) and Solana (via getSignaturesForAddress) for
// incoming USDC transfers to each user's unique HD deposit address.
// After crediting, sweeps USDC to treasury so all funds are in one place.

import { db } from "../db/client.js";
import {
  createPublicClient, createWalletClient, http, parseAbiItem,
  parseUnits, encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  Connection, PublicKey, Transaction, SystemProgram, Keypair,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, createTransferCheckedInstruction,
  getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import { deriveEvmPrivateKey, deriveSolKeypair } from "../lib/hdWallet.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const USDC_BASE     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_SOL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

const USDC_ABI = [{
  name: "transfer",
  type: "function",
  inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }],
  outputs: [{ type: "bool" }],
}, {
  name: "balanceOf",
  type: "function",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ type: "uint256" }],
  stateMutability: "view",
}] as const;

// EVM treasury
const EVM_TREASURY = (process.env.EVM_TREASURY_ADDRESS ?? "").toLowerCase() as `0x${string}`;
const EVM_TREASURY_KEY = process.env.EVM_TREASURY_PRIVATE_KEY as `0x${string}` | undefined;

// SOL treasury
const SOL_TREASURY = process.env.SOL_TREASURY_ADDRESS ?? "";
const SOL_TREASURY_KEY = process.env.SOL_TREASURY_PRIVATE_KEY ?? "";

const basePublicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

const solClient = new Connection(
  process.env.SOL_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  "confirmed"
);

// In-memory cursors
let lastBaseBlock: bigint | null = null;
const seenSolSigs = new Set<string>();

// ─── Sweep helpers ────────────────────────────────────────────────────────────

async function sweepEvmToTreasury(hdIndex: number, hdAddress: string): Promise<void> {
  if (!EVM_TREASURY || !EVM_TREASURY_KEY) return;

  try {
    // Check USDC balance on HD address
    const balance = await basePublicClient.readContract({
      address: USDC_BASE,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [hdAddress as `0x${string}`],
    }) as bigint;

    if (balance === 0n) return;

    // Treasury sends micro-ETH to HD address to cover gas for the sweep
    const treasuryAccount = privateKeyToAccount(EVM_TREASURY_KEY);
    const treasuryWallet = createWalletClient({
      account: treasuryAccount,
      chain: base,
      transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
    });

    // Estimate gas needed: ~65k gas * current gas price
    const gasPrice = await basePublicClient.getGasPrice();
    const gasNeeded = 65_000n * gasPrice + gasPrice * 5000n; // buffer

    await treasuryWallet.sendTransaction({
      to: hdAddress as `0x${string}`,
      value: gasNeeded,
    });

    // Small delay for tx to land
    await new Promise(r => setTimeout(r, 4000));

    // HD address sweeps USDC to treasury
    const hdPrivKey = deriveEvmPrivateKey(hdIndex);
    const hdAccount = privateKeyToAccount(hdPrivKey);
    const hdWallet = createWalletClient({
      account: hdAccount,
      chain: base,
      transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
    });

    await hdWallet.writeContract({
      address: USDC_BASE,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [EVM_TREASURY, balance],
    });

    console.log(`[deposit-poller] Swept ${Number(balance) / 1e6} USDC from HD[${hdIndex}] to EVM treasury`);
  } catch (err) {
    console.error(`[deposit-poller] EVM sweep failed for HD[${hdIndex}]:`, err);
  }
}

async function sweepSolToTreasury(hdIndex: number): Promise<void> {
  if (!SOL_TREASURY || !SOL_TREASURY_KEY) return;

  try {
    const hdKeypair = deriveSolKeypair(hdIndex);
    const mintPubkey = new PublicKey(USDC_SOL_MINT);
    const treasuryPubkey = new PublicKey(SOL_TREASURY);

    const hdAta = getAssociatedTokenAddressSync(mintPubkey, hdKeypair.publicKey);

    const tokenBalance = await solClient.getTokenAccountBalance(hdAta).catch(() => null);
    if (!tokenBalance || tokenBalance.value.uiAmount === 0) return;

    const amount = BigInt(tokenBalance.value.amount);

    // Treasury sends SOL to HD address for fees
    const treasuryKeypair = Keypair.fromSecretKey(bs58.decode(SOL_TREASURY_KEY));
    const transferFeeTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasuryKeypair.publicKey,
        toPubkey: hdKeypair.publicKey,
        lamports: 5_000_000, // 0.005 SOL
      })
    );
    await sendAndConfirmTransaction(solClient, transferFeeTx, [treasuryKeypair]);

    // Get or create treasury ATA
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      solClient, treasuryKeypair, mintPubkey, treasuryPubkey
    );

    // Sweep USDC from HD to treasury
    const sweepTx = new Transaction().add(
      createTransferCheckedInstruction(
        hdAta, mintPubkey, treasuryAta.address,
        hdKeypair.publicKey, amount, USDC_DECIMALS,
        [], TOKEN_PROGRAM_ID,
      )
    );
    await sendAndConfirmTransaction(solClient, sweepTx, [hdKeypair]);

    console.log(`[deposit-poller] Swept ${tokenBalance.value.uiAmount} USDC from SOL HD[${hdIndex}] to treasury`);
  } catch (err) {
    console.error(`[deposit-poller] SOL sweep failed for HD[${hdIndex}]:`, err);
  }
}

// ─── Core: credit a detected deposit ─────────────────────────────────────────

async function creditDeposit(
  userId: string,
  chain: "base" | "sol",
  txHash: string,
  amountUsd: number,
  hdIndex: number,
) {
  const { rows: dup } = await db.query(
    `SELECT id FROM deposits WHERE tx_hash = $1`, [txHash]
  );
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
    return;
  } finally {
    client.release();
  }

  // Sweep to treasury after crediting
  if (chain === "base") {
    const { rows: [user] } = await db.query(
      `SELECT deposit_address_evm FROM users WHERE id = $1`, [userId]
    );
    if (user?.deposit_address_evm) {
      sweepEvmToTreasury(hdIndex, user.deposit_address_evm).catch(() => {});
    }
  } else {
    sweepSolToTreasury(hdIndex).catch(() => {});
  }
}

// ─── Base (EVM) poller ────────────────────────────────────────────────────────

async function pollBase() {
  try {
    const { rows: users } = await db.query(
      `SELECT id, deposit_index, deposit_address_evm FROM users WHERE deposit_address_evm IS NOT NULL`
    );
    if (users.length === 0) return;

    const addrToUser = new Map(
      users.map((u: any) => [u.deposit_address_evm.toLowerCase(), u])
    );

    const currentBlock = await basePublicClient.getBlockNumber();
    const fromBlock = lastBaseBlock ?? currentBlock - 9n;

    const logs = await basePublicClient.getLogs({
      address: USDC_BASE,
      event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
      fromBlock,
      toBlock: currentBlock,
    });

    lastBaseBlock = currentBlock + 1n;

    for (const log of logs) {
      const txHash = log.transactionHash;
      if (!txHash) continue;
      const to   = (log.args.to as string).toLowerCase();
      const user = addrToUser.get(to);
      if (!user) continue;
      const amountUsd = Number(log.args.value as bigint) / 1_000_000;
      if (amountUsd <= 0) continue;
      await creditDeposit(user.id, "base", txHash, amountUsd, Number(user.deposit_index));
    }
  } catch (err) {
    console.error("[deposit-poller] Base poll error:", err);
  }
}

// ─── Solana poller ────────────────────────────────────────────────────────────

async function pollSolana() {
  try {
    const { rows: users } = await db.query(
      `SELECT id, deposit_index, deposit_address_sol FROM users WHERE deposit_address_sol IS NOT NULL`
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
              await creditDeposit(user.id, "sol", txHash, amountUsd, Number(user.deposit_index));
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

// ─── Public ───────────────────────────────────────────────────────────────────

export async function pollDeposits() {
  await Promise.allSettled([pollBase(), pollSolana()]);
}
