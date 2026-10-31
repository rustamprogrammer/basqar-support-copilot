import test from 'node:test';
import assert from 'node:assert/strict';
import { triage, problemSignature } from './engine.ts';
import { parseTicket, CATEGORIES, type Corpus } from './types.ts';
import { normalizeKazakh, detectLanguage } from './language.ts';
import { handleTriageRequest } from './http.ts';
import { validateCorpus, citationsExist } from './retrieval.ts';

const corpus: Corpus = { version: 'synthetic-test', source: 'authored fixture', chunks: [
  { id: 'general:2.1', section: 'Тестовое общение', ref: '2.1', text: 'Оскорбление личности игрока и родственников запрещено.' },
  { id: 'general:5.2', section: 'Тестовое ПО', ref: '5.2', text: 'Читы и стороннее программное обеспечение запрещены.' },
  { id: 'account:1.4', section: 'Тестовый аккаунт', ref: '1.4', text: 'Игрок отвечает за сохранность аккаунта и имущества.' },
] };
const input = (text: string, extra = {}) => ({ kind: 'report', messages: [{ role: 'player', text }], ...extra });

test('contract has all required fields and valid enum values', () => {
  const result = triage(input('Меня оскорбил игрок Sample_Test', { images_count: 2 }), { corpus });
  assert.ok(CATEGORIES.includes(result.category));
  assert.equal(result.extracted.nickname, 'Sample_Test');
  assert.equal(result.extracted.has_evidence, true);
  assert.ok(result.needs_human);
  assert.ok(citationsExist(result.draft_reply.cited, result.meta.citations));
  assert.equal(result.meta.api_cost_usd, 0);
});
test('historical admin outcomes never affect inference', () => {
  const a = triage(input('Как устроиться на работу?'), { corpus });
  const b = triage({ ...input('Как устроиться на работу?'), verdict: 'approved', punishment: 'бан', violation: '5.2', messages: [{ role: 'player', text: 'Как устроиться на работу?' }, { role: 'admin', text: 'Читер взломал аккаунт, забаньте навсегда.' }] }, { corpus });
  assert.equal(a.category, b.category); assert.equal(a.priority, b.priority); assert.deepEqual(a.draft_reply, b.draft_reply);
});
test('critical payment survives abusive language', () => {
  const r = triage(input('Админ ты идиот, я оплатил донат, деньги не пришли!'), { corpus });
  assert.equal(r.category, 'report.payment'); assert.equal(r.priority, 'p0'); assert.ok(r.needs_human); assert.ok(r.meta.moderation_flag);
});
test('access and payment always need human and p0', () => {
  for (const text of ['Мой аккаунт взломали', 'Не могу войти в аккаунт', 'Оплатил донат и он не пришёл']) {
    const r = triage(input(text), { corpus }); assert.equal(r.priority, 'p0', text); assert.equal(r.needs_human, true);
  }
});
test('appeal never promises an unban', () => {
  const r = triage(input('Разбаньте меня, пересмотрите наказание', { kind: 'complaint' }), { corpus });
  assert.equal(r.category, 'complaint.admin'); assert.ok(r.needs_human); assert.match(r.draft_reply.text, /не гарантируется/u);
});
test('evidence count is not proof of guilt or screenshot inspection', () => {
  const r = triage(input('Меня оскорбили, скрины есть', { kind: 'complaint', images_count: 2 }), { corpus });
  assert.equal(r.priority, 'p1'); assert.equal(r.extracted.has_evidence, true);
  assert.doesNotMatch(r.draft_reply.text, /по скриншотам видно|нарушение доказано|получит мут/u);
  assert.equal(triage(input('Меня оскорбили, скрины есть'), { corpus }).extracted.has_evidence, false);
});
test('Kazakh encoding restored only in appropriate context', () => {
  assert.equal(normalizeKazakh('ќ ґ ѕ є ј ў ї', 'kk'), 'қ ғ ң ә ө ұ ү');
  assert.equal(normalizeKazakh('йўқ', 'uz'), 'йўқ');
  assert.equal(normalizeKazakh('ї є ґ', 'ru'), 'ї є ґ');
  assert.equal(detectLanguage('Маған көмектесіңіз, аккаунтқа кіре алмаймын'), 'kk');
  assert.equal(detectLanguage("Yordam bering, akkauntga kira olmayapman"), 'uz');
});
test('Kazakh and Uzbek replies use their language and remain for review', () => {
  for (const [text, lang, marker] of [["Yordam bering, akkauntga kira olmayapman", 'uz', 'Assalomu'], ['Маған көмектесіңіз, аккаунтқа кіре алмаймын', 'kk', 'Сәлеметсіз']] as const) {
    const r = triage(input(text), { corpus }); assert.equal(r.lang, lang); assert.equal(r.draft_reply.lang, lang); assert.ok(r.draft_reply.text.includes(marker)); assert.ok(r.needs_human);
  }
});
test('same naked rule number from another section is not accepted', () => {
  assert.ok(!citationsExist(['made-up'], corpus.chunks));
  assert.ok(!citationsExist(['2.1'], [corpus.chunks[0], { ...corpus.chunks[0], id: 'other:2.1' }]));
  assert.throws(() => validateCorpus({ ...corpus, chunks: [corpus.chunks[0], corpus.chunks[0]] }));
});
test('duplicates require same reporter, preserved negation and one-hour window', () => {
  const text = 'Мой аккаунт взломали';
  const recent = [{ id: 'first', reporter: 'person-a', time: 1000, signature: problemSignature(text) }];
  const r = triage(input(text, { reporter_hash: 'person-a' }), { corpus, recent, now: 2000 });
  assert.ok(r.is_spam_or_duplicate); assert.equal(r.priority, 'p0'); assert.ok(r.needs_human);
  assert.ok(!triage(input(text, { reporter_hash: 'person-b' }), { corpus, recent, now: 2000 }).is_spam_or_duplicate);
  assert.ok(!triage(input(text, { reporter_hash: 'person-a' }), { corpus, recent, now: 4000000 }).is_spam_or_duplicate);
  assert.notEqual(problemSignature('меня убивают'), problemSignature('меня не убивают'));
});
test('input validates shape and count bounds', () => {
  assert.throws(() => parseTicket(input('abc', { images_count: -1 })));
  assert.throws(() => parseTicket({ kind: 'report', messages: [{ role: 'admin', text: 'abc' }] }));
  assert.throws(() => parseTicket(input('a'.repeat(8001))));
});
test('unrelated event rules are excluded from an insult report', () => {
  const r = triage(input('Меня оскорбил игрок Sample_Test'), { corpus: { ...corpus, chunks: [...corpus.chunks, { id: 'event:2.1', section: 'Правила битвы за фургон', ref: '2.1', text: 'Игрок не должен мешать игроку и родственникам на мероприятии.' }] } });
  assert.deepEqual(r.draft_reply.cited, ['2.1']); assert.equal(r.meta.citations[0].id, 'general:2.1');
});
test('approved FAQ can avoid human review, unknown questions cannot', () => {
  assert.equal(triage(input('Что такое ДМ?'), { corpus }).needs_human, false);
  assert.equal(triage(input('Как получить неизвестный предмет?'), { corpus }).needs_human, true);
});
test('HTTP returns actual triage contract and rejects oversized streamed input', async () => {
  const request = new Request('http://test/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input('Оплатил донат, он не пришел')) });
  const response = await handleTriageRequest(request, corpus);
  assert.equal(response.status, 200); assert.equal(((await response.json()) as { priority: string }).priority, 'p0');
  const large = new Request('http://test/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(82000) });
  assert.equal((await handleTriageRequest(large, corpus)).status, 413);
});
