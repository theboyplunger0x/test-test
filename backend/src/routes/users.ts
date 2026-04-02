import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";

export async function userRoutes(app: FastifyInstance) {
  // GET /users/search?q=... — search users by username prefix
  app.get("/users/search", async (req) => {
    const { q } = req.query as any;
    if (!q || q.length < 2) return [];
    const { rows } = await db.query(
      `SELECT username, avatar_url, tier FROM users WHERE username ILIKE $1 ORDER BY username LIMIT 8`,
      [`%${q}%`]
    );
    return rows;
  });

  // GET /users/:username — public profile
  app.get("/users/:username", async (req, reply) => {
    const { username } = req.params as any;
    const { rows: [user] } = await db.query(
      `SELECT id, username, avatar_url, bio, tier, created_at, x_username, balance_usd, paper_balance_usd FROM users WHERE username = $1`,
      [username]
    );
    if (!user) return reply.status(404).send({ error: "User not found" });

    const { rows: [counts] } = await db.query(
      `SELECT
        (SELECT COUNT(*)::int FROM follows WHERE following_id = $1) AS follower_count,
        (SELECT COUNT(*)::int FROM follows WHERE follower_id  = $1) AS following_count`,
      [user.id]
    );

    // Total bets = all positions ever; wins/volume = from resolved only
    const { rows: [stats] } = await db.query(
      `SELECT
        (SELECT COUNT(*)::int FROM positions WHERE user_id = $1) AS total_bets,
        COUNT(CASE WHEN m.winner_side = p.side THEN 1 END)::int AS wins,
        COALESCE(SUM(p.amount), 0) AS volume
       FROM positions p
       JOIN markets m ON m.id = p.market_id
       WHERE p.user_id = $1 AND m.status = 'resolved'`,
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
      `SELECT p.side, p.amount, p.placed_at, p.is_paper, m.symbol, m.timeframe, m.status, m.winner_side, m.chain
       FROM positions p
       JOIN markets m ON m.id = p.market_id
       WHERE p.user_id = $1
       ORDER BY p.placed_at DESC
       LIMIT 50`,
      [user.id]
    );

    return {
      username: user.username,
      avatar_url: user.avatar_url,
      bio: user.bio,
      tier: user.tier,
      x_username: user.x_username,
      created_at: user.created_at,
      total_bets: stats?.total_bets ?? 0,
      wins: stats?.wins ?? 0,
      pnl: pnl.toFixed(2),
      volume: volume.toFixed(2),
      balance_usd: user.balance_usd,
      paper_balance_usd: user.paper_balance_usd,
      follower_count: counts?.follower_count ?? 0,
      following_count: counts?.following_count ?? 0,
      recent_trades: recentTrades,
    };
  });
}
