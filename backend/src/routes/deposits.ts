import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { createPublicClient, http, verifyMessage } from "viem";
import { base } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { randomBytes } from "crypto";
import { deriveEvmAddress, deriveSolAddress } from "../lib/hdWallet.js";

// ── Nonce store (in-memory, 5min TTL) ─────────────────────────────────────────
const nonceStore = new Map<string, { nonce: string; message: string; expires: number }>();

function nonceKey(address: string, chain: string) {
  return `${address.toLowerCase()}:${chain}`;
}

function pruneNonces() {
  const now = Date.now();
  for (const [k, v] of nonceStore) {
    if (v.expires < now) nonceStore.delete(k);
  }
}

// ── Config ────────────────────────────────────────────────────────────────────
const USDC_BASE        = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SOL_MINT    = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const EVM_TREASURY     = (process.env.EVM_TREASURY_ADDRESS ?? "").toLowerCase();
const SOL_TREASURY     = process.env.SOL_TREASURY_ADDRESS ?? "";

// ── Clients ───────────────────────────────────────────────────────────────────
const baseClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
});

const solClient = new Connection(
  process.env.SOL_RPC_URL ?? "https://api.mainnet-beta.solana.com"
);

// ── Verify helpers ────────────────────────────────────────────────────────────

async function verifyEvmDeposit(txHash: string): Promise<number> {
  const receipt = await baseClient.getTransactionReceipt({
    hash: txHash as `0x${string}`,
  });

  const transferLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === USDC_BASE.toLowerCase() &&
      log.topics[2]?.toLowerCase().includes(EVM_TREASURY.slice(2))
  );

  if (!transferLog) throw new Error("No USDC transfer to EVM treasury found");

  // USDC = 6 decimals
  return Number(BigInt(transferLog.data)) / 1_000_000;
}

