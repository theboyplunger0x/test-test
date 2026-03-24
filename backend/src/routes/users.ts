import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";

export async function userRoutes(app: FastifyInstance) {
  // GET /users/:username — public profile
  app.get("/users/:username", async (req, reply) => {
    const { username } = req.params as any;
    const { rows: [user] } = await db.query(
      `SELECT id, username, avatar_url, bio, tier, created_at FROM users WHERE username = $1`,
      [username]
    );
    if (!user) return reply.status(404).send({ error: "User not found" });

    // Stats from non-paper settled positions
    const { rows: [stats] } = await db.query(
      `SELECT
        COUNT(p.id)::int AS total_bets,
        COUNT(CASE WHEN m.winner_side = p.side THEN 1 END)::int AS wins,
        COALESCE(SUM(p.amount), 0) AS volume
       FROM positions p
       JOIN markets m ON m.id = p.market_id
       WHERE p.user_id = $1 AND p.is_paper = false AND m.status = 'resolved'`,
      [user.id]
    );

    // Gross payout from won positions
    const { rows: [payoutRow] } = await db.query(
      `SELECT COALESCE(SUM(
        p.amount * (1 + (CASE WHEN p.side = 'long' THEN m.short_pool ELSE m.long_pool END * 0.95)
          / NULLIF(CASE WHEN p.side = 'long' THEN m.long_pool ELSE m.short_pool END, 0))
      ), 0) AS gross_payout
       FROM positions p
       JOIN markets m ON m.id = p.market_id
       WHERE p.user_id = $1 AND p.is_paper = false AND m.status = 'resolved' AND m.winner_side = p.side`,
      [user.id]
    );

    const grossPayout = parseFloat(payoutRow?.gross_payout ?? "0");
    const volume = parseFloat(stats?.volume ?? "0");
    const pnl = grossPayout - volume;

    // Recent 8 non-paper trades
    const { rows: recentTrades } = await db.query(
      `SELECT p.side, p.amount, p.placed_at, m.symbol, m.timeframe, m.status, m.winner_side, m.chain
       FROM positions p
       JOIN markets m ON m.id = p.market_id
       WHERE p.user_id = $1 AND p.is_paper = false
       ORDER BY p.placed_at DESC
       LIMIT 50`,
      [user.id]
    );

    return {
      username: user.username,
      avatar_url: user.avatar_url,
      bio: user.bio,
      tier: user.tier,
      created_at: user.created_at,
      total_bets: stats?.total_bets ?? 0,
      wins: stats?.wins ?? 0,
      pnl: pnl.toFixed(2),
      volume: volume.toFixed(2),
      recent_trades: recentTrades,
    };
  });
}
