CREATE TABLE IF NOT EXISTS ai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_key TEXT,
  key_suffix TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  mode TEXT NOT NULL DEFAULT 'uncertain' CHECK (mode IN ('uncertain', 'all')),
  model TEXT NOT NULL DEFAULT 'gpt-6-luna',
  used INTEGER NOT NULL DEFAULT 0 CHECK (used BETWEEN 0 AND 100),
  updated_at INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT OR IGNORE INTO ai_settings (id) VALUES (1);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  result_json TEXT
);
