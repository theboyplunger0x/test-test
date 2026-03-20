-- FUD.markets Database Schema

CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username          TEXT UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  email             TEXT UNIQUE,
  google_id         TEXT UNIQUE,
  reset_token       TEXT,
  reset_token_expires TIMESTAMPTZ,
  balance_usd       NUMERIC(18, 6) NOT NULL DEFAULT 0,
  paper_balance_usd NUMERIC(18, 6) NOT NULL DEFAULT 1000,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Markets: each prediction window
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
  status        TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'locked' | 'resolved' | 'cancelled'
  winner_side   TEXT,                           -- 'long' | 'short'
  is_paper      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Positions: individual bets
CREATE TABLE IF NOT EXISTS positions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  market_id     UUID NOT NULL REFERENCES markets(id),
  side          TEXT NOT NULL,
  amount        NUMERIC(18, 6) NOT NULL,
  payout        NUMERIC(18, 6),
  claimed       BOOLEAN NOT NULL DEFAULT FALSE,
  is_paper      BOOLEAN NOT NULL DEFAULT false,
  placed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- House fee ledger (5% of losing pool per market)
CREATE TABLE IF NOT EXISTS house_revenue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id     UUID NOT NULL REFERENCES markets(id),
  amount_usd    NUMERIC(18, 6) NOT NULL,
  collected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_username    ON users(username);
CREATE INDEX IF NOT EXISTS idx_markets_status    ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_closes_at ON markets(closes_at);
CREATE INDEX IF NOT EXISTS idx_positions_user    ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_market  ON positions(market_id);
