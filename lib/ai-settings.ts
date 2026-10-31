import type { ReviewResult } from './ai-review-client.ts';

export const AI_REQUEST_LIMIT = 100;
export const DEFAULT_AI_MODEL = 'gpt-6-luna';
export type AiMode = 'uncertain' | 'all';
export type AiSettingsRow = { id: number; encrypted_key: string | null; key_suffix: string | null; enabled: number; mode: AiMode; model: string; used: number; updated_at: number };
export type AiRequestRow = { id: string; token: string; input_hash: string; created_at: number; result_json: string | null };
export type AiSettingsDatabase = Pick<D1Database, 'prepare' | 'batch'>;
export const AI_SETTINGS_SCHEMA = `CREATE TABLE IF NOT EXISTS ai_settings (
 id INTEGER PRIMARY KEY CHECK (id = 1), encrypted_key TEXT, key_suffix TEXT,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
 mode TEXT NOT NULL DEFAULT 'uncertain' CHECK (mode IN ('uncertain','all')),
 model TEXT NOT NULL DEFAULT 'gpt-6-luna', used INTEGER NOT NULL DEFAULT 0 CHECK (used BETWEEN 0 AND 100), updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO ai_settings(id) VALUES (1);
CREATE TABLE IF NOT EXISTS ai_requests (id TEXT PRIMARY KEY, token TEXT NOT NULL, input_hash TEXT NOT NULL, created_at INTEGER NOT NULL, result_json TEXT);`;

const encoder = new TextEncoder();
const bytes64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
function from64(value: string) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)); }
export function validSettingsSecret(value?: string): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value); }
async function cipherKey(secret: string) {
  if (!validSettingsSecret(secret)) throw new Error('Settings encryption is unavailable');
  return crypto.subtle.importKey('raw', from64(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptApiKey(apiKey: string, secret: string): Promise<string> {
  if (!validApiKey(apiKey)) throw new Error('Invalid API key');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('basqar:ai-key:v1') }, await cipherKey(secret), encoder.encode(apiKey));
  return `v1.${bytes64(iv)}.${bytes64(new Uint8Array(encrypted))}`;
}
export async function decryptApiKey(value: string, secret: string): Promise<string> {
  const [version, iv, cipher, extra] = value.split('.');
  if (version !== 'v1' || !iv || !cipher || extra !== undefined || from64(iv).length !== 12) throw new Error('Invalid encrypted key');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: from64(iv), additionalData: encoder.encode('basqar:ai-key:v1') }, await cipherKey(secret), from64(cipher));
  const key = new TextDecoder().decode(plain);
  if (!validApiKey(key)) throw new Error('Invalid API key');
  return key;
}
export function validApiKey(value: unknown): value is string { return typeof value === 'string' && /^sk-[A-Za-z0-9_-]{17,4000}$/u.test(value); }
export function validAiModel(value: unknown): value is string { return typeof value === 'string' && /^gpt-[a-z0-9][a-z0-9.-]{0,79}$/u.test(value); }

/** Public demo permissions do not grant control of paid credentials. Reject tunnel headers even when its origin Host is loopback. */
export function isLocalSettingsOperator(request: Request, mutation = false) {
  const url = new URL(request.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return false;
  for (const name of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'true-client-ip', 'via']) if (request.headers.has(name)) return false;
  const host = request.headers.get('host');
  if (host && host.toLowerCase() !== url.host.toLowerCase()) return false;
  const site = request.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) return false;
  return !mutation || request.headers.get('origin') === url.origin;
}

