import { db } from "../db/client.js";

// Thresholds to automatically reach a tier
export const TIER_THRESHOLDS = {
  pro: { volume_usd: 500,    referrals: 3  },
  top: { volume_usd: 5_000,  referrals: 10 },
};

export type Tier = "" | "basic" | "pro" | "top";

/**
 * Check if a user qualifies for a higher tier based on volume + referral count.
 * Only upgrades, never downgrades. Safe to call after every real bet.
 */
export async function checkAndUpgradeTier(userId: string): Promise<void> {
  const { rows: [row] } = await db.query(
    `SELECT u.tier,
            COALESCE((SELECT SUM(p.amount) FROM positions p WHERE p.user_id = u.id AND p.is_paper = false), 0) AS volume,
            (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.id) AS referrals
     FROM users u WHERE u.id = $1`,
    [userId]
  );
  if (!row) return;

  const volume    = parseFloat(row.volume);
  const referrals = parseInt(row.referrals, 10);
  const current   = row.tier as Tier;

  let newTier: Tier = current;
  if (
    current !== "top" &&
    (volume >= TIER_THRESHOLDS.top.volume_usd || referrals >= TIER_THRESHOLDS.top.referrals)
  ) {
    newTier = "top";
  } else if (
    (current === "" || current === "basic") &&
    (volume >= TIER_THRESHOLDS.pro.volume_usd || referrals >= TIER_THRESHOLDS.pro.referrals)
  ) {
    newTier = "pro";
  }

  if (newTier !== current) {
    await db.query(`UPDATE users SET tier = $1 WHERE id = $2`, [newTier, userId]);
  }
}
