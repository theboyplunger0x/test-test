import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";

export async function leaderboardRoutes(app: FastifyInstance) {
  // GET /leaderboard?period=week|month|all
  app.get("/leaderboard", async (req, reply) => {
    const { period = "week", paper = "false" } = req.query as { period?: string; paper?: string };
    const isPaper = paper === "true";

    let dateFilter = "";
    if (period === "week") {
      dateFilter = `AND p.placed_at >= NOW() - INTERVAL '7 days'`;
    } else if (period === "month") {
      dateFilter = `AND p.placed_at >= NOW() - INTERVAL '30 days'`;
    }

    const { rows } = await db.query(
      `SELECT
         u.username,
         u.avatar_url,
         u.bio,
         u.tier,
         COUNT(p.id)::int                                          AS total_bets,
         COUNT(CASE WHEN m.winner_side = p.side THEN 1 END)::int  AS wins,
         ROUND(
           SUM(
             CASE
               WHEN m.winner_side = p.side THEN
                 p.amount * (
                   1 + (
                     CASE WHEN p.side = 'long' THEN m.short_pool ELSE m.long_pool END * 0.95
                   ) / NULLIF(
                     CASE WHEN p.side = 'long' THEN m.long_pool ELSE m.short_pool END, 0
                   )
                 ) - p.amount
               ELSE -p.amount
             END
           )::numeric, 2
         ) AS pnl,
         ROUND(SUM(p.amount)::numeric, 2) AS volume
       FROM positions p
       JOIN markets  m ON p.market_id = m.id
       JOIN users    u ON p.user_id   = u.id
       WHERE m.status = 'resolved'
         AND p.is_paper = $1
         ${dateFilter}
       GROUP BY u.id, u.username, u.avatar_url, u.bio, u.tier
       HAVING COUNT(p.id) >= 1
       ORDER BY pnl DESC
       LIMIT 50`, [isPaper]
    );

    return rows;
  });
}
