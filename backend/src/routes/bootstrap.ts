/**
 * POST /api/users/bootstrap — unified user creation/sync for Privy auth.
 *
 * Called by the frontend after Privy authenticates. Either creates a new
 * user (with referral, wallet, etc.) or returns the existing one.
 *
 * Replaces the old POST /auth/register + POST /auth/login for Privy flows.
 */
import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import crypto from "crypto";

export async function bootstrapRoutes(app: FastifyInstance) {

  app.post("/api/users/bootstrap", async (req, reply) => {
    const {
      privy_user_id,
      auth_method,
      email,
      wallets,
      referral_code,
    } = req.body as {
      privy_user_id: string;
      auth_method?: string;
      email?: string;
      wallets?: { address: string; type: string; is_embedded?: boolean }[];
      referral_code?: string;
    };

    if (!privy_user_id) {
      return reply.status(400).send({ error: "privy_user_id required" });
    }

    // 1. Check if user already exists
    const { rows: [existing] } = await db.query(
      `SELECT id, username, wallet_address, has_connected_wallet, referral_code, tier
       FROM users WHERE privy_user_id = $1`,
      [privy_user_id]
    );

    if (existing) {
      // Sync wallet if missing and we have one now
      if (!existing.wallet_address && wallets?.length) {
        const primary = wallets.find(w => w.is_embedded) ?? wallets[0];
        const addr = primary.address.toLowerCase();
        // Check uniqueness
        const { rows: [taken] } = await db.query(
          `SELECT id FROM users WHERE wallet_address = $1 AND id != $2`, [addr, existing.id]
        );
        if (!taken) {
          await db.query(
            `UPDATE users SET wallet_address = $1, has_connected_wallet = true WHERE id = $2`,
            [addr, existing.id]
          );
          existing.wallet_address = addr;
        }
      }

      const token = await (app as any).jwt.sign({ userId: existing.id, username: existing.username });
      return {
        token,
        user: existing,
        created: false,
        referral: { applied: false },
      };
    }

    // 2. New user — determine primary wallet
    const primaryWallet = wallets?.length
      ? (wallets.find(w => w.is_embedded) ?? wallets[0]).address.toLowerCase()
      : null;

    // Check wallet uniqueness
    if (primaryWallet) {
      const { rows: [walletTaken] } = await db.query(
        `SELECT id FROM users WHERE wallet_address = $1`, [primaryWallet]
      );
      if (walletTaken) {
        return reply.status(409).send({ error: "This wallet is already linked to another account" });
      }
    }

    // 3. Resolve referral
    let referredBy: string | null = null;
    if (referral_code) {
      const code = String(referral_code).trim().toUpperCase();
      const { rows: [referrer] } = await db.query(
        `SELECT id FROM users WHERE referral_code = $1`, [code]
      );
      if (referrer) {
        referredBy = referrer.id;
      }
      // Invalid code = silently ignore (don't block registration)
    }

    // 4. Generate username + referral code
    const privyShort = privy_user_id.replace("did:privy:", "").slice(0, 8);
    const username = primaryWallet
      ? `${primaryWallet.slice(2, 8).toLowerCase()}`
      : `fud_${privyShort}`;
    // Ensure unique
    let finalUsername = username;
    let suffix = 1;
    while (true) {
      const { rows } = await db.query(`SELECT id FROM users WHERE username = $1`, [finalUsername]);
      if (rows.length === 0) break;
      finalUsername = `${username}_${suffix++}`;
    }

    const refCode = crypto.randomBytes(4).toString("hex").toUpperCase();

    // 5. Create user
    const signupMethod = auth_method ?? "unknown";
    const signupWalletType = wallets?.find(w => w.is_embedded) ? "embedded" : wallets?.length ? "external" : null;

    const { rows: [user] } = await db.query(
      `INSERT INTO users (
        username, email, privy_user_id, wallet_address, has_connected_wallet,
        referral_code, referred_by, tier
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'basic')
      RETURNING id, username, wallet_address, has_connected_wallet, referral_code, tier`,
      [
        finalUsername,
        email?.toLowerCase() ?? null,
        privy_user_id,
        primaryWallet,
        !!primaryWallet,
        refCode,
        referredBy,
      ]
    );

    const token = await (app as any).jwt.sign({ userId: user.id, username: user.username });

    return reply.status(201).send({
      token,
      user,
      created: true,
      referral: {
        applied: !!referredBy,
        code: referral_code?.trim()?.toUpperCase() ?? null,
      },
    });
  });
}
