import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { AI_SETTINGS_SCHEMA, updateAiSettings, readAiSettings, type AiSettingsDatabase } from '../ai-settings.ts';
import { triage, EMPTY_CORPUS } from './engine.ts';
import { managedContestModel, ContestInProgressError } from './managed-model.ts';
import { allowContestRequest } from './rate-limit.ts';
import { applyContestToSupport } from './support-adapter.ts';
import { processSupportMessage } from '../support-processing.ts';
import { createSupportState } from '../support-state.ts';
import { refreshTriageAfterKnowledgeChange } from './knowledge-refresh.ts';
import type { Ticket } from './types.ts';

const secret = 'a'.repeat(43), apiKey = 'sk-test-not-a-real-key-123456789';
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(AI_SETTINGS_SCHEMA);
  sqlite.exec(readFileSync(new URL('../../drizzle/0008_ai_rate_limits.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string, values: (string | number | null)[] = []) => ({
    bind: (...params: (string | number | null)[]) => prepare(sql, params),
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    run: async () => ({ meta: sqlite.prepare(sql).run(...values) }),
    execute: () => /^\s*SELECT/u.test(sql) ? { results: sqlite.prepare(sql).all(...values) } : { results: [], meta: sqlite.prepare(sql).run(...values) },
  });
  const db = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    sqlite.exec('BEGIN IMMEDIATE');
    try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result; }
    catch (cause) { sqlite.exec('ROLLBACK'); throw cause; }
  } } as unknown as AiSettingsDatabase;
  return { sqlite, db };
}
const ticket = (text = 'Оплатил донат, деньги не пришли'): Ticket => ({ kind: 'report', messages: [{ role: 'player', text }] });
const envelope = () => new Response(JSON.stringify({ status: 'completed', model: 'gpt-6-luna', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ lang: 'ru', category: 'report.payment', priority: 'p0', draft: 'Укажите дату и номер операции. Платёж проверит поддержка.', citation_ids: [], needs_human: true, reason: 'Не поступил платёж.' }) }] }], usage: { input_tokens: 500, output_tokens: 80, input_tokens_details: { cached_tokens: 0 } } }));
async function enabled() {
  const f = fixture();
  await updateAiSettings(f.db, secret, { apiKey, enabled: true, mode: 'all' });
  return f;
}

test('contest uses shared lifetime cap and content cache ignores new ticket IDs', async () => {
  const { sqlite, db } = await enabled(); let calls = 0;
  const fetcher = (async () => { calls++; return envelope(); }) as typeof fetch;
  const run = (id: string) => { const t = { ...ticket(), ticket_id: id }; return managedContestModel({ ticket: t, baseline: triage(t), corpus: EMPTY_CORPUS, db, secret, clientHash: 'visitor-a', fetcher }); };
  try {
    sqlite.prepare('UPDATE ai_settings SET used = 99').run();
    assert.equal((await run('one')).triage.meta.mode, 'rules+ai');
    const repeated = await run('two');
    assert.equal(repeated.review.cached, true); assert.equal(repeated.triage.meta.api_cost_usd, 0);
    assert.equal((await readAiSettings(db)).used, 100); assert.equal(calls, 1);
    const t = ticket('Оплатил донат второй раз, он не пришёл');
    assert.equal((await managedContestModel({ ticket: t, baseline: triage(t), corpus: EMPTY_CORPUS, db, secret, clientHash: 'visitor-a', fetcher })).review.errorCode, 'lifetime_limit');
    assert.equal(calls, 1);
    assert.match(String(sqlite.prepare('SELECT id FROM ai_requests').get()?.id), /^contest:/u);
  } finally { sqlite.close(); }
});

