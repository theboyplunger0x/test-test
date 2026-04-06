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

    // Deploy escrow contract
    const depositWei = BigInt(Math.floor(amount * 1e18));

    try {
      const { contractAddress, deployHash } = await (await getEscrowService()).deployEscrow({
        symbol: symbol.toUpperCase(),
        dexUrl,
        timeframe,
        entryPrice,
        sideA: side,
        partyA: userRow.wallet_address,
        depositA: depositWei,
      });

      // Store in DB for tracking
      await db.query(`
        INSERT INTO escrow_bets
          (contract_address, deploy_hash, symbol, chain, ca, timeframe, entry_price,
           side_a, party_a_id, party_a_wallet, deposit_a, tagline, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'waiting')
        `, [
        contractAddress, deployHash, symbol.toUpperCase(), chain.toUpperCase(), ca,
        timeframe, entryPrice, side, user.userId, userRow.wallet_address,
        amount, tagline ?? "",
      ]);

      return reply.status(201).send({
        contract_address: contractAddress,
        deploy_hash: deployHash,
        entry_price: entryPrice,
        symbol: symbol.toUpperCase(),
        timeframe,
        side,
        deposit_a: amount,
      });
    } catch (err: any) {
      console.error("[escrow] Deploy failed:", err);
      return reply.status(500).send({ error: `Deploy failed: ${err.message}` });
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
