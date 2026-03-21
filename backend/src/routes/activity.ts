import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";

export async function activityRoutes(app: FastifyInstance) {
  // GET /activity — last N real bets across all markets (public)
  app.get("/activity", async (req) => {
    const limit = Math.min(Number((req.query as any).limit ?? 40), 100);

    const { rows } = await db.query(
      `SELECT
         p.id,
         p.side,
         p.amount,
         p.placed_at,
         m.symbol,
         m.entry_price,
         m.status,
         u.username
       FROM positions p
       JOIN markets m ON m.id = p.market_id
       JOIN users   u ON u.id = p.user_id
       WHERE p.is_paper = false
       ORDER BY p.placed_at DESC
       LIMIT $1`,
      [limit]
    );

    return rows.map(r => ({
      id:          r.id,
      symbol:      r.symbol,
      side:        r.side,
      amount:      parseFloat(r.amount),
      price:       parseFloat(r.entry_price),
      placed_at:   r.placed_at,
      status:      r.status,
      username:    r.username,
    }));
  });
}
