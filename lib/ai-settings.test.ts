import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { AI_SETTINGS_SCHEMA, decryptApiKey, encryptApiKey, isLocalSettingsOperator, parseAiSettingsUpdate, publicAiSettings, readAiSettings, reserveAiRequest, updateAiSettings, type AiSettingsDatabase } from './ai-settings.ts';
import { managedReview } from './ai-settings-review.ts';
import { processServerMessageWithReview, applyReviewDecision, reviewKnowledgeCandidates } from './server-review.ts';
import { processSupportMessage } from './support-processing.ts';
import { KNOWLEDGE_ENTRIES } from './knowledge-base.ts';
import type { ReviewDecision } from './ai-review-client.ts';

const secret = randomBytes(32).toString('base64url');
const key = 'sk-test-not-a-real-credential-1234567890';
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(AI_SETTINGS_SCHEMA);
  const prepare = (sql: string, values: (string | number | null)[] = []) => ({
    bind: (...params: (string | number | null)[]) => prepare(sql, params),
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    run: async () => ({ meta: sqlite.prepare(sql).run(...values) }),
    execute: () => ({ meta: sqlite.prepare(sql).run(...values) }),
  });
  const client = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    sqlite.exec('BEGIN IMMEDIATE');
    try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result; }
    catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
  } } as unknown as AiSettingsDatabase;
  return { sqlite, client, close: () => sqlite.close() };
}
const envelope = (decision: ReviewDecision = { ok: true, correction: null, reason: null }) => new Response(JSON.stringify({ status: 'completed', model: 'gpt-6-luna', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(decision) }] }], usage: { input_tokens: 100, output_tokens: 15 } }));

test('AES-GCM uses fresh IVs, authenticates ciphertext, and rejects another runtime secret', async () => {
  const first = await encryptApiKey(key, secret), second = await encryptApiKey(key, secret);
  assert.notEqual(first, second); assert.ok(!first.includes(key)); assert.equal(await decryptApiKey(first, secret), key);
  await assert.rejects(decryptApiKey(first, randomBytes(32).toString('base64url')));
  const parts = first.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  await assert.rejects(decryptApiKey(parts.join('.'), secret));
});

test('settings mutation is same-origin loopback only, even with a spoofed loopback tunnel Host', () => {
  const local = (headers: Record<string, string> = {}) => new Request('http://127.0.0.1:8787/api/settings', { headers: { Origin: 'http://127.0.0.1:8787', ...headers } });
  assert.equal(isLocalSettingsOperator(local(), true), true);
  assert.equal(isLocalSettingsOperator(new Request('https://demo.trycloudflare.com/api/settings'), false), false);
  assert.equal(isLocalSettingsOperator(local({ Origin: 'https://evil.invalid' }), true), false);
  assert.equal(isLocalSettingsOperator(new Request('http://127.0.0.1:8787/api/settings'), true), false);
  assert.equal(isLocalSettingsOperator(local({ host: 'evil.invalid' }), true), false);
  for (const name of ['cf-connecting-ip', 'cf-ray', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'via']) assert.equal(isLocalSettingsOperator(local({ [name]: 'spoof' }), true), false, name);
  assert.equal(isLocalSettingsOperator(local({ 'sec-fetch-site': 'cross-site' }), true), false);
});

test('configuration defaults disabled, excludes secrets and rejects budget reset parameters', async () => {
  const f = fixture();
  try {
    assert.equal((await readAiSettings(f.client)).enabled, 0);
    assert.equal(parseAiSettingsUpdate({ used: 0, enabled: true }), null);
    assert.equal(parseAiSettingsUpdate({ model: 'https://evil.invalid' }), null);
    assert.equal(parseAiSettingsUpdate({ apiKey: key, removeKey: true }), null);
    const row = await updateAiSettings(f.client, secret, { apiKey: key, enabled: true });
    const view = publicAiSettings(row, true);
    assert.equal(view.keyMask, '••••7890'); assert.equal(view.active, true);
    assert.ok(!JSON.stringify(view).includes(key)); assert.ok(!JSON.stringify(view).includes(row.encrypted_key!)); assert.ok(!JSON.stringify(view).includes(secret));
  } finally { f.close(); }
});