test('disabled AI and approved FAQ do not invoke provider or consume quota', async () => {
  const { sqlite, db } = fixture();
  const fetcher = (async () => { throw new Error('provider must not run'); }) as typeof fetch;
  try {
    const t = ticket();
    assert.equal((await managedContestModel({ ticket: t, baseline: triage(t), corpus: EMPTY_CORPUS, db, secret, clientHash: 'a', fetcher })).review.outcome, 'disabled');
    await updateAiSettings(db, secret, { apiKey, enabled: true });
    const faq = ticket('Что такое ДМ?');
    assert.equal((await managedContestModel({ ticket: faq, baseline: triage(faq), corpus: EMPTY_CORPUS, db, secret, clientHash: 'a', fetcher })).review.errorCode, 'trusted_local_faq');
    assert.equal((await readAiSettings(db)).used, 0);
  } finally { sqlite.close(); }
});

test('concurrent identical requests reserve once and incomplete results never trigger a retry', async () => {
  const { sqlite, db } = await enabled(); let calls = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const fetcher = (async () => { calls++; await held; return envelope(); }) as typeof fetch;
  const t = ticket(), input = { ticket: t, baseline: triage(t), corpus: EMPTY_CORPUS, db, secret, clientHash: 'a', fetcher };
  try {
    const first = managedContestModel(input);
    while (!calls) await new Promise(resolve => setTimeout(resolve, 1));
    await assert.rejects(managedContestModel(input), ContestInProgressError);
    release(); await first;
    assert.equal(calls, 1); assert.equal((await readAiSettings(db)).used, 1);
    sqlite.prepare('UPDATE ai_requests SET result_json = NULL, created_at = 0').run();
    assert.equal((await managedContestModel(input)).review.errorCode, 'interrupted');
    assert.equal(calls, 1);
  } finally { release(); sqlite.close(); }
});

test('cached unsafe draft is rejected without spending another attempt', async () => {
  const { sqlite, db } = await enabled(); let calls = 0;
  const t = ticket(), input = { ticket: t, baseline: triage(t), corpus: EMPTY_CORPUS, db, secret, clientHash: 'a', fetcher: (async () => { calls++; return envelope(); }) as typeof fetch };
  try {
    await managedContestModel(input);
    const stored = JSON.parse(String(sqlite.prepare('SELECT result_json FROM ai_requests').get()?.result_json));
    stored.decision.citation_ids = ['invented-rule'];
    sqlite.prepare('UPDATE ai_requests SET result_json = ?').run(JSON.stringify(stored));
    assert.equal((await managedContestModel(input)).review.errorCode, 'invalid_saved_result');
    assert.equal(calls, 1); assert.equal((await readAiSettings(db)).used, 1);
  } finally { sqlite.close(); }
});

test('AI review does not inherit incorrect local language or category-selected sources', async () => {
  const { sqlite, db } = await enabled();
  const t = ticket();
  const local = triage(t);
  const baseline = { ...local, lang: 'kk' as const, meta: { ...local.meta, citations: [{ id: 'wrong:1', section: 'Wrong local topic', ref: '1', text: 'WRONG_LOCAL_ANCHOR' }] } };
  try {
    const fetcher: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const data = JSON.parse(request.input[1].content);
      assert.equal(data.language_hint, 'und');
      assert.deepEqual(data.sources, []);
      assert.equal(JSON.stringify(request).includes('WRONG_LOCAL_ANCHOR'), false);
      return envelope();
    };
    const result = await managedContestModel({ ticket: t, baseline, corpus: EMPTY_CORPUS, db, secret, clientHash: 'visitor-independent', fetcher });
    assert.equal(result.triage.lang, 'ru');
    assert.equal(result.triage.category, 'report.payment');
  } finally { sqlite.close(); }
});

test('transactional rate limiter bounds concurrent clients and cookie rotation, then expires', async () => {
  const { sqlite, db } = fixture(), now = 123_000;
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => allowContestRequest(db, 'same-client', now)));
    assert.equal(results.filter(Boolean).length, 6);
    const others = await Promise.all(Array.from({ length: 20 }, (_, i) => allowContestRequest(db, `other-${i}`, now)));
    assert.equal(others.filter(Boolean).length, 14);
    assert.equal(await allowContestRequest(db, 'same-client', now + 60_000), true);
  } finally { sqlite.close(); }
});

