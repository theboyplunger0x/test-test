import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { TwitterApi } from "twitter-api-v2";

// ─── Email transporter (lazy-init) ───────────────────────────────────────────

function getMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function authRoutes(app: FastifyInstance) {

  // POST /auth/register — 10 attempts / 15 min per IP
  app.post("/auth/register", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const { username, password, email } = req.body as any;

    if (!username || !password) {
      return reply.status(400).send({ error: "username and password required" });
    }
    if (username.length < 3) {
      return reply.status(400).send({ error: "Username must be at least 3 characters" });
    }
    if (password.length < 6) {
      return reply.status(400).send({ error: "Password must be at least 6 characters" });
    }

    const { rows: existing } = await db.query(
      `SELECT id FROM users WHERE username = $1`, [username.toLowerCase()]
    );
    if (existing.length > 0) {
      return reply.status(409).send({ error: "Username already taken" });
    }

    if (email) {
      const { rows: emailTaken } = await db.query(
        `SELECT id FROM users WHERE email = $1`, [email.toLowerCase()]
      );
      if (emailTaken.length > 0) {
        return reply.status(409).send({ error: "Email already in use" });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { rows: [user] } = await db.query(
      `INSERT INTO users (username, password_hash, email)
       VALUES ($1, $2, $3)
       RETURNING id, username, balance_usd, paper_balance_usd, created_at`,
      [username.toLowerCase(), passwordHash, email ? email.toLowerCase() : null]
    );

    const token = await (app as any).jwt.sign({ userId: user.id, username: user.username });
    return reply.status(201).send({ token, user });
  });

  // POST /auth/login
  // POST /auth/login — 10 attempts / 15 min per IP (brute-force protection)
  app.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const { username, password } = req.body as any;

    if (!username || !password) {
      return reply.status(400).send({ error: "username/email and password required" });
    }

    // Accept email or username
    const isEmail = username.includes("@");
    const { rows: [user] } = await db.query(
      isEmail
        ? `SELECT id, username, password_hash, balance_usd, paper_balance_usd, tier, x_username, telegram_username, avatar_url, bio FROM users WHERE email = $1`
        : `SELECT id, username, password_hash, balance_usd, paper_balance_usd, tier, x_username, telegram_username, avatar_url, bio FROM users WHERE username = $1`,
      [username.toLowerCase()]
    );

    if (!user || !user.password_hash) {
      return reply.status(401).send({ error: "Invalid username or password" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: "Invalid username or password" });
    }

    const token = await (app as any).jwt.sign({ userId: user.id, username: user.username });
    return { token, user: { id: user.id, username: user.username, balance_usd: user.balance_usd, paper_balance_usd: user.paper_balance_usd, tier: user.tier ?? "", x_username: user.x_username, telegram_username: user.telegram_username, avatar_url: user.avatar_url, bio: user.bio } };
  });

  // GET /auth/me
  app.get("/auth/me", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { userId } = (req as any).user;
    const { rows: [user] } = await db.query(
      `SELECT id, username, balance_usd, paper_balance_usd, testnet_balance_gen, wallet_address, tier, created_at, x_username, telegram_username, avatar_url, bio FROM users WHERE id = $1`, [userId]
    );
    if (!user) return reply.status(404).send({ error: "User not found" });
    return user;
  });

  // POST /auth/paper-credit — add paper money to own account (max $10k total)
  app.post("/auth/paper-credit", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { userId } = (req as any).user;
    const { amount } = req.body as any;
    if (!amount || amount <= 0 || amount > 10_000) {
      return reply.status(400).send({ error: "Amount must be between $1 and $10,000" });
    }
    const { rows: [user] } = await db.query(
      `UPDATE users SET paper_balance_usd = LEAST(paper_balance_usd + $1, 10000)
       WHERE id = $2 RETURNING paper_balance_usd`,
      [amount, userId]
    );
    return { paper_balance_usd: user.paper_balance_usd };
  });

  // POST /auth/testnet-credit — add testnet GEN to own account (max 1000 total)
  app.post("/auth/testnet-credit", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { userId } = (req as any).user;
    const { amount } = req.body as any;
    if (!amount || amount <= 0 || amount > 1000) {
      return reply.status(400).send({ error: "Amount must be between 1 and 1000 GEN" });
    }
    const { rows: [user] } = await db.query(
      `UPDATE users SET testnet_balance_gen = LEAST(testnet_balance_gen + $1, 1000)
       WHERE id = $2 RETURNING testnet_balance_gen`,
      [amount, userId]
    );
    return { testnet_balance_gen: user.testnet_balance_gen };
  });

  // POST /auth/link-wallet — link a wallet address to the account
  app.post("/auth/link-wallet", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { userId } = (req as any).user;
    const { wallet_address } = req.body as any;
    if (!wallet_address || !/^0x[a-fA-F0-9]{40}$/.test(wallet_address)) {
      return reply.status(400).send({ error: "Invalid wallet address" });
    }
    const { rows: [user] } = await db.query(
      `UPDATE users SET wallet_address = $1 WHERE id = $2 RETURNING wallet_address`,
      [wallet_address.toLowerCase(), userId]
    );
    return { wallet_address: user.wallet_address };
  });

  // GET /auth/google/callback
  app.get("/auth/google/callback", async (req, reply) => {
    const oauth2 = (app as any).googleOAuth2;
    if (!oauth2) {
      return reply.status(503).send({ error: "Google OAuth not configured" });
    }

    let token: any;
    try {
      token = await oauth2.getAccessTokenFromAuthorizationCodeFlow(req, reply);
    } catch (err: any) {
      return reply.redirect(`${process.env.FRONTEND_URL ?? "http://localhost:3000"}/?auth_error=oauth_failed`);
    }

    // Fetch Google user info
    const googleRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token.token.access_token}` },
    });
    const gUser = await googleRes.json() as { id: string; email: string; name: string; picture?: string };

    // Find or create user
    let { rows: [user] } = await db.query(
      `SELECT id, username, balance_usd, paper_balance_usd FROM users WHERE google_id = $1`,
      [gUser.id]
    );

    if (!user && gUser.email) {
      // Maybe they registered by email before
      const { rows: [byEmail] } = await db.query(
        `SELECT id, username, balance_usd, paper_balance_usd FROM users WHERE email = $1`,
        [gUser.email.toLowerCase()]
      );
      if (byEmail) {
        // Link google_id to existing account
        await db.query(`UPDATE users SET google_id = $1 WHERE id = $2`, [gUser.id, byEmail.id]);
        user = byEmail;
      }
    }

    if (!user) {
      // Create new account — derive a username from their Google name
      const base = gUser.name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 18);
      let username = base;
      let suffix = 1;
      while (true) {
        const { rows } = await db.query(`SELECT id FROM users WHERE username = $1`, [username]);
        if (rows.length === 0) break;
        username = `${base}_${suffix++}`;
      }

      const { rows: [newUser] } = await db.query(
        `INSERT INTO users (username, email, google_id)
         VALUES ($1, $2, $3)
         RETURNING id, username, balance_usd, paper_balance_usd`,
        [username, gUser.email?.toLowerCase() ?? null, gUser.id]
      );
      user = newUser;
    }

    const jwt = await (app as any).jwt.sign({ userId: user.id, username: user.username });
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    return reply.redirect(`${frontendUrl}/auth/callback?token=${jwt}`);
  });

  // POST /auth/forgot-password — 5 / 15 min (email enumeration + spam protection)
  app.post("/auth/forgot-password", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const { email, username } = req.body as any;
    if (!email && !username) return reply.status(400).send({ error: "email or username required" });

    // Look up by email OR username — whichever was provided
    const { rows: [user] } = await db.query(
      `SELECT id, username, email FROM users WHERE email = $1 OR username = $2`,
      [email ? email.toLowerCase() : null, username ? username.toLowerCase() : null]
    );

    // If found by username but has no email, can't send reset link
    if (user && !user.email) {
      return reply.status(400).send({ error: "No email linked to this account. Add an email first." });
    }

    // Always return 200 — don't reveal whether email exists
    if (!user) return { ok: true };

    const resetToken = crypto.randomBytes(32).toString("hex");
    await db.query(
      `UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour' WHERE id = $2`,
      [resetToken, user.id]
    );

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    try {
      const mailer = getMailer();
      await mailer.sendMail({
        from: process.env.SMTP_FROM ?? "FUD.markets <noreply@fud.markets>",
        to: user.email,
        subject: "Reset your FUD.markets password",
        html: `
          <div style="font-family:monospace;background:#111;color:#fff;padding:32px;border-radius:12px;max-width:480px">
            <h2 style="margin:0 0 8px">FUD.markets</h2>
            <p style="color:#aaa;margin:0 0 24px">Password reset requested for <b>${user.username}</b></p>
            <a href="${resetLink}" style="display:inline-block;background:#fff;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:900;font-size:13px">
              Reset Password
            </a>
            <p style="color:#555;font-size:11px;margin-top:24px">Link expires in 1 hour. If you didn't request this, ignore this email.</p>
          </div>
        `,
      });
    } catch (err) {
      console.error("Failed to send reset email:", err);
      // Still return 200 to not leak info
    }

    return { ok: true };
  });

  // POST /auth/reset-password
  app.post("/auth/reset-password", async (req, reply) => {
    const { token, password } = req.body as any;
    if (!token || !password) {
      return reply.status(400).send({ error: "token and password required" });
    }
    if (password.length < 6) {
      return reply.status(400).send({ error: "Password must be at least 6 characters" });
    }

    const { rows: [user] } = await db.query(
      `SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()`,
      [token]
    );
    if (!user) {
      return reply.status(400).send({ error: "Invalid or expired reset link" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.query(
      `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2`,
      [passwordHash, user.id]
    );

    return { ok: true };
  });

  // POST /auth/wallet — find-or-create user by wallet address
  app.post("/auth/wallet", { config: { rateLimit: { max: 30, timeWindow: "5 minutes" } } }, async (req, reply) => {
    const { walletAddress, email } = req.body as { walletAddress: string; email?: string };

    const isEvm    = /^0x[0-9a-fA-F]{40}$/.test(walletAddress);
    const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress);
    if (!walletAddress || (!isEvm && !isSolana)) {
      return reply.status(400).send({ error: "Invalid wallet address" });
    }

    const addr = isEvm ? walletAddress.toLowerCase() : walletAddress;

    let { rows: [user] } = await db.query(
      `SELECT id, username, balance_usd, paper_balance_usd, tier FROM users WHERE wallet = $1`,
      [addr]
    );

    if (!user && email) {
      const { rows: [byEmail] } = await db.query(
        `SELECT id, username, balance_usd, paper_balance_usd, tier FROM users WHERE email = $1`,
        [email.toLowerCase()]
      );
      if (byEmail) {
        await db.query(`UPDATE users SET wallet = $1 WHERE id = $2`, [addr, byEmail.id]);
        user = byEmail;
      }
    }

    if (!user) {
      const shortAddr  = isEvm ? addr.slice(2, 8) : addr.slice(0, 6);
      const baseUsername = `w_${shortAddr}`;
      let username     = baseUsername;
      let suffix       = 1;
      while (true) {
        const { rows } = await db.query(`SELECT id FROM users WHERE username = $1`, [username]);
        if (rows.length === 0) break;
        username = `${baseUsername}_${suffix++}`;
      }
      const refCode = crypto.randomBytes(4).toString("hex").toUpperCase();
      const { rows: [newUser] } = await db.query(
        `INSERT INTO users (username, wallet, email, referral_code)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, balance_usd, paper_balance_usd, tier`,
        [username, addr, email ? email.toLowerCase() : null, refCode]
      );
      user = newUser;
    }

    const token = await (app as any).jwt.sign({ userId: user.id, username: user.username });
    return { token, user: { id: user.id, username: user.username, balance_usd: user.balance_usd, paper_balance_usd: user.paper_balance_usd, tier: user.tier ?? "" } };
  });

  // POST /auth/link-telegram  { token }
  app.post("/auth/link-telegram", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { token } = req.body as any;
    if (!token) return reply.status(400).send({ error: "token required" });

    const { rows: [entry] } = await db.query(
      `DELETE FROM tg_link_tokens WHERE token = $1 AND expires_at > NOW() RETURNING tg_id`,
      [token]
    );
    if (!entry) return reply.status(400).send({ error: "Token expired or invalid. Open /start in the bot again." });

    const userId = (req as any).user.userId;
    await db.query(`UPDATE users SET telegram_id = NULL WHERE telegram_id = $1`, [entry.tg_id]);
    await db.query(`UPDATE users SET telegram_id = $1 WHERE id = $2`, [entry.tg_id, userId]);

    const botToken = process.env.BOT_TOKEN;
    if (botToken) {
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: entry.tg_id,
          text: "✅ Telegram connected! You can now trade directly from the bot.",
        }),
      }).catch(() => {});
    }

    return { ok: true };
  });

  // GET /auth/x-auth-url — generate X OAuth URL for the logged-in user
  app.get("/auth/x-auth-url", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const userId = (req as any).user.userId;
    // Block if already connected — connections are permanent
    const { rows: [existing] } = await db.query(`SELECT x_username FROM users WHERE id = $1`, [userId]);
    if (existing?.x_username) return reply.status(409).send({ error: "X account already connected" });
    const frontendUrl = process.env.FRONTEND_URL ?? "https://fud-markets.vercel.app";
    const callbackUrl = `${frontendUrl}/auth/callback`;
    const client      = new TwitterApi({ appKey: process.env.X_API_KEY!, appSecret: process.env.X_API_SECRET! });
    const { url, oauth_token, oauth_token_secret } = await client.generateAuthLink(callbackUrl, { linkMode: "authorize" });
    // Store oauth_token_secret temporarily (5 min)
    await db.query(
      `INSERT INTO x_oauth_tokens (oauth_token, oauth_token_secret, user_id, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')
       ON CONFLICT (oauth_token) DO UPDATE SET oauth_token_secret = $2, user_id = $3, expires_at = NOW() + INTERVAL '5 minutes'`,
      [oauth_token, oauth_token_secret, userId]
    );
    return { url };
  });

  // GET /auth/x-callback — exchange OAuth verifier for access token, save x_username
  app.get("/auth/x-callback", async (req, reply) => {
    const { oauth_token, oauth_verifier } = req.query as any;
    if (!oauth_token || !oauth_verifier) return reply.status(400).send({ error: "Missing OAuth params" });
    const { rows: [entry] } = await db.query(
      `DELETE FROM x_oauth_tokens WHERE oauth_token = $1 AND expires_at > NOW() RETURNING oauth_token_secret, user_id`,
      [oauth_token]
    );
    if (!entry) return reply.status(400).send({ error: "OAuth token expired or invalid" });
    const client   = new TwitterApi({ appKey: process.env.X_API_KEY!, appSecret: process.env.X_API_SECRET!, accessToken: oauth_token, accessSecret: entry.oauth_token_secret });
    const { client: userClient, screenName } = await client.login(oauth_verifier);
    const xUser    = await userClient.v2.me();
    const xUsername = xUser.data.username.toLowerCase();
    // Check not taken by another user
    const { rows: [taken] } = await db.query(
      `SELECT id FROM users WHERE x_username = $1 AND id != $2`, [xUsername, entry.user_id]
    );
    if (taken) {
      const frontendUrl = process.env.FRONTEND_URL ?? "https://fud-markets.vercel.app";
      return reply.redirect(`${frontendUrl}/auth/callback?auth_error=already_linked`);
    }
    await db.query(`UPDATE users SET x_username = $1 WHERE id = $2`, [xUsername, entry.user_id]);
    const frontendUrl = process.env.FRONTEND_URL ?? "https://fud-markets.vercel.app";
    return reply.redirect(`${frontendUrl}/auth/callback?x_connected=1&x_username=${xUsername}`);
  });

  // POST /auth/disconnect-x — unlink X account
  app.post("/auth/disconnect-x", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const userId = (req as any).user.userId;
    await db.query(`UPDATE users SET x_username = NULL WHERE id = $1`, [userId]);
    return { ok: true };
  });

  // POST /auth/disconnect-telegram — unlink Telegram account
  app.post("/auth/disconnect-telegram", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const userId = (req as any).user.userId;
    await db.query(`UPDATE users SET telegram_id = NULL, telegram_username = NULL WHERE id = $1`, [userId]);
    return { ok: true };
  });

  // POST /auth/tg-init-link — frontend generates a token so user can link via bot deep link
  app.post("/auth/tg-init-link", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const userId = (req as any).user.userId;
    const token = crypto.randomBytes(16).toString("hex");
    await db.query(
      `INSERT INTO tg_link_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
      [token, userId]
    );
    return { token };
  });

  // POST /auth/update-profile — update avatar and bio
  app.post("/auth/update-profile", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const userId = (req as any).user.userId;
    const { avatar_url, bio } = req.body as any;
    await db.query(
      `UPDATE users SET avatar_url = $1, bio = $2 WHERE id = $3`,
      [avatar_url ?? null, bio ?? null, userId]
    );
    const { rows: [updated] } = await db.query(
      `SELECT id, username, balance_usd, paper_balance_usd, tier, x_username, telegram_username, avatar_url, bio FROM users WHERE id = $1`,
      [userId]
    );
    return updated;
  });
}