test('atomic parallel reservations stop at exactly 100 and repeated ids never increment again', async () => {
  const f = fixture();
  try {
    const row = await updateAiSettings(f.client, secret, { apiKey: key, enabled: true });
    const reservations = await Promise.all(Array.from({ length: 160 }, (_, i) => reserveAiRequest(f.client, `request-${i}`, `hash-${i}`, row.encrypted_key!)));
    assert.equal(reservations.filter(item => item.reserved).length, 100);
    assert.equal((await readAiSettings(f.client)).used, 100);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM ai_requests').get()!.count, 100);
    assert.equal((await reserveAiRequest(f.client, 'request-0', 'hash-0', row.encrypted_key!)).reserved, false);
    await updateAiSettings(f.client, secret, { removeKey: true });
    await updateAiSettings(f.client, secret, { apiKey: 'sk-another-synthetic-key-1234567890', enabled: true, mode: 'all' });
    assert.equal((await readAiSettings(f.client)).used, 100);
    assert.equal(publicAiSettings(await readAiSettings(f.client), true).active, false);
    f.sqlite.exec(AI_SETTINGS_SCHEMA); assert.equal((await readAiSettings(f.client)).used, 100, 'Reapplying migration must not reset counters');
  } finally { f.close(); }
});

test('disabled and confident deterministic cases never invoke transport; manual test still spends one', async () => {
  const f = fixture(); let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return envelope(); };
  const input = { db: f.client, secret, requestId: 'one', original: 'Что такое ДМ?', candidate: { category: 'question' as const, needs_clarification: false }, fetcher };
  try {
    await updateAiSettings(f.client, secret, { apiKey: key });
    assert.equal('skipped' in await managedReview(input), true); assert.equal(calls, 0);
    await updateAiSettings(f.client, secret, { enabled: true });
    assert.equal('skipped' in await managedReview(input), true); assert.equal(calls, 0);
    const manual = await managedReview({ ...input, manual: true }); assert.equal('result' in manual, true); assert.equal(calls, 1);
    const repeated = await managedReview({ ...input, manual: true }); assert.equal('cached' in repeated && repeated.cached, true); assert.equal(calls, 1);
    assert.equal((await readAiSettings(f.client)).used, 1);
  } finally { f.close(); }
});

test('provider failures consume one reservation, stay cached, expose no provider content and never retry', async () => {
  const f = fixture(); let calls = 0;
  try {
    await updateAiSettings(f.client, secret, { apiKey: key, enabled: true });
    const input = { db: f.client, secret, requestId: 'failed', original: 'Нужна помощь', candidate: { category: 'help' as const, needs_clarification: false }, uncertain: true,
      fetcher: (async () => { calls++; return new Response(key + ' private error', { status: 401 }); }) as typeof fetch };
    const first = await managedReview(input), retry = await managedReview(input);
    assert.equal(calls, 1); assert.equal((await readAiSettings(f.client)).used, 1);
    assert.ok(!JSON.stringify(first).includes(key)); assert.ok(!JSON.stringify(retry).includes('private'));
    assert.equal('cached' in retry && retry.cached, true);
  } finally { f.close(); }
});

test('concurrent identical message is in progress, and changed text cannot reuse its paid result', async () => {
  const f = fixture(); let calls = 0; let release: (() => void) | undefined;
  try {
    await updateAiSettings(f.client, secret, { apiKey: key, enabled: true, mode: 'all' });
    const started = new Promise<void>(resolve => { release = resolve; });
    let arrived: (() => void) | undefined; const inFetch = new Promise<void>(resolve => { arrived = resolve; });
    const input = { db: f.client, secret, requestId: 'same', original: 'Помогите', candidate: { category: 'help' as const, needs_clarification: false }, fetcher: (async () => { calls++; arrived!(); await started; return envelope(); }) as typeof fetch };
    const first = managedReview(input); await inFetch;
    const duplicate = await managedReview(input); assert.equal('skipped' in duplicate && duplicate.skipped, 'in_progress');
    release!(); await first;
    const changed = await managedReview({ ...input, original: 'Другой текст' }); assert.equal('skipped' in changed && changed.code, 'request_id_conflict');
    assert.equal(calls, 1); assert.equal((await readAiSettings(f.client)).used, 1);
  } finally { release?.(); f.close(); }
});

test('live integration falls back to original rules on network failure and retains review metadata', async () => {
  const f = fixture(); let calls = 0;
  try {
    await updateAiSettings(f.client, secret, { apiKey: key, enabled: true, mode: 'all' });
    const original = 'Где выключить только голосовой чат игроков?';
    const rules = processSupportMessage(original);
    const result = await processServerMessageWithReview(original, undefined, KNOWLEDGE_ENTRIES, { db: f.client, secret, requestId: 'message:fallback', fetcher: async () => { calls++; throw new Error(key); } });
    assert.equal(calls, 1); assert.equal(result.text, rules.text); assert.equal(result.processing.route, rules.processing.route);
    assert.equal(result.processing.aiReview?.outcome, 'unavailable'); assert.ok(!JSON.stringify(result).includes(key));
  } finally { f.close(); }
});