async function verifySolDeposit(txSig: string): Promise<number> {
  const tx = await solClient.getParsedTransaction(txSig, {
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) throw new Error("Transaction not found on Solana");

  // Look through all token transfer instructions
  const instructions = tx.transaction.message.instructions as any[];
  for (const ix of instructions) {
    const parsed = ix.parsed;
    if (!parsed) continue;

    // SPL Token transfer
    if (
      (parsed.type === "transfer" || parsed.type === "transferChecked") &&
      parsed.info?.mint === USDC_SOL_MINT &&
      parsed.info?.destination
    ) {
      // Resolve destination — could be a token account, need to check its owner
      try {
        const destPubkey = new PublicKey(parsed.info.destination);
        const accountInfo = await solClient.getParsedAccountInfo(destPubkey);
        const accountData = (accountInfo.value?.data as any)?.parsed?.info;

        if (accountData?.owner === SOL_TREASURY) {
          // Amount in USDC (6 decimals)
          const rawAmount =
            parsed.info.tokenAmount?.uiAmount ?? parsed.info.amount / 1_000_000;
          return typeof rawAmount === "number"
            ? rawAmount
            : Number(rawAmount) / 1_000_000;
        }
      } catch {
        continue;
      }
    }
  }

  throw new Error("No USDC transfer to Solana treasury found in this transaction");
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function depositRoutes(app: FastifyInstance) {

  // POST /deposit/nonce — generate a challenge message for wallet signature verification
  app.post("/deposit/nonce", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { address, chain } = req.body as any;
    if (!address?.trim()) return reply.status(400).send({ error: "address required" });
    if (!["base", "sol"].includes(chain)) return reply.status(400).send({ error: "chain must be 'base' or 'sol'" });

    pruneNonces();
    const nonce   = randomBytes(16).toString("hex");
    const message = `CryptoBets wallet verification\nNonce: ${nonce}\nAddress: ${address.trim().toLowerCase()}`;
    nonceStore.set(nonceKey(address, chain), { nonce, message, expires: Date.now() + 5 * 60 * 1000 });

    return { nonce, message };
  });

  // GET /deposit/address — returns user's unique HD deposit addresses (assigns one if needed)
  app.get("/deposit/address", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const user = (req as any).user;

    const { rows: [userRow] } = await db.query(
      `SELECT deposit_address_evm, deposit_address_sol FROM users WHERE id = $1`,
      [user.userId]
    );

    if (userRow.deposit_address_evm && userRow.deposit_address_sol) {
      return {
        evm: { address: userRow.deposit_address_evm, chain: "Base",   token: "USDC", note: "Send USDC on Base network." },
        sol: { address: userRow.deposit_address_sol,  chain: "Solana", token: "USDC", note: "Send USDC on Solana (native USDC, not bridged)." },
      };
    }

    // Assign new index atomically
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const { rows: [{ next_index }] } = await client.query(
        `SELECT COALESCE(MAX(deposit_index), -1) + 1 AS next_index FROM users WHERE deposit_index IS NOT NULL`
      );

      const evmAddr = deriveEvmAddress(Number(next_index));
      const solAddr = deriveSolAddress(Number(next_index));

      await client.query(
        `UPDATE users SET deposit_index = $1, deposit_address_evm = $2, deposit_address_sol = $3 WHERE id = $4`,
        [next_index, evmAddr, solAddr, user.userId]
      );

      await client.query("COMMIT");
      return {
        evm: { address: evmAddr, chain: "Base",   token: "USDC", note: "Send USDC on Base network." },
        sol: { address: solAddr, chain: "Solana", token: "USDC", note: "Send USDC on Solana (native USDC, not bridged)." },
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /deposit/confirm — user submits tx hash after sending
  // Body: { tx_hash: string, chain: "base" | "sol" }
  app.post("/deposit/confirm", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { tx_hash, chain } = req.body as any;
    const user = (req as any).user;

    if (!tx_hash) return reply.status(400).send({ error: "tx_hash required" });
    if (!["base", "sol"].includes(chain)) {
      return reply.status(400).send({ error: "chain must be 'base' or 'sol'" });
    }

    // Prevent double-processing
    const { rows: existing } = await db.query(
      `SELECT id FROM deposits WHERE tx_hash = $1`, [tx_hash]
    );
    if (existing.length > 0) return reply.status(409).send({ error: "Transaction already processed" });

    // Verify on-chain
    let amountUsd: number;
    try {
      amountUsd = chain === "sol"
        ? await verifySolDeposit(tx_hash)
        : await verifyEvmDeposit(tx_hash);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message ?? "Could not verify transaction" });
    }

    if (amountUsd <= 0) {
      return reply.status(400).send({ error: "Deposit amount must be greater than 0" });
    }

    // Credit user balance
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const { rows: [deposit] } = await client.query(
        `INSERT INTO deposits (user_id, chain, tx_hash, amount_usd, status, confirmed_at)
         VALUES ($1, $2, $3, $4, 'confirmed', NOW()) RETURNING *`,
        [user.userId, chain, tx_hash, amountUsd]
      );

      const { rows: [updatedUser] } = await client.query(
        `UPDATE users SET balance_usd = balance_usd + $1 WHERE id = $2 RETURNING balance_usd`,
        [amountUsd, user.userId]
      );

      await client.query("COMMIT");
      return { deposit, new_balance: updatedUser.balance_usd };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /deposit/initiate — 10 per hour per IP
  app.post("/deposit/initiate", { preHandler: [(app as any).authenticate], config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { from_address, chain, signature } = req.body as any;
    const user = (req as any).user;

    if (!from_address?.trim()) {
      return reply.status(400).send({ error: "from_address required" });
    }
    if (!["base", "sol"].includes(chain)) {
      return reply.status(400).send({ error: "chain must be 'base' or 'sol'" });
    }
    if (!signature) {
      return reply.status(400).send({ error: "signature required" });
    }

    // Verify wallet ownership via signature
    const stored = nonceStore.get(nonceKey(from_address, chain));
    if (!stored || stored.expires < Date.now()) {
      return reply.status(400).send({ error: "Nonce expired or not found. Please try again." });
    }
    try {
      if (chain === "base") {
        const valid = await verifyMessage({
          address:   from_address.trim() as `0x${string}`,
          message:   stored.message,
          signature: signature as `0x${string}`,
        });
        if (!valid) throw new Error("Invalid signature");
      } else {
        // Solana: signature is base64-encoded, public key is base58
        const pubkeyBytes = new PublicKey(from_address.trim()).toBytes();
        const sigBytes    = Buffer.from(signature, "base64");
        const msgBytes    = new TextEncoder().encode(stored.message);
        const valid       = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
        if (!valid) throw new Error("Invalid signature");
      }
    } catch {
      return reply.status(401).send({ error: "Signature verification failed. Make sure you're signing with the correct wallet." });
    }
    nonceStore.delete(nonceKey(from_address, chain)); // consume nonce

    // Block if another user already has this wallet registered as a pending intent
    const { rows: conflict } = await db.query(
      `SELECT id FROM deposit_intents
       WHERE from_address = $1 AND chain = $2 AND status = 'pending' AND expires_at > NOW()
         AND user_id != $3`,
      [from_address.trim().toLowerCase(), chain, user.userId]
    );
    if (conflict.length > 0) {
      return reply.status(409).send({ error: "This wallet is already registered by another user. Try again later or use a different wallet." });
    }

    // Cancel previous pending intents for same user+chain
    await db.query(
      `UPDATE deposit_intents SET status = 'expired'
       WHERE user_id = $1 AND chain = $2 AND status = 'pending'`,
      [user.userId, chain]
    );

    const { rows: [intent] } = await db.query(
      `INSERT INTO deposit_intents (user_id, from_address, chain)
       VALUES ($1, $2, $3) RETURNING id, expires_at`,
      [user.userId, from_address.trim().toLowerCase(), chain]
    );

    const treasury = chain === "base" ? EVM_TREASURY : SOL_TREASURY;
    return {
      intent_id:    intent.id,
      treasury,
      from_address: from_address.trim().toLowerCase(),
      chain,
      expires_at:   intent.expires_at,
      note: "Send USDC from your registered wallet. Detected and credited within ~30s.",
    };
  });

  // GET /deposit/status/:intent_id — poll to check if auto-detected
  app.get("/deposit/status/:intent_id", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { intent_id } = req.params as any;
    const user          = (req as any).user;

    const { rows: [intent] } = await db.query(
      `SELECT di.*, d.amount_usd AS credited_amount
       FROM deposit_intents di
       LEFT JOIN deposits d ON d.id = di.fulfilled_deposit_id
       WHERE di.id = $1 AND di.user_id = $2`,
      [intent_id, user.userId]
    );

    if (!intent) return reply.status(404).send({ error: "Intent not found" });

    if (intent.status === "fulfilled") {
      const { rows: [userRow] } = await db.query(
        `SELECT balance_usd FROM users WHERE id = $1`, [user.userId]
      );
      return {
        status:          "fulfilled",
        credited_amount: intent.credited_amount,
        new_balance:     userRow.balance_usd,
      };
    }

    if (intent.status === "expired" || new Date(intent.expires_at) < new Date()) {
      return { status: "expired" };
    }

    return { status: "pending", expires_at: intent.expires_at };
  });

  // GET /deposit/history
  app.get("/deposit/history", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const user = (req as any).user;
    const { rows } = await db.query(
      `SELECT * FROM deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [user.userId]
    );
    return rows;
  });
}
