import test from 'node:test';
import assert from 'node:assert/strict';
import { triage } from './engine.ts';
import { buildContestRequest, validateModelDecision, requestContestModel, applyContestModel, contestCost, enforceContestPriority, MAX_PROVIDER_BODY_BYTES } from './model.ts';
import type { ModelDecision } from './model.ts';
import type { Ticket } from './types.ts';

const ticket: Ticket = { kind: 'complaint', images_count: 1, messages: [{ role: 'player', text: 'Игрок оскорбил меня' }, { role: 'admin', text: 'SECRET HISTORICAL VERDICT' }] };
const sources = [{ id: 'test:1', section: 'Общие правила', ref: '1.1', text: 'Оскорбления игроков запрещены.' }];
const baseline = triage(ticket);
const decision: ModelDecision = { lang: 'ru', category: 'complaint.insult', priority: 'p1', draft: 'Здравствуйте! Администратор проверит сообщение и приложенные материалы.', citation_ids: ['test:1'], needs_human: true, reason: 'Заявлено оскорбление и указано вложение.' };
test('model receives player text and bounded sources, never historical outcomes', () => {
  const request = buildContestRequest(ticket, baseline, sources);
  assert.equal(request.store, false);
  assert.equal(request.service_tier, 'default');
  assert.deepEqual(request.prompt_cache_options, { mode: 'implicit', ttl: '30m' });
  assert.ok(!JSON.stringify(request).includes('SECRET HISTORICAL VERDICT'));
  assert.throws(() => buildContestRequest(ticket, baseline, sources, 'unknown-model'));
});

test('message-level attachments cannot be hidden by an explicit zero total', () => {
  const attached = { ...ticket, images_count: 0, messages: [{ role: 'player' as const, text: 'Complaint with an attachment', attachments: 2 }] };
  assert.equal(JSON.parse(buildContestRequest(attached, baseline, sources).input[1].content).images_count, 2);
  assert.equal(JSON.parse(buildContestRequest({ ...attached, images_count: 2 }, baseline, sources).input[1].content).images_count, 2);
});
test('model rejects invented references, channel changes and automatic verdicts', () => {
  assert.equal(validateModelDecision(decision, ticket, sources), true);
  for (const patch of [{ citation_ids: ['fake'] }, { category: 'report.question' }, { needs_human: false }, { draft: 'Игрок получит мут.' }, { draft: 'По скриншотам видно нарушение.' }, { draft: 'Нарушен пункт 99.1.' }]) {
    assert.equal(validateModelDecision({ ...decision, ...patch }, ticket, sources), false);
  }
});
test('successful response preserves metadata and server-controlled citation labels', async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    assert.equal(init?.redirect, 'manual');
    return Response.json({ status: 'completed', model: 'gpt-6-luna', usage: { input_tokens: 1000, output_tokens: 200 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(decision) }] }] });
  };
  const response = await requestContestModel(ticket, baseline, sources, 'test-key', { fetcher });
  assert.equal(response.ok, true);
  const result = applyContestModel(baseline, response, sources);
  assert.equal(result.needs_human, true);
  assert.deepEqual(result.draft_reply.cited, ['1.1']);
  assert.equal(result.meta.api_cost_usd, 0.0002);
  assert.equal(result.meta.mode, 'rules+ai');
});
test('failures retain local draft and never claim zero unknown cost', async () => {
  const response = await requestContestModel(ticket, baseline, sources, 'test-key', { fetcher: async () => { throw new Error('secret transport detail'); } });
  assert.equal(response.ok, false);
  assert.equal(response.costUsd, null);
  assert.equal(applyContestModel(baseline, response, sources).draft_reply.text, baseline.draft_reply.text);
  assert.ok(!JSON.stringify(response).includes('secret'));
});
test('missing usage cannot produce a false zero-cost success', async () => {
  const response = await requestContestModel(ticket, baseline, sources, 'key', { fetcher: async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(decision) }] }] }) });
  assert.equal(response.ok, false);
  assert.equal(response.costUsd, null);
  assert.equal(contestCost({ inputTokens: 1000, cachedTokens: 500, outputTokens: 100, cacheWriteTokens: 0 }), 0.000105);
});
test('taxonomy priorities do not depend on whether allegations are already proven', () => {
  assert.equal(enforceContestPriority(baseline, { ...decision, priority: 'p3' }), 'p1');
  assert.equal(enforceContestPriority({ ...baseline, extracted: { ...baseline.extracted, has_evidence: false } }, { ...decision, category: 'complaint.cheat', priority: 'p3' }), 'p1');
  assert.equal(enforceContestPriority({ ...baseline, priority: 'p0' }, { ...decision, category: 'report.account', priority: 'p2' }), 'p2');
  assert.equal(enforceContestPriority(baseline, { ...decision, category: 'report.help', priority: 'p3' }), 'p2');
  assert.equal(enforceContestPriority({ ...baseline, category: 'report.question', priority: 'p2' }, { ...decision, category: 'report.question', priority: 'p3' }), 'p3');
});