test('direct violations skip review even in all mode', async () => {
  const f = fixture(); let calls = 0;
  try {
    await updateAiSettings(f.client, secret, { apiKey: key, enabled: true, mode: 'all' });
    const result = await processServerMessageWithReview('Админ ты тупой уебок', undefined, KNOWLEDGE_ENTRIES, { db: f.client, secret, requestId: 'message:violation', fetcher: async () => { calls++; return envelope(); } });
    assert.equal(result.processing.route, 'violation'); assert.equal(calls, 0); assert.equal((await readAiSettings(f.client)).used, 0);
  } finally { f.close(); }
});

test('AI cannot invent an answer, use an unpublished card, or downgrade ongoing urgency', () => {
  const original = 'Меня сейчас дмят, помогите', rules = processSupportMessage(original);
  const decision: ReviewDecision = { ok: false, reason: 'Случай проверен', correction: { category: 'help', corrected_text: original, needs_clarification: false, follow_up: null, urgency: 'normal', knowledge_id: null } };
  const updated = applyReviewDecision(original, rules, decision, KNOWLEDGE_ENTRIES, []);
  assert.equal(updated.processing.urgency?.level, 'now');
  const question = 'Объясни ДМить', questionRules = processSupportMessage(question);
  const correction: ReviewDecision = { ok: false, reason: 'Определение', correction: { category: 'question', corrected_text: 'Что такое ДМ?', needs_clarification: false, follow_up: null, urgency: null, knowledge_id: 'invented-card' } };
  const candidates = reviewKnowledgeCandidates(question, KNOWLEDGE_ENTRIES);
  assert.equal(applyReviewDecision(question, questionRules, correction, KNOWLEDGE_ENTRIES, candidates).processing.knowledge?.status, 'needs_admin');
  const dm = KNOWLEDGE_ENTRIES.find(entry => entry.id === 'faq-dm')!;
  correction.correction!.knowledge_id = dm.id;
  assert.equal(applyReviewDecision(question, questionRules, correction, [{ ...dm, status: 'draft' }], [dm]).processing.knowledge?.status, 'needs_admin');
  assert.equal(applyReviewDecision(question, questionRules, correction, [dm], [dm]).processing.knowledge?.answer, dm.answer);
  for (const unsupported of ['DM qilish mumkinmi?', 'Чи дозволено ДМити?', 'Что такое DM и где купить дом?']) {
    assert.equal(applyReviewDecision(unsupported, processSupportMessage(unsupported), correction, [dm], [dm]).processing.knowledge?.status, 'needs_admin', unsupported);
  }
});

test('an in-flight confirmed answer is withdrawn if its published card changes', async () => {
  const f = fixture();
  try {
    await updateAiSettings(f.client, secret, { apiKey: key, enabled: true, mode: 'all' });
    const original = 'Что такое ДМить?';
    const result = await processServerMessageWithReview(original, undefined, KNOWLEDGE_ENTRIES, { db: f.client, secret, requestId: 'message:retired', fetcher: async () => envelope(),
      refreshEntries: async () => KNOWLEDGE_ENTRIES.map(entry => entry.id === 'faq-dm' ? { ...entry, status: 'retired' } : entry) });
    assert.equal(result.processing.aiReview?.outcome, 'confirmed');
    assert.equal(result.processing.knowledge?.status, 'needs_admin');
    assert.equal(result.processing.steps.some(step => step.id === 'answer'), false);
  } finally { f.close(); }
});

test('idempotent retries cannot apply a cached confirmation to a changed candidate or model', async () => {
  const f = fixture(); let calls = 0;
  try {
    await updateAiSettings(f.client, secret, { apiKey: key, enabled: true, mode: 'all' });
    const input = { db: f.client, secret, requestId: 'changed-policy-input', original: 'Что значит ДМ?', candidate: { category: 'question' as const, needs_clarification: false }, fetcher: (async () => { calls++; return envelope(); }) as typeof fetch };
    await managedReview(input);
    const changed = await managedReview({ ...input, candidate: { category: 'help', needs_clarification: false } });
    assert.equal('skipped' in changed && changed.code, 'request_id_conflict');
    await updateAiSettings(f.client, secret, { model: 'gpt-other-test-model' });
    const changedModel = await managedReview(input);
    assert.equal('skipped' in changedModel && changedModel.code, 'request_id_conflict');
    assert.equal(calls, 1); assert.equal((await readAiSettings(f.client)).used, 1);
  } finally { f.close(); }
});
