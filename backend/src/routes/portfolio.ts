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
                m.long_pool, m.short_pool, m.opener_id
         FROM positions p JOIN markets m ON p.market_id = m.id
         WHERE p.user_id = $1
         ORDER BY p.placed_at DESC LIMIT 100`,
        [user.userId]
      ),
    ]);

    return { balance: userRow?.balance_usd ?? 0, positions };
  });
}