test('AI draft stays manual and substantive decisions recover locally moderated cases', () => {
  const original = 'Оплатил донат, деньги не пришли', local = processSupportMessage(original);
  const result = { ...triage(ticket(original)), meta: { ...triage(ticket(original)).meta, mode: 'rules+ai' as const } };
  const review = { outcome: 'replaced' as const, promptVersion: 'test' };
  const updated = applyContestToSupport(original, local, result, review);
  assert.equal(updated.processing.route, 'help'); assert.equal(updated.processing.knowledge?.answer, undefined);
  for (const route of ['trash', 'violation'] as const) {
    const marked = { ...local, status: route, processing: { ...local.processing, route, classification: route } };
    const kept = applyContestToSupport(original, marked, result, review);
    assert.equal(kept.processing.route, 'help'); assert.equal(kept.status, 'pending');
    assert.equal(kept.processing.algorithm?.route, route);
    assert.equal(kept.processing.triage?.meta.moderation_flag, route === 'violation');
    assert.equal(kept.processing.knowledge?.answer, undefined);
  }
});

test('all mode reviews a verified FAQ and greeting whereas uncertain skips them', async () => {
  const { sqlite, db } = await enabled(); let calls = 0;
  const fetcher = (async () => { calls++; return envelope(); }) as typeof fetch;
  const run = (text: string) => { const t = ticket(text); return managedContestModel({ ticket: t, baseline: triage(t), corpus: EMPTY_CORPUS, db, secret, clientHash: 'a', fetcher }); };
  try {
    await updateAiSettings(db, secret, { mode: 'uncertain' });
    assert.equal((await run('Что такое ДМ?')).review.errorCode, 'trusted_local_faq');
    assert.equal((await run('Привет!')).review.errorCode, 'trivial_greeting');
    assert.equal(calls, 0);
    await updateAiSettings(db, secret, { mode: 'all' });
    assert.equal((await run('Что такое ДМ?')).review.outcome, 'replaced');
    assert.equal((await run('Привет!')).review.outcome, 'replaced');
    assert.equal(calls, 2);
    assert.equal((await readAiSettings(db)).used, 2);
  } finally { sqlite.close(); }
});

test('failed all-mode FAQ review retains its cost and reservation through a knowledge refresh', async () => {
  const { sqlite, db } = await enabled(); let calls = 0;
  const t = ticket('Что такое ДМ?');
  const fetcher = (async () => {
    calls++;
    const body = await envelope().json() as { output: { content: { text: string }[] }[] };
    const decision = JSON.parse(body.output[0].content[0].text);
    decision.citation_ids = ['not-a-supplied-source'];
    body.output[0].content[0].text = JSON.stringify(decision);
    return Response.json(body);
  }) as typeof fetch;
  try {
    const reviewed = await managedContestModel({ ticket: t, baseline: triage(t), corpus: EMPTY_CORPUS, db, secret, clientHash: 'a', fetcher });
    assert.equal(reviewed.review.outcome, 'unavailable');
    assert.ok((reviewed.triage.meta.api_cost_usd ?? 0) > 0);
    const refreshedLocal = processSupportMessage('Что такое ДМ?', undefined, []);
    const refreshed = refreshTriageAfterKnowledgeChange(reviewed.triage, triage(t, { support: refreshedLocal, entries: [] }), reviewed.review);
    const processed = applyContestToSupport('Что такое ДМ?', refreshedLocal, refreshed, reviewed.review);
    const service = createSupportState('saved', 1, processed.processing.knowledge?.status === 'answered' ? processed.processing.knowledge : undefined);
    assert.equal(refreshed.meta.api_cost_usd, reviewed.triage.meta.api_cost_usd);
    assert.ok(refreshed.reasons.some(reason => reason.includes('unsafe_or_invalid_draft')));
    assert.equal(service.reply, undefined);
    assert.equal(service.state, 'queued');
    assert.equal(calls, 1);
    assert.equal((await readAiSettings(db)).used, 1);
  } finally { sqlite.close(); }
});
