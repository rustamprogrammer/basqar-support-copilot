import type { AiSettingsDatabase } from '../ai-settings.ts';
export const CLIENT_REQUESTS_PER_MINUTE = 6;
export const GLOBAL_REQUESTS_PER_MINUTE = 20;

export async function allowContestRequest(db: AiSettingsDatabase, clientHash: string, now = Date.now()) {
  const window = Math.floor(now / 60_000), expiry = (window + 1) * 60_000;
  const client = `client:${window}:${clientHash}`, global = `global:${window}`, token = crypto.randomUUID();
  // Only cookie hashes supplied by the route enter this table. No IP header is
  // trusted. The shared bucket also bounds clients that rotate their cookies.
  const statements = [
    { sql: 'DELETE FROM ai_rate_limits WHERE expires_at <= ?', args: [now] },
    { sql: 'INSERT OR IGNORE INTO ai_rate_limits(bucket, expires_at) VALUES (?, ?), (?, ?)', args: [client, expiry, global, expiry] },
    { sql: 'UPDATE ai_rate_limits SET used = used + 1, token = ? WHERE bucket = ? AND used < ? AND (SELECT used FROM ai_rate_limits WHERE bucket = ?) < ?', args: [token, client, CLIENT_REQUESTS_PER_MINUTE, global, GLOBAL_REQUESTS_PER_MINUTE] },
    { sql: 'UPDATE ai_rate_limits SET used = used + 1 WHERE bucket = ? AND EXISTS (SELECT 1 FROM ai_rate_limits WHERE bucket = ? AND token = ?)', args: [global, client, token] },
    { sql: 'SELECT token FROM ai_rate_limits WHERE bucket = ?', args: [client] },
  ];
  const results = await db.batch<{ token: string }>(statements.map(s => db.prepare(s.sql).bind(...s.args)));
  return results[4].results[0]?.token === token;
}
