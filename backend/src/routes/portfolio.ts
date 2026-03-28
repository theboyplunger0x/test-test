import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";

export async function portfolioRoutes(app: FastifyInstance) {

  // GET /portfolio — user balance + open/resolved positions
  app.get("/portfolio", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const user = (req as any).user;

    const [{ rows: [userRow] }, { rows: positions }] = await Promise.all([
      db.query(`SELECT balance_usd FROM users WHERE id = $1`, [user.userId]),
      db.query(
        `SELECT p.*, p.amount AS amount_usd, m.symbol, m.timeframe, m.status AS market_status,
                m.winner_side, m.entry_price, m.exit_price, m.closes_at,
                m.long_pool, m.short_pool, m.opener_id, m.sweep_id
         FROM positions p JOIN markets m ON p.market_id = m.id
         WHERE p.user_id = $1
         ORDER BY p.placed_at DESC LIMIT 100`,
        [user.userId]
      ),
    ]);

    return { balance: userRow?.balance_usd ?? 0, positions };
  });

  // POST /withdraw — 5 per hour (abuse prevention)
  app.post("/withdraw", { preHandler: [(app as any).authenticate], config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { amount, chain, to_address } = req.body as any;
    const user = (req as any).user;

    if (!amount || amount <= 0)  return reply.status(400).send({ error: "amount must be > 0" });
    if (!to_address)             return reply.status(400).send({ error: "to_address required" });
    if (!chain)                  return reply.status(400).send({ error: "chain required" });

    const MIN_WITHDRAWAL = 5;
    if (amount < MIN_WITHDRAWAL) {
      return reply.status(400).send({ error: `Minimum withdrawal is $${MIN_WITHDRAWAL}` });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const { rows: [userRow] } = await client.query(
        `UPDATE users SET balance_usd = balance_usd - $1
         WHERE id = $2 AND balance_usd >= $1 RETURNING balance_usd`,
        [amount, user.userId]
      );
      if (!userRow) return reply.status(400).send({ error: "Insufficient balance" });

      const { rows: [withdrawal] } = await client.query(
        `INSERT INTO withdrawals (user_id, chain, to_address, amount_usd)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [user.userId, chain, to_address, amount]
      );

      await client.query("COMMIT");

      return {
        withdrawal,
        new_balance: userRow.balance_usd,
        note: "Withdrawal queued. Processed within 24h during beta.",
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });
}
