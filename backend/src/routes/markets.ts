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
    const base = `SELECT m.*, u.username AS opener_username, u.avatar_url AS opener_avatar, u.tier AS opener_tier,
        COALESCE(MAX(p.placed_at), m.created_at) AS last_bet_at
      FROM markets m
      JOIN users u ON m.opener_id = u.id
      LEFT JOIN positions p ON p.market_id = m.id
      WHERE (m.status = 'open' OR (m.status IN ('resolved','cancelled') AND m.closes_at > NOW() - INTERVAL '4 hours'))`;
    const groupBy = `GROUP BY m.id, u.username, u.avatar_url, u.tier`;
    const order   = `ORDER BY last_bet_at DESC`;
    const query   = timeframe
      ? `${base} AND m.timeframe = $1 ${groupBy} ${order}`
      : `${base} ${groupBy} ${order}`;
    const { rows } = await db.query(query, timeframe ? [timeframe] : []);
    return rows;
  });

  // GET /markets/debates — contested markets with top callers on each side
  app.get("/markets/debates", async (req, reply) => {
    const { paper } = req.query as any;
    const isPaper = paper === "true";
    // Find open markets where both pools > 0 and ratio between 30/70
    const { rows: markets } = await db.query(
      `SELECT m.*, u.username AS opener_username, u.avatar_url AS opener_avatar, u.tier AS opener_tier
       FROM markets m
       JOIN users u ON m.opener_id = u.id
       WHERE m.status = 'open'
         AND m.is_paper = $1
         AND m.long_pool > 0 AND m.short_pool > 0
         AND LEAST(m.long_pool, m.short_pool) / GREATEST(m.long_pool, m.short_pool) >= 0.3
       ORDER BY (m.long_pool + m.short_pool) DESC
       LIMIT 20`,
      [isPaper]
    );
    // For each market, get the top caller on each side (highest amount with a message)
    const debates = [];
    for (const m of markets) {
      const { rows: positions } = await db.query(
        `SELECT p.side, p.amount, p.message, u.username, u.avatar_url
         FROM positions p JOIN users u ON p.user_id = u.id
         WHERE p.market_id = $1 AND p.message IS NOT NULL AND p.message != ''
         ORDER BY p.amount DESC`,
        [m.id]
      );
      const shortCaller = positions.find((p: any) => p.side === "short");
      const longCaller  = positions.find((p: any) => p.side === "long");
      if (!shortCaller || !longCaller) continue; // need both sides with messages
      const total = parseFloat(m.long_pool) + parseFloat(m.short_pool);
      debates.push({
        market: m,
        shortCaller,
        longCaller,
        totalPool: total,
        ratio: parseFloat(m.short_pool) / total,
      });
    }
    return debates;
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
      `INSERT INTO markets (symbol, chain, timeframe, entry_price, tagline, opener_id, closes_at, is_paper, ca)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [symbol.toUpperCase(), chain, timeframe, entryPrice, tagline ?? "", user.userId, closesAt, !!paper, ca ?? null]
    );
    const newMarket = rows[0];
    scheduleResolution(newMarket.id, new Date(newMarket.closes_at));
    return reply.status(201).send(newMarket);
  });

  // POST /markets/:id/bet — 30 bets / minute per IP
  app.post("/markets/:id/bet", { preHandler: [(app as any).authenticate], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id }   = req.params as any;
    const { side, amount, message, faded_position_id } = req.body as any;
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
        `INSERT INTO positions (user_id, market_id, side, amount, is_paper, message, faded_position_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [user.userId, id, side, amount, isPaper, message?.trim() || null, faded_position_id || null]
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

  // GET /markets/:id/positions — positions for a market with user info
  app.get("/markets/:id/positions", async (req, reply) => {
    const { id } = req.params as any;
    const { rows } = await db.query(
      `SELECT p.id, p.side, p.amount, p.message, p.placed_at, p.is_paper,
              u.username, u.avatar_url, u.tier,
              m.opener_id,
              (m.opener_id = p.user_id) AS is_opener
       FROM positions p
       JOIN users u ON p.user_id = u.id
       JOIN markets m ON p.market_id = m.id
       WHERE p.market_id = $1
       ORDER BY p.amount DESC, p.placed_at ASC`,
      [id]
    );
    return rows;
  });

  // GET /tokens/:symbol/feed — all markets + positions for a token symbol
  app.get("/tokens/:symbol/feed", async (req, reply) => {
    const { symbol } = req.params as any;
    const { rows: markets } = await db.query(
      `SELECT m.id, m.timeframe, m.entry_price, m.exit_price, m.status, m.opens_at, m.closes_at,
              m.long_pool, m.short_pool, m.winner_side, m.is_paper, m.tagline,
              m.opener_id, u.username AS opener_username, u.avatar_url AS opener_avatar, u.tier AS opener_tier
       FROM markets m JOIN users u ON m.opener_id = u.id
       WHERE UPPER(m.symbol) = UPPER($1)
         AND (m.status = 'open' OR (m.status = 'resolved' AND m.closes_at > NOW() - INTERVAL '4 hours'))
       ORDER BY m.created_at DESC
       LIMIT 20`,
      [symbol]
    );
    if (markets.length === 0) return { markets: [], positions: [] };

    const marketIds = markets.map((m: any) => m.id);
    const { rows: positions } = await db.query(
      `SELECT p.id, p.market_id, p.side, p.amount, p.message, p.placed_at, p.is_paper,
              u.username, u.avatar_url, u.tier,
              (m.opener_id = p.user_id) AS is_opener
       FROM positions p
       JOIN users u ON p.user_id = u.id
       JOIN markets m ON p.market_id = m.id
       WHERE p.market_id = ANY($1)
       ORDER BY p.amount DESC, p.placed_at ASC`,
      [marketIds]
    );
    return { markets, positions };
  });

  // GET /positions/symbol/:symbol — bid history for a token (open + recent closed)
  app.get("/positions/symbol/:symbol", async (req, reply) => {
    const { symbol } = req.params as any;
    const { paper, username } = req.query as any;
    const isPaper = paper === "true";

    if (username) {
      // caller × token view
      const { rows } = await db.query(
        `SELECT p.id, p.side, p.amount, p.message, p.placed_at, p.is_paper,
                u.username, u.avatar_url, u.tier,
                m.id AS market_id, m.timeframe, m.entry_price, m.exit_price,
                m.status, m.winner_side, m.closes_at,
                (m.opener_id = p.user_id) AS is_opener
         FROM positions p
         JOIN users u ON p.user_id = u.id
         JOIN markets m ON p.market_id = m.id
         WHERE m.symbol ILIKE $1 AND u.username ILIKE $2
         ORDER BY p.placed_at DESC
         LIMIT 50`,
        [symbol, username]
      );
      const total = rows.length;
      const wins  = rows.filter((r: any) => r.winner_side && r.side === r.winner_side).length;
      return { positions: rows, total, wins };
    }

    const { rows } = await db.query(
      `SELECT p.id, p.side, p.amount, p.message, p.placed_at, p.is_paper,
              u.username, u.avatar_url, u.tier,
              m.id AS market_id, m.timeframe, m.status, m.winner_side, m.closes_at,
              (m.opener_id = p.user_id) AS is_opener
       FROM positions p
       JOIN users u ON p.user_id = u.id
       JOIN markets m ON p.market_id = m.id
       WHERE m.symbol ILIKE $1 AND p.is_paper = $2
       ORDER BY p.placed_at DESC
       LIMIT 80`,
      [symbol, isPaper]
    );
    return rows;
  });

  // GET /positions/recent — latest positions with messages for the tape
  app.get("/positions/recent", async (req, reply) => {
    const { paper } = req.query as any;
    const isPaper = paper === "true";
    const { rows } = await db.query(
      `SELECT p.id, p.side, p.amount, p.message, p.placed_at, p.is_paper,
              u.username, u.avatar_url, u.tier,
              m.id AS market_id, m.symbol, m.chain, m.timeframe, m.status,
              m.winner_side, m.closes_at,
              (m.opener_id = p.user_id) AS is_opener
       FROM positions p
       JOIN users u ON p.user_id = u.id
       JOIN markets m ON p.market_id = m.id
       WHERE p.placed_at > NOW() - INTERVAL '4 hours'
         AND p.message IS NOT NULL AND p.message != ''
         AND p.is_paper = $1
       ORDER BY p.placed_at DESC
       LIMIT 60`,
      [isPaper]
    );
    return rows;
  });

}
