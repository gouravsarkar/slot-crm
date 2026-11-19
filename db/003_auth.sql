-- Admin login: email + bcrypt password, sessions stored in Postgres.
-- Safe to run more than once (needed for databases created before this file existed):
--   docker compose exec -T postgres psql -U slotcrm -d slotcrm < db/003_auth.sql

CREATE TABLE IF NOT EXISTS admin_users (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
  password_hash   TEXT NOT NULL,                   -- bcrypt ($2b$...), never the password
  is_active       BOOLEAN NOT NULL DEFAULT true,
  failed_logins   SMALLINT NOT NULL DEFAULT 0,     -- consecutive failures, reset on success
  locked_until    TIMESTAMPTZ,                     -- set after too many failures
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_uq ON admin_users (email);

-- One row per logged-in browser. Only a SHA-256 of the cookie token is stored, so a
-- leaked database dump cannot be replayed as a session.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions (user_id);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions (expires_at);
