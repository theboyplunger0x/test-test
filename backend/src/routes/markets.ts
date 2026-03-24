import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { getPrice, screenToken } from "../services/oracle.js";
import { nextWindowClose, calcPayout, calcHouseFee, type Timeframe } from "../lib/market.js";
import { scheduleResolution } from "../workers/resolver.js";
import { checkAndUpgradeTier } from "../lib/tier.js";

const VALID_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "12h", "24h"];

export async function marketRoutes(app: FastifyInstance) {

  // GET /markets — list open + recently resolved markets, optionally filter by timeframe
  app.get("/markets", async (req, reply) => {
    const { timeframe } = req.query as any;
    const base = `SELECT m.*, u.username AS opener_username, u.avatar_url AS opener_avatar, u.tier AS opener_tier
      FROM markets m JOIN users u ON m.opener_id = u.id
      WHERE (m.status = 'open' OR (m.status IN ('resolved','cancelled') AND m.closes_at > NOW() - INTERVAL '24 hours'))`;
    const query = timeframe ? `${base} AND m.timeframe = $1 ORDER BY m.created_at DESC` : `${base} ORDER BY m.created_at DESC`;
    const { rows } = await db.query(query, timeframe ? [timeframe] : []);
    return rows;
  });

  // GET /markets/:id
  app.get("/markets/:id", async (req, reply) => {
    const { id } = req.params as any;
    const { rows } = await db.query(`SELECT * FROM markets WHERE id = $1`, [id]);
    if (!rows[0]) return reply.status(404).send({ error: "Not found" });
    return rows[0];
  });

  // POST /markets — open a new market (authenticated)
  app.post("/markets", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { symbol, chain, timeframe, tagline, paper = false, ca } = req.body as any;
    const user = (req as any).user;

    if (!VALID_TIMEFRAMES.includes(timeframe)) {
      return reply.status(400).send({ error: "Invalid timeframe" });
    }

    // Screen new tokens — skip if token already exists in the system OR no CA provided (curated list)
    if (ca) {
      const { rows: existing } = await db.query(
        `SELECT id FROM markets WHERE UPPER(symbol) = $1 AND UPPER(chain) = $2 LIMIT 1`,
        [symbol.toUpperCase(), chain.toUpperCase()]
      );
      if (existing.length === 0) {
        const screen = await screenToken(ca);
        if (!screen.ok) {
          return reply.status(422).send({ error: screen.reason });
        }
      }
    }

    let entryPrice: number;
    try {
      entryPrice = await getPrice(symbol, chain);
    } catch (e: any) {
      return reply.status(503).send({ error: `Could not fetch price for ${symbol}: ${e.message}` });
    }

    const closesAt = nextWindowClose(timeframe as Timeframe);

    const { rows } = await db.query(
      `INSERT INTO markets (symbol, chain, timeframe, entry_price, tagline, opener_id, closes_at, is_paper)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [symbol.toUpperCase(), chain, timeframe, entryPrice, tagline ?? "", user.userId, closesAt, !!paper]
    );
    const newMarket = rows[0];
    scheduleResolution(newMarket.id, new Date(newMarket.closes_at));
    return reply.status(201).send(newMarket);
  });

  // POST /markets/:id/bet — 30 bets / minute per IP
  app.post("/markets/:id/bet", { preHandler: [(app as any).authenticate], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id }   = req.params as any;
    const { side, amount } = req.body as any;
    const user     = (req as any).user;

    if (!["long", "short"].includes(side)) return reply.status(400).send({ error: "side must be long or short" });
    if (!amount || amount <= 0)            return reply.status(400).send({ error: "amount must be > 0" });

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Fetch market first — is_paper on the market determines which balance to use
      const { rows: [market] } = await client.query(
        `SELECT * FROM markets WHERE id = $1 AND status = 'open' FOR UPDATE`, [id]
      );
      if (!market) return reply.status(404).send({ error: "Market not found or closed" });
      if (new Date() >= new Date(market.closes_at)) {
        return reply.status(400).send({ error: "Market has expired" });
      }

      // Use market's is_paper to pick balance column — clients can't override this
      const isPaper        = !!market.is_paper;
      const balanceCol     = isPaper ? "paper_balance_usd" : "balance_usd";
      const insufficientMsg = isPaper ? "Insufficient paper balance" : "Insufficient balance";

      // Deduct from real or paper balance
      const { rows: [userRow] } = await client.query(
        `UPDATE users SET ${balanceCol} = ${balanceCol} - $1
         WHERE id = $2 AND ${balanceCol} >= $1 RETURNING balance_usd, paper_balance_usd`,
        [amount, user.userId]
      );
      if (!userRow) return reply.status(400).send({ error: insufficientMsg });

      // Update pool
      const poolCol = side === "long" ? "long_pool" : "short_pool";
      await client.query(
        `UPDATE markets SET ${poolCol} = ${poolCol} + $1 WHERE id = $2`, [amount, id]
      );

      // Record position with is_paper matching the market
      const { rows: [position] } = await client.query(
        `INSERT INTO positions (user_id, market_id, side, amount, is_paper) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [user.userId, id, side, amount, isPaper]
      );

      await client.query("COMMIT");

      // Fire-and-forget tier check for real bets
      if (!isPaper) checkAndUpgradeTier(user.userId).catch(() => {});

      // Fire-and-forget: notify followers who subscribed to this user's trades
      if (!isPaper) {
        (async () => {
          try {
            const { rows: followers } = await db.query(
              `SELECT f.follower_id FROM follows f WHERE f.following_id = $1 AND f.notify_trades = true`,
              [user.userId]
            );
            if (followers.length === 0) return;
            const { rows: [trader] } = await db.query(`SELECT username FROM users WHERE id = $1`, [user.userId]);
            const payload = JSON.stringify({
              trader_username: trader?.username ?? user.userId,
              symbol: market.symbol,
              timeframe: market.timeframe,
              side,
              amount,
            });
            for (const f of followers) {
              await db.query(
                `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'followed_trade', $2)`,
                [f.follower_id, payload]
              );
            }
          } catch {}
        })();
      }

      return reply.status(201).send({
        position,
        new_balance:       userRow.balance_usd,
        new_paper_balance: userRow.paper_balance_usd,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /markets/:id/resolve — trigger resolution (admin/cron only in prod)
  app.post("/markets/:id/resolve", async (req, reply) => {
    const { id } = req.params as any;

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const { rows: [market] } = await client.query(
        `SELECT * FROM markets WHERE id = $1 AND status = 'open' FOR UPDATE`, [id]
      );
      if (!market) return reply.status(404).send({ error: "Market not found or already resolved" });
      if (new Date() < new Date(market.closes_at)) {
        return reply.status(400).send({ error: "Market hasn't closed yet" });
      }

      // Fetch exit price from oracle
      const exitPrice  = await getPrice(market.symbol, market.chain);
      const winnerSide = exitPrice > market.entry_price ? "long" : "short";
      const loserSide  = winnerSide === "long" ? "short" : "long";

      const winPool  = parseFloat(market[`${winnerSide}_pool`]);
      const losePool = parseFloat(market[`${loserSide}_pool`]);

      // Mark market resolved
      await client.query(
        `UPDATE markets SET status = 'resolved', exit_price = $1, winner_side = $2 WHERE id = $3`,
        [exitPrice, winnerSide, id]
      );

      // Credit winning positions — respect is_paper on each position
      const { rows: winners } = await client.query(
        `SELECT * FROM positions WHERE market_id = $1 AND side = $2`, [id, winnerSide]
      );
      for (const pos of winners) {
        const payout = calcPayout(parseFloat(pos.amount), winPool, losePool);
        await client.query(
          `UPDATE positions SET payout = $1 WHERE id = $2`, [payout, pos.id]
        );
        const col = pos.is_paper ? "paper_balance_usd" : "balance_usd";
        await client.query(
          `UPDATE users SET ${col} = ${col} + $1 WHERE id = $2`, [payout, pos.user_id]
        );
      }

      // Record house fee
      const fee = calcHouseFee(losePool);
      if (fee > 0) {
        await client.query(
          `INSERT INTO house_revenue (market_id, amount_usd) VALUES ($1, $2)`, [id, fee]
        );
      }

      await client.query("COMMIT");
      return { resolved: true, winner: winnerSide, exit_price: exitPrice, house_fee: fee };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });
}
