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
  tg_id       BIGINT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);
`;

export async function runMigrations() {
  console.log("Running database migrations...");
  await db.query(schema);
  await db.query(alterations);
  console.log("Migrations complete.");
}
