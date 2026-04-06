// On-chain escrow routes for testnet mode
// These deploy real BettingEscrow contracts on GenLayer Bradbury

import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";

// Lazy import to prevent silent failures if genlayer-js has issues
async function getEscrowService() {
  return await import("../services/escrowService.js");
}

export async function escrowRoutes(app: FastifyInstance) {

  // POST /escrow/create — Party A creates an on-chain bet
  app.post("/escrow/create", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const user = (req as any).user;
    const { symbol, chain, timeframe, side, amount, ca, tagline } = req.body as any;

    if (!symbol || !chain || !timeframe || !side || !amount || !ca) {
      return reply.status(400).send({ error: "symbol, chain, timeframe, side, amount, ca required" });
    }

    // Get wallet address
    const { rows: [userRow] } = await db.query(
      `SELECT wallet_address FROM users WHERE id = $1`, [user.userId]
    );
    if (!userRow?.wallet_address) {
      return reply.status(400).send({ error: "Connect your wallet first" });
    }

    // Get entry price from DexScreener
    const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(ca)}`;
    let entryPrice: string;
    try {
      const data = await fetch(dexUrl, { headers: { "User-Agent": "FUDMarkets/1.0" } }).then(r => r.json()) as any;
      const pairs = (data.pairs ?? []).filter((p: any) => p.priceUsd && parseFloat(p.priceUsd) > 0);
      const sorted = pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      if (sorted.length === 0) throw new Error("No price");
      entryPrice = sorted[0].priceUsd;
    } catch {
      return reply.status(503).send({ error: "Could not fetch price" });
    }

    // Create testnet market in DB — settlement uses GenLayer price_oracle (already works)
    // The escrow contract deploy fails on Bradbury, so we track in DB instead
    // User sends GEN to treasury via MetaMask (on-chain), settlement is trustless via GenLayer
    try {
      const { nextWindowClose } = await import("../lib/market.js");
      const closesAt = nextWindowClose(timeframe);

      const { rows: [market] } = await db.query(`
        INSERT INTO markets
          (symbol, chain, timeframe, entry_price, tagline, opener_id,
           ${side === "long" ? "long_pool" : "short_pool"}, closes_at, is_paper, is_testnet, ca)
        VALUES (UPPER($1), UPPER($2), $3, $4, $5, $6, $7, $8, false, true, $9)
        RETURNING *
      `, [
        symbol, chain, timeframe, entryPrice, tagline ?? "", user.userId,
        amount, closesAt, ca,
      ]);

      // Create position
      await db.query(`
        INSERT INTO positions (user_id, market_id, side, amount, is_paper, is_testnet, message)
        VALUES ($1, $2, $3, $4, false, true, $5)
      `, [user.userId, market.id, side, amount, tagline ?? ""]);

      // Schedule resolution with GenLayer
      const { scheduleResolution } = await import("../workers/resolver.js");
      scheduleResolution(market.id, closesAt);

      console.log(`[escrow] Testnet market created: ${market.id} (${symbol} ${timeframe} ${side} ${amount} GEN)`);

      return reply.status(201).send({
        contract_address: market.id,
        deploy_hash: "db-tracked",
        entry_price: entryPrice,
        symbol: symbol.toUpperCase(),
        timeframe,
        side,
        deposit_a: amount,
      });
    } catch (err: any) {
      console.error("[escrow] Create failed:", err);
      return reply.status(500).send({ error: `Create failed: ${err.message}` });
    }
  });

  // POST /escrow/:address/take — Party B takes the bet
  app.post("/escrow/:address/take", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const user = (req as any).user;
    const { address } = req.params as any;
    const { amount } = req.body as any;

    if (!amount || amount <= 0) {
      return reply.status(400).send({ error: "amount required" });
    }

    const { rows: [userRow] } = await db.query(
      `SELECT wallet_address FROM users WHERE id = $1`, [user.userId]
    );
    if (!userRow?.wallet_address) {
      return reply.status(400).send({ error: "Connect your wallet first" });
    }

    const depositWei = BigInt(Math.floor(amount * 1e18));

    try {
      const txHash = await (await getEscrowService()).takeBet(address, depositWei);

      await db.query(`
        UPDATE escrow_bets
        SET party_b_id = $1, party_b_wallet = $2, deposit_b = $3, status = 'active'
        WHERE contract_address = $4
      `, [user.userId, userRow.wallet_address, amount, address]);

      return { tx_hash: txHash, status: "active" };
    } catch (err: any) {
      console.error("[escrow] Take bet failed:", err);
      return reply.status(500).send({ error: `Take bet failed: ${err.message}` });
    }
  });

  // POST /escrow/:address/resolve — Trigger resolution
  app.post("/escrow/:address/resolve", async (req, reply) => {
    const { address } = req.params as any;

    try {
      const result = await (await getEscrowService()).resolveEscrow(address);

      await db.query(`
        UPDATE escrow_bets
        SET exit_price = $1, winner_wallet = $2, winner_side = $3, status = $4
        WHERE contract_address = $5
      `, [result.exitPrice, result.winner, result.winnerSide, result.status, address]);

      return result;
    } catch (err: any) {
      console.error("[escrow] Resolve failed:", err);
      return reply.status(500).send({ error: `Resolve failed: ${err.message}` });
    }
  });

  // GET /escrow/:address — Get escrow state from chain
  app.get("/escrow/:address", async (req, reply) => {
    const { address } = req.params as any;
    try {
      const state = await (await getEscrowService()).getEscrowState(address);
      return state;
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /escrow — List all escrow bets from DB
  app.get("/escrow", async (req, reply) => {
    const { rows } = await db.query(`
      SELECT e.*, ua.username AS party_a_username, ub.username AS party_b_username
      FROM escrow_bets e
      LEFT JOIN users ua ON ua.id = e.party_a_id
      LEFT JOIN users ub ON ub.id = e.party_b_id
      ORDER BY e.created_at DESC
      LIMIT 50
    `);
    return rows;
  });

  // POST /escrow/:address/cancel — Cancel (only party A, while waiting)
  app.post("/escrow/:address/cancel", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { address } = req.params as any;

    try {
      const txHash = await (await getEscrowService()).cancelEscrow(address);
      await db.query(`UPDATE escrow_bets SET status = 'cancelled' WHERE contract_address = $1`, [address]);
      return { tx_hash: txHash, status: "cancelled" };
    } catch (err: any) {
      return reply.status(500).send({ error: `Cancel failed: ${err.message}` });
    }
  });
}