export async function readAiSettings(db: AiSettingsDatabase): Promise<AiSettingsRow> {
  const row = await db.prepare('SELECT * FROM ai_settings WHERE id = 1').first<AiSettingsRow>();
  if (!row) throw new Error('AI settings are unavailable');
  return row;
}
export function publicAiSettings(row: AiSettingsRow, encryptionReady: boolean) {
  const configured = !!row.encrypted_key;
  return { configured, keyMask: configured ? `••••${row.key_suffix ?? ''}` : null, enabled: row.enabled === 1,
    active: row.enabled === 1 && configured && encryptionReady && row.used < AI_REQUEST_LIMIT,
    mode: row.mode, model: row.model, used: row.used, limit: AI_REQUEST_LIMIT, remaining: Math.max(0, AI_REQUEST_LIMIT - row.used), encryptionReady };
}
export type AiSettingsUpdate = { apiKey?: string; removeKey?: boolean; enabled?: boolean; mode?: AiMode; model?: string };
export function parseAiSettingsUpdate(body: unknown): AiSettingsUpdate | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>, allowed = ['apiKey', 'removeKey', 'enabled', 'mode', 'model'];
  if (!Object.keys(value).length || Object.keys(value).some(key => !allowed.includes(key))) return null;
  if (value.apiKey !== undefined && !validApiKey(value.apiKey)) return null;
  if (value.removeKey !== undefined && typeof value.removeKey !== 'boolean') return null;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return null;
  if (value.mode !== undefined && !['uncertain', 'all'].includes(String(value.mode))) return null;
  if (value.model !== undefined && !validAiModel(value.model)) return null;
  if (value.removeKey === true && (value.apiKey !== undefined || value.enabled === true)) return null;
  return value as AiSettingsUpdate;
}
export async function updateAiSettings(db: AiSettingsDatabase, secret: string, update: AiSettingsUpdate) {
  const current = await readAiSettings(db);
  let encrypted = current.encrypted_key, suffix = current.key_suffix;
  if (update.apiKey) { encrypted = await encryptApiKey(update.apiKey, secret); suffix = update.apiKey.slice(-4); }
  if (update.removeKey) { encrypted = null; suffix = null; }
  const enabled = update.removeKey ? false : update.enabled ?? current.enabled === 1;
  if (enabled && (!encrypted || !validSettingsSecret(secret))) throw new Error('Save an API key first');
  // No update operation accepts or modifies the cumulative paid-request counter.
  await db.prepare('UPDATE ai_settings SET encrypted_key = ?, key_suffix = ?, enabled = ?, mode = ?, model = ?, updated_at = ? WHERE id = 1')
    .bind(encrypted, suffix, Number(enabled), update.mode ?? current.mode, update.model ?? current.model, Date.now()).run();
  return readAiSettings(db);
}
export async function inputHash(value: string) { return bytes64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
export function reservationStatements(id: string, hash: string, encrypted: string, manual: boolean, token: string, at: number) {
  return [
    { sql: `INSERT INTO ai_requests(id, token, input_hash, created_at) SELECT ?, ?, ?, ? FROM ai_settings WHERE id = 1 AND used < 100 AND encrypted_key = ? AND (enabled = 1 OR ? = 1) ON CONFLICT(id) DO NOTHING`, params: [id, token, hash, at, encrypted, Number(manual)] },
    { sql: `UPDATE ai_settings SET used = used + 1 WHERE id = 1 AND EXISTS (SELECT 1 FROM ai_requests WHERE id = ? AND token = ?)`, params: [id, token] },
  ];
}
export async function reserveAiRequest(db: AiSettingsDatabase, id: string, hash: string, encrypted: string, manual = false) {
  const token = crypto.randomUUID();
  // D1 batch is a transaction: unique id insertion and the counter increment commit together.
  await db.batch(reservationStatements(id, hash, encrypted, manual, token, Date.now()).map(statement => db.prepare(statement.sql).bind(...statement.params)));
  const saved = await db.prepare('SELECT * FROM ai_requests WHERE id = ?').bind(id).first<AiRequestRow>();
  return saved?.token === token ? { reserved: true as const, row: saved } : { reserved: false as const, row: saved };
}
export async function finishAiRequest(db: AiSettingsDatabase, id: string, token: string, result: ReviewResult) {
  await db.prepare('UPDATE ai_requests SET result_json = ? WHERE id = ? AND token = ? AND result_json IS NULL').bind(JSON.stringify(result), id, token).run();
}