const providerBody = () => ({ status: 'completed', model: 'gpt-6-luna', usage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(decision) }] }] });

test('one decision can span multiple text fragments but multiple decisions are rejected', async () => {
  const raw = JSON.stringify(decision), body = providerBody();
  body.output[0].content = [raw.slice(0, 30), raw.slice(30)].map(text => ({ type: 'output_text', text }));
  const split = await requestContestModel(ticket, baseline, sources, 'key', { fetcher: async () => Response.json(body) });
  assert.equal(split.ok, true);
  body.output[0].content = [raw, raw].map(text => ({ type: 'output_text', text }));
  const duplicate = await requestContestModel(ticket, baseline, sources, 'key', { fetcher: async () => Response.json(body) });
  assert.equal(duplicate.ok, false);
  assert.equal(!duplicate.ok && duplicate.code, 'invalid_json');
  body.output[0].content = [];
  const empty = await requestContestModel(ticket, baseline, sources, 'key', { fetcher: async () => Response.json(body) });
  assert.equal(empty.ok, false);
});

test('source passages are identical in model context and citation metadata', () => {
  const original = { ...sources[0], text: 'Исходный фрагмент. '.repeat(100) + 'Важное исключение в конце.' };
  const request = buildContestRequest(ticket, baseline, [original]);
  const data = JSON.parse(request.input[1].content);
  assert.equal(data.sources[0].text, original.text);
});

test('cost upper bound rejects oversized context before calling the provider', async () => {
  let calls = 0;
  const result = await requestContestModel(ticket, baseline, [{ ...sources[0], text: 'я'.repeat(20_000) }], 'key', { fetcher: async () => { calls++; return Response.json(providerBody()); } });
  assert.equal(result.ok, false); assert.equal(!result.ok && result.code, 'ticket_cost_limit');
  assert.equal(result.costUsd, 0); assert.equal(calls, 0);
});

test('preflight reserves the cold cache-write rate rather than ordinary input rate', async () => {
  const testSources = [{ ...sources[0], text: '' }];
  const baseBytes = new TextEncoder().encode(JSON.stringify(buildContestRequest(ticket, baseline, testSources))).length;
  testSources[0].text = 'x'.repeat(14_000 - baseBytes);
  let calls = 0;
  const result = await requestContestModel(ticket, baseline, testSources, 'key', { fetcher: async () => { calls++; return Response.json(providerBody()); } });
  assert.equal(!result.ok && result.code, 'ticket_cost_limit'); assert.equal(calls, 0); assert.equal(result.costUsd, 0);
});

test('actual 30-minute cache-write usage succeeds and matches standard billing', async () => {
  const body = providerBody();
  body.usage = { input_tokens: 1269, output_tokens: 116, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1266 } };
  const result = await requestContestModel(ticket, baseline, sources, 'key', { fetcher: async () => Response.json(body) });
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.costUsd! - 0.00021655) < 1e-12);
  const applied = applyContestModel(baseline, result, sources);
  assert.equal(applied.meta.mode, 'rules+ai'); assert.equal(applied.meta.provider_usage?.cacheWriteTokens, 1266);
  assert.equal(contestCost({ inputTokens: 1000, outputTokens: 100, cachedTokens: 400, cacheWriteTokens: 500 }), 0.0001265);
});

