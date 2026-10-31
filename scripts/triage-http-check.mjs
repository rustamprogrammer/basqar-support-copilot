import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = process.argv[2] ?? 'http://127.0.0.1:8788';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Run only against an isolated local test database.');
let cookie = '';
async function call(path, body) {
  const start = performance.now();
  const r = await fetch(base + path, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } });
  const set = r.headers.getSetCookie(); if (set.length) cookie = set.map(v => v.split(';')[0]).join('; ');
  return { status: r.status, data: await r.json(), ms: performance.now() - start };
}
const health = await call('/api/health');
assert.equal(health.status, 200); assert.equal(health.data.aiReviewEnabled, false, 'Never run this check against an enabled paid reviewer.');
assert.equal(health.data.publicDemo, true, 'Use a disposable demo database.');
const before = health.data.aiUsed;
const cases = (await readFile(new URL('../evaluation/triage-regression.jsonl', import.meta.url), 'utf8')).trim().split(/\r?\n/u).map(JSON.parse);
const times = [];
for (const row of cases) {
  const r = await call('/triage', row.ticket); assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.category, row.expected.category); assert.equal(r.data.priority, row.expected.priority);
  assert.equal(r.data.meta.api_cost_usd, 0); times.push(r.ms);
}
const owner = crypto.randomUUID(), payload = { kind: 'report', reporter_hash: owner, messages: [{ role: 'player', text: 'Мой аккаунт взломали' }] };
assert.equal((await call('/triage', { ...payload, ticket_id: 'one' })).data.is_spam_or_duplicate, false);
assert.equal((await call('/triage', { ...payload, ticket_id: 'two' })).data.is_spam_or_duplicate, true);
assert.equal((await call('/triage', { ...payload, ticket_id: 'two' })).data.priority, 'p0');
const message = { id: crypto.randomUUID(), text: 'Меня оскорбил игрок Sample_Test' };
let sent = await call('/api/messages', message);
if (sent.status === 409 && sent.data.code === 'session_required') sent = await call('/api/messages', message);
assert.equal(sent.status, 201, JSON.stringify(sent.data));
assert.ok(sent.data.processing.triage.draft_reply.text); assert.ok(sent.data.processing.triage.meta.citations.length);
const draft = sent.data.processing.triage.draft_reply.text;
const reply = await call('/api/service', { id: message.id, revision: sent.data.service.revision, action: 'reply', text: draft + '\nПроверено администратором.' });
assert.equal(reply.status, 200); assert.equal(reply.data.service.state, 'answered');
assert.equal(reply.data.processing.triage.draft_reply.text, draft, 'Original draft remains unchanged.');
const stale = await call('/api/service', { id: message.id, revision: 0, action: 'release' }); assert.equal(stale.status, 409);
const escalated = await call('/api/service', { id: message.id, revision: reply.data.service.revision, action: 'escalate', reason: 'Требуется старший администратор' });
assert.equal(escalated.status, 200); assert.ok(escalated.data.service.escalatedAt);
assert.equal(escalated.data.service.reply.text, reply.data.service.reply.text);
assert.equal((await call('/api/health')).data.aiUsed, before, 'No provider reservations were made.');
const firstRequestMs = times[0] ?? null;
times.sort((a, b) => a - b);
console.log(JSON.stringify({ httpCases: cases.length, categoryAndPriorityCorrect: cases.length, firstRequestMs, httpP95Ms: times[Math.ceil(times.length * .95) - 1], maxMs: times.at(-1), workflow: 'draft/edit/reply/stale-write/escalation passed', persistentDedup: 'passed', paidAttempts: 0, note: 'Authored regressions, isolated local database, reviewer disabled; not real-world accuracy or AI latency.' }));
