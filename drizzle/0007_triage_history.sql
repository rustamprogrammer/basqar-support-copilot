CREATE TABLE IF NOT EXISTS triage_history (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL,
  reporter TEXT NOT NULL,
  signature TEXT NOT NULL,
  event_at INTEGER NOT NULL,
  stored_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS triage_history_lookup ON triage_history(reporter, signature, event_at);
CREATE INDEX IF NOT EXISTS triage_history_retention ON triage_history(stored_at);