test('cache reads and writes must be valid disjoint portions of the input', async () => {
  for (const details of [
    { cached_tokens: 500, cache_write_tokens: 501 },
    { cached_tokens: 0, cache_write_tokens: -1 },
    { cached_tokens: 0, cache_write_tokens: 1.5 },
  ]) {
    const body = providerBody(); body.usage.input_tokens_details = details;
    const result = await requestContestModel(ticket, baseline, sources, 'key', { fetcher: async () => Response.json(body) });
    assert.equal(result.ok, false); assert.equal(result.costUsd, null);
  }
});

test('deadline covers a fetcher that ignores AbortSignal', async () => {
  const start = performance.now();
  const result = await requestContestModel(ticket, baseline, sources, 'key', { timeoutMs: 20, fetcher: async () => new Promise<Response>(() => undefined) });
  assert.equal(!result.ok && result.code, 'timeout'); assert.equal(result.costUsd, null);
  assert.ok(performance.now() - start < 500);
});

test('deadline covers a stalled provider body and nonsettling cancellation', async () => {
  const start = performance.now();
  const result = await requestContestModel(ticket, baseline, sources, 'key', { timeoutMs: 20, fetcher: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { return new Promise<void>(() => undefined); } })) });
  assert.equal(!result.ok && result.code, 'timeout'); assert.equal(result.costUsd, null);
  assert.ok(performance.now() - start < 500);
});

test('oversized streamed provider body is cancelled with unknown cost', async () => {
  let cancelled = false;
  const result = await requestContestModel(ticket, baseline, sources, 'key', { fetcher: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_PROVIDER_BODY_BYTES + 1)); }, cancel() { cancelled = true; } })) });
  assert.equal(!result.ok && result.code, 'response_too_large'); assert.equal(result.costUsd, null); assert.equal(cancelled, true);
});

test('malformed usage, unknown pricing, tool output and incomplete responses cannot succeed', async () => {
  for (const mutation of [
    (body: ReturnType<typeof providerBody>) => { body.usage.input_tokens_details.cached_tokens = -1; },
    (body: ReturnType<typeof providerBody>) => { body.usage.input_tokens_details.cached_tokens = 0.5; },
    (body: ReturnType<typeof providerBody>) => { body.usage.input_tokens_details.cached_tokens = 2000; },
    (body: ReturnType<typeof providerBody>) => { body.usage.output_tokens = 0; },
    (body: ReturnType<typeof providerBody>) => { body.model = 'unpriced-model'; },
    (body: ReturnType<typeof providerBody>) => { body.output[0].role = 'user'; },
    (body: ReturnType<typeof providerBody>) => { body.output[0].type = 'function_call'; },
    (body: ReturnType<typeof providerBody>) => { body.status = 'incomplete'; },
  ]) {
    const body = providerBody(); mutation(body);
    const result = await requestContestModel(ticket, baseline, sources, 'key', { fetcher: async () => Response.json(body) });
    assert.equal(result.ok, false);
    if (body.model === 'unpriced-model' || body.usage.input_tokens_details.cached_tokens !== 0) assert.equal(result.costUsd, null);
  }
});

test('unsourced commands, destinations, sanction durations and credential requests are rejected', () => {
  for (const draft of ['Введите /freecoins для получения денег.', 'Откройте https://evil.invalid для входа.', 'Выдадим мут на 30 минут.', 'Пришлите пароль для проверки.', 'Не сообщайте пароль посторонним. Пришлите пароль нам.']) {
    assert.equal(validateModelDecision({ ...decision, draft }, ticket, sources), false, draft);
  }
  assert.equal(validateModelDecision({ ...decision, draft: 'Не сообщайте пароль или коды входа. Администратор проверит обращение.' }, ticket, sources), true);
});

test('apply independently rejects invalid sources and keeps human-reviewed template fallback', () => {
  const bad = { ok: true as const, decision: { ...decision, citation_ids: ['invented'] }, model: 'gpt-6-luna', usage: { inputTokens: 1000, outputTokens: 200, cachedTokens: 0, cacheWriteTokens: 0 }, costUsd: 0.0002, elapsedMs: 10 };
  const result = applyContestModel(baseline, bad, sources);
  assert.equal(result.draft_reply.text, baseline.draft_reply.text); assert.equal(result.needs_human, true);
  assert.equal(result.meta.mode, 'local'); assert.equal(result.meta.api_cost_usd, 0.0002);
});
