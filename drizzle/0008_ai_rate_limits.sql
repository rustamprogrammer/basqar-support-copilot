CREATE TABLE IF NOT EXISTS ai_rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ai_rate_limits_expiry ON ai_rate_limits(expires_at);
