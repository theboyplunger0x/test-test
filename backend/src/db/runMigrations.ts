import { db } from "./client.js";

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet        TEXT UNIQUE,
  balance_usd   NUMERIC(18, 6) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  username      TEXT UNIQUE,
  password_hash TEXT,
  email         TEXT UNIQUE,
  google_id     TEXT UNIQUE,
  reset_token   TEXT,
  reset_token_expires TIMESTAMPTZ,
  paper_balance_usd NUMERIC(18,6) NOT NULL DEFAULT 1000
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS deposits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  chain         TEXT NOT NULL,
  tx_hash       TEXT UNIQUE NOT NULL,
  amount_usd    NUMERIC(18, 6) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  chain         TEXT NOT NULL,
  to_address    TEXT NOT NULL,
  amount_usd    NUMERIC(18, 6) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  tx_hash       TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS markets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol        TEXT NOT NULL,
  chain         TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  entry_price   NUMERIC(30, 12) NOT NULL,
  exit_price    NUMERIC(30, 12),
  tagline       TEXT NOT NULL DEFAULT '',
  opener_id     UUID NOT NULL REFERENCES users(id),
  short_pool    NUMERIC(18, 6) NOT NULL DEFAULT 0,
  long_pool     NUMERIC(18, 6) NOT NULL DEFAULT 0,
  opens_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closes_at     TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  winner_side   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_paper      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS positions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  market_id     UUID NOT NULL REFERENCES markets(id),
  side          TEXT NOT NULL,
  amount        NUMERIC(18, 6) NOT NULL,
  payout        NUMERIC(18, 6),
  claimed       BOOLEAN NOT NULL DEFAULT FALSE,
  placed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_paper      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS house_revenue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id     UUID NOT NULL REFERENCES markets(id),
  amount_usd    NUMERIC(18, 6) NOT NULL,
  collected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposit_intents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id),
  from_address         TEXT NOT NULL,
  chain                TEXT NOT NULL CHECK (chain IN ('base', 'sol')),
  status               TEXT NOT NULL DEFAULT 'pending',
  fulfilled_deposit_id UUID REFERENCES deposits(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '2 hours'
);

CREATE INDEX IF NOT EXISTS idx_markets_status    ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_closes_at ON markets(closes_at);
CREATE INDEX IF NOT EXISTS idx_positions_user    ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_market  ON positions(market_id);
CREATE INDEX IF NOT EXISTS idx_deposits_user     ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_tx       ON deposits(tx_hash);
CREATE INDEX IF NOT EXISTS idx_deposit_intents_user   ON deposit_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_deposit_intents_from   ON deposit_intents(from_address, chain, status);
CREATE INDEX IF NOT EXISTS idx_deposit_intents_status ON deposit_intents(status, expires_at);
`;

const alterations = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS deposit_index        INT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deposit_address_evm  TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deposit_address_sol  TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id           BIGINT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS x_username            TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS x_oauth_tokens (
  oauth_token        TEXT PRIMARY KEY,
  oauth_token_secret TEXT NOT NULL,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at         TIMESTAMPTZ NOT NULL
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code        TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by          UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier                 TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS referral_rewards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID NOT NULL REFERENCES users(id),
  referred_id   UUID NOT NULL REFERENCES users(id),
  reward_usd    NUMERIC(18, 6) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_id);

CREATE TABLE IF NOT EXISTS cashback_rewards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  market_id     UUID REFERENCES markets(id),
  reward_usd    NUMERIC(18, 6) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cashback_rewards_user ON cashback_rewards(user_id);

CREATE TABLE IF NOT EXISTS tg_link_tokens (
  token       TEXT PRIMARY KEY,
  tg_id       BIGINT,
  user_id     UUID,
  expires_at  TIMESTAMPTZ NOT NULL
);
ALTER TABLE tg_link_tokens ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE tg_link_tokens ALTER COLUMN tg_id DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;

CREATE TABLE IF NOT EXISTS follows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notify_trades BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_follower  ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

CREATE TABLE IF NOT EXISTS bot_kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}',
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = false;

ALTER TABLE positions ADD COLUMN IF NOT EXISTS message TEXT;

-- Tier rename: "" → basic, "normal" → pro
UPDATE users SET tier = 'basic' WHERE tier = '';
UPDATE users SET tier = 'pro'   WHERE tier = 'normal';

-- ── Order Book ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  symbol           TEXT NOT NULL,
  chain            TEXT NOT NULL,
  ca               TEXT,
  timeframe        TEXT NOT NULL,
  side             TEXT NOT NULL,           -- 'long' | 'short'
  amount           NUMERIC(18,6) NOT NULL,
  remaining_amount NUMERIC(18,6) NOT NULL,  -- decrements on partial fill
  reserved_amount  NUMERIC(18,6) NOT NULL,  -- balance currently locked
  status           TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'partially_filled'|'filled'|'cancelled'|'expired'
  is_paper         BOOLEAN NOT NULL DEFAULT false,
  auto_reopen      BOOLEAN NOT NULL DEFAULT false,
  expires_at       TIMESTAMPTZ,
  tagline          TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user   ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_book   ON orders(symbol, timeframe, side, status);
CREATE INDEX IF NOT EXISTS idx_orders_pending ON orders(status) WHERE status IN ('pending','partially_filled');

CREATE TABLE IF NOT EXISTS fills (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_id       UUID NOT NULL,
  maker_order_id UUID NOT NULL REFERENCES orders(id),
  taker_user_id  UUID NOT NULL REFERENCES users(id),
  market_id      UUID NOT NULL REFERENCES markets(id),
  filled_amount  NUMERIC(18,6) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fills_sweep  ON fills(sweep_id);
CREATE INDEX IF NOT EXISTS idx_fills_taker  ON fills(taker_user_id);
CREATE INDEX IF NOT EXISTS idx_fills_order  ON fills(maker_order_id);

ALTER TABLE markets ADD COLUMN IF NOT EXISTS sweep_id UUID;
CREATE INDEX IF NOT EXISTS idx_markets_sweep ON markets(sweep_id) WHERE sweep_id IS NOT NULL;

-- v3: social fade link
ALTER TABLE positions ADD COLUMN IF NOT EXISTS faded_position_id UUID REFERENCES positions(id);
CREATE INDEX IF NOT EXISTS idx_positions_faded ON positions(faded_position_id) WHERE faded_position_id IS NOT NULL;

-- v4: contract address on markets for precise oracle resolution
ALTER TABLE markets ADD COLUMN IF NOT EXISTS ca TEXT;

-- v5: performance
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_users_username_trgm  ON users USING gin(username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_positions_user_paper ON positions(user_id, is_paper);

-- v6: testnet mode (GenLayer Bradbury)
ALTER TABLE users ADD COLUMN IF NOT EXISTS testnet_balance_gen NUMERIC(18,6) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_testnet BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS is_testnet BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS is_testnet BOOLEAN NOT NULL DEFAULT false;
`;

export async function runMigrations() {
  console.log("Running database migrations...");
  const client = await db.connect();
  try {
    // Advisory lock so concurrent restarts don't deadlock on DDL
    await client.query("SELECT pg_advisory_lock(7777777)");
    await client.query(schema);
    await client.query(alterations);
    await client.query("SELECT pg_advisory_unlock(7777777)");
  } finally {
    client.release();
  }
  console.log("Migrations complete.");
}
