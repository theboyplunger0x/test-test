import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import crypto from "crypto";

export async function referralRoutes(app: FastifyInstance) {

  // GET /referral — get own referral code + stats
  app.get("/referral", { preHandler: [(app as any).authenticate] }, async (req) => {
    const { userId } = (req as any).user;

    // Ensure user has a referral code (backfill for existing accounts)
    let { rows: [userRow] } = await db.query(
      `SELECT referral_code, tier FROM users WHERE id = $1`, [userId]
    );
    if (!userRow.referral_code) {
      const code = crypto.randomBytes(4).toString("hex").toUpperCase();
      await db.query(`UPDATE users SET referral_code = $1 WHERE id = $2`, [code, userId]);
      userRow.referral_code = code;
    }

    const { rows: [refStats] } = await db.query(
      `SELECT
         COUNT(DISTINCT u.id)           AS referred_count,
         COALESCE(SUM(r.reward_usd), 0) AS total_referral_usd
       FROM users u
       LEFT JOIN referral_rewards r ON r.referrer_id = $1
       WHERE u.referred_by = $1`,
      [userId]
    );

    const { rows: [cbStats] } = await db.query(
      `SELECT
         COALESCE(SUM(reward_usd), 0)                              AS total_cashback_usd,
         COALESCE(SUM(reward_usd) FILTER (WHERE claimed_at IS NULL), 0) AS claimable_cashback_usd
       FROM cashback_rewards WHERE user_id = $1`,
      [userId]
    );

    const { rows: [refClaimable] } = await db.query(
      `SELECT COALESCE(SUM(reward_usd) FILTER (WHERE claimed_at IS NULL), 0) AS claimable_ref_usd
       FROM referral_rewards WHERE referrer_id = $1`,
      [userId]
    );

    const { rows: recent } = await db.query(
      `SELECT r.reward_usd, r.created_at, u.username AS referred_username
       FROM referral_rewards r
       JOIN users u ON u.id = r.referred_id
       WHERE r.referrer_id = $1
       ORDER BY r.created_at DESC LIMIT 10`,
      [userId]
    );

    const frontendUrl = process.env.FRONTEND_URL ?? "https://fudmarkets.vercel.app";
    const tier        = userRow.tier ?? "";
    return {
      code:                 userRow.referral_code,
      link:                 `${frontendUrl}/?ref=${userRow.referral_code}`,
      tier,
      referral_rate:        tier === "elite" ? 0.0125 : tier === "top" ? 0.01 : tier === "pro" || tier === "normal" ? 0.005 : 0.0025,
      cashback_rate:        tier === "elite" ? 0.0125 : tier === "top" ? 0.01 : tier === "pro" || tier === "normal" ? 0.005 : 0.0025,
      referred_count:       Number(refStats.referred_count),
      total_referral_usd:   refStats.total_referral_usd,
      total_cashback_usd:   cbStats.total_cashback_usd,
      claimable_usd:        (parseFloat(cbStats.claimable_cashback_usd) + parseFloat(refClaimable.claimable_ref_usd)).toFixed(6),
      recent_rewards:       recent,
    };
  });

  // POST /referral/claim — credit all pending rewards to balance
  app.post("/referral/claim", { preHandler: [(app as any).authenticate] }, async (req) => {
    const { userId } = (req as any).user;
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const { rows: [cb] } = await client.query(
        `SELECT COALESCE(SUM(reward_usd), 0) AS total FROM cashback_rewards WHERE user_id = $1 AND claimed_at IS NULL`,
        [userId]
      );
      const { rows: [ref] } = await client.query(
        `SELECT COALESCE(SUM(reward_usd), 0) AS total FROM referral_rewards WHERE referrer_id = $1 AND claimed_at IS NULL`,
        [userId]
      );

      const total = parseFloat(cb.total) + parseFloat(ref.total);
      if (total <= 0) { await client.query("COMMIT"); return { claimed_usd: 0 }; }

      await client.query(
        `UPDATE users SET balance_usd = balance_usd + $1 WHERE id = $2`, [total, userId]
      );
      await client.query(
        `UPDATE cashback_rewards SET claimed_at = NOW() WHERE user_id = $1 AND claimed_at IS NULL`, [userId]
      );
      await client.query(
        `UPDATE referral_rewards SET claimed_at = NOW() WHERE referrer_id = $1 AND claimed_at IS NULL`, [userId]
      );
      const { rows: [user] } = await client.query(
        `SELECT balance_usd FROM users WHERE id = $1`, [userId]
      );

      await client.query("COMMIT");
      return { claimed_usd: total.toFixed(6), new_balance: user.balance_usd };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });
}
