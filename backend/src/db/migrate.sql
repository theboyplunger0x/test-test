-- Migrations are empty — schema.sql is authoritative for FUD.markets V1
-- Add future ALTER TABLE migrations here as the project evolves.

-- v2: Telegram bot support
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE;

CREATE TABLE IF NOT EXISTS tg_link_tokens (
  token      TEXT PRIMARY KEY,
  tg_id      BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
