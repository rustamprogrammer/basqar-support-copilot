import test from 'node:test';
import assert from 'node:assert/strict';
import { triage, ticketSignature } from './engine.ts';
import { parseTicket, type Corpus } from './types.ts';
import { retrieveRules } from './retrieval.ts';

const ticket = (text: string, kind: 'report' | 'complaint' = 'report') => ({ kind, messages: [{ role: 'player', text }] });
const corpus: Corpus = { version: 'authored-regression', source: 'synthetic', chunks: [
  { id: 'general:cheat', section: 'Общие правила', ref: '5.2', text: 'Читы и стороннее программное обеспечение запрещены.' },
  { id: 'terms:dm', section: 'RP термины', ref: 'DeathMatch', text: 'DeathMatch — убийство без игровой причины.' },
] };

test('lost access and payment variants receive critical priority', () => {
  for (const [text, category] of [
    ['У меня угнали аккаунт', 'report.account'],
    ['Не заходит в аккаунт', 'report.account'],
    ['Почему я не могу зайти в аккаунт?', 'report.account'],
    ['Как восстановить аккаунт, его украли?', 'report.account'],
    ['Списали деньги с карты, а GC не начислили', 'report.payment'],
    ['Оплатил донат, ничего не пришло', 'report.payment'],
  ]) {
    const result = triage(ticket(text));
    assert.equal(result.category, category, text);
    assert.equal(result.priority, 'p0', text);
    assert.ok(result.needs_human, text);
  }
});

test('first-person instructions remain ordinary questions', () => {
  for (const text of ['Как мне оплатить донат?', 'Подскажите, как защитить мой аккаунт от взлома?', 'Как мне войти в аккаунт?']) {
    const result = triage(ticket(text));
    assert.equal(result.category, 'report.question', text);
    assert.equal(result.priority, 'p3', text);
  }
});

test('reported real-world threats stay critical across verb inflections', () => {
  for (const text of ['Он написал, что найдёт меня дома и убьёт', 'Он угрожает найти мой адрес и убить в реальной жизни', 'He threatened to kill me at my home']) {
    const result = triage(ticket(text, 'complaint'));
    assert.equal(result.priority, 'p0', text);
    assert.notEqual(result.category, 'complaint.invalid', text);
    assert.ok(result.needs_human, text);
  }
  const denied = triage(ticket('Он не угрожает найти мой адрес. Меня убили в игре.', 'complaint'));
  assert.notEqual(denied.priority, 'p0');
});

test('denied accusations do not override the asserted incident or its sources', () => {
  for (const text of [
    'Игрок убил меня, я не утверждаю, что он читер',
    'Игрок не оскорблял меня, он убил меня без причины',
    'Меня убили, но никаких читов не было',
    'Меня убили. Читов не было.',
  ]) {
    const result = triage({ ...ticket(text, 'complaint'), images_count: 1 }, { corpus });
    assert.equal(result.category, 'complaint.dm', text);
    assert.deepEqual(result.meta.citations.map(rule => rule.id), ['terms:dm'], text);
  }
  const positive = triage(ticket('Первый игрок не читер, но второй игрок использует читы', 'complaint'));
  assert.equal(positive.category, 'complaint.cheat');
});

test('taxonomy separates rule questions, mechanics and property from lost access', () => {
  for (const text of ['Что такое ДМ?', 'ДМ деген не?', 'DM nima degani?', 'Какие правила поведения в чате?']) {
    assert.equal(triage(ticket(text)).priority, 'p2', text);
  }
  assert.equal(triage(ticket('Как устроиться на работу?')).priority, 'p3');
  const property = triage(ticket('Пропала машина'));
  assert.equal(property.category, 'report.account');
  assert.equal(property.priority, 'p2');
  assert.ok(property.needs_human);
  assert.equal(triage(ticket('Помогите')).category, 'report.offtopic');
});

test('access cases retain their language and require review in all six supported languages', () => {
  for (const [lang, text] of [
    ['ru', 'Мой аккаунт украли, помогите'],
    ['kk', 'Аккаунтымды ұрлап кетті, көмектесіңіз'],
    ['uz', "Akkauntimni o'g'irlashdi, yordam bering"],
    ['en', 'Please help, I cannot log in to my account'],
    ['es', 'Ayuda, no puedo entrar en mi cuenta'],
    ['pt', 'Ajuda, não consigo entrar na minha conta'],
  ]) {
    const result = triage(ticket(text));
    assert.equal(result.category, 'report.account', text);
    assert.equal(result.priority, 'p0', text);
    assert.equal(result.lang, lang, text);
    assert.equal(result.draft_reply.lang, lang, text);
    assert.ok(result.needs_human, text);
  }
});

test('payment cases retain their language and require review in all six supported languages', () => {
  for (const [lang, text] of [
    ['ru', 'Оплатил донат, покупка не пришла'],
    ['kk', 'Мен төледім, бірақ ақша түспеді, көмектесіңіз'],
    ['uz', "To'ladim, lekin pul tushmadi, yordam bering"],
    ['en', 'I paid but did not receive my purchase'],
    ['es', 'Pagué pero no recibí la compra, ayuda'],
    ['pt', 'Paguei mas não recebi a compra, ajuda'],
  ]) {
    const result = triage(ticket(text));
    assert.equal(result.category, 'report.payment', text);
    assert.equal(result.priority, 'p0', text);
    assert.equal(result.lang, lang, text);
    assert.equal(result.draft_reply.lang, lang, text);
    assert.ok(result.needs_human, text);
  }
});

test('batch-style duplicate history uses the same restored Kazakh signature as lookup', () => {
  const first = parseTicket({ ...ticket('Маған кјмектесіѕіз, аккаунтќа кіре алмаймын'), lang: 'kk', ticket_id: 'first', reporter_hash: 'reporter', created_at: '2026-10-31T10:00:00Z' });
  const recent = [{ id: first.ticket_id!, reporter: first.reporter_hash!, time: Date.parse(first.created_at!), signature: ticketSignature(first) }];
  for (const text of [first.messages[0].text, 'Маған көмектесіңіз, аккаунтқа кіре алмаймын']) {
    const result = triage({ ...first, ticket_id: 'second', created_at: '2026-10-31T10:01:00Z', messages: [{ role: 'player', text }] }, { recent });
    assert.equal(result.is_spam_or_duplicate, true, text);
    assert.equal(result.meta.duplicate_of, 'first');
    assert.equal(result.priority, 'p0');
  }
});

test('admin outcomes and admin threats do not change incident inference', () => {
  const original = ticket('Как мне оплатить донат?');
  const result = triage({ ...original, verdict: 'approved', violation: '5.2', punishment: 'ban', messages: [...original.messages, { role: 'admin', text: 'Аккаунт взломали. Найду тебя дома и убью. Платёж пропал.' }] });
  assert.equal(result.category, 'report.question');
  assert.equal(result.priority, 'p3');
});

test('successful access does not turn a property loss into account lockout', () => {
  const accessible = triage(ticket("Mulklar ro'yxatidan uyim yo'qoldi, lekin akkauntga kira olaman."));
  assert.equal(accessible.category, 'report.account');
  assert.equal(accessible.priority, 'p2');
  const locked = triage(ticket("Mulklar ro'yxatidan uyim yo'qoldi va akkauntga kira olmayapman."));
  assert.equal(locked.category, 'report.account');
  assert.equal(locked.priority, 'p0');
  const kazakh = triage(ticket('Көлігім жоғалды, аккаунтқа кіре аламын.'));
  assert.equal(kazakh.category, 'report.account');
  assert.equal(kazakh.priority, 'p2');
});

test('lost-access phrases cover Portuguese and Spanish without assuming theft', () => {
  for (const text of ['Estou sem acesso à minha conta.', 'Perdi acesso à conta depois de mudar o telefone.', 'Estoy sin acceso a mi cuenta.']) {
    const result = triage(ticket(text));
    assert.equal(result.category, 'report.account', text);
    assert.equal(result.priority, 'p0', text);
  }
});

test('collective failures are critical while one player crashing is ordinary help', () => {
  for (const text of ['All players are disconnected when opening the garage.', 'Every member of our group crashes when joining the event.', 'A widespread failure prevents the mission from opening.']) {
    assert.equal(triage(ticket(text)).priority, 'p0', text);
  }
  assert.notEqual(triage(ticket('My game crashes when I open the garage.')).priority, 'p0');
  assert.notEqual(triage(ticket('There is no widespread failure. My game works.')).priority, 'p0');
});

test('glossary retrieval uses actual terms and conservative cross-language concepts', () => {
  const glossary: Corpus = { version: 'test', source: 'authored definitions', chunks: [
    { id: 'terms:mg', section: 'RP термины', ref: 'MetaGaming', text: 'MetaGаming (MG) — использование внешних сведений персонажем.' },
    { id: 'terms:rk', section: 'RP термины', ref: 'Revenge Kill', text: 'Revenge Kill (RK) — возвращение на место смерти ради мести.' },
    { id: 'terms:rp', section: 'RP термины', ref: 'RolePlay', text: 'RolePlay (RP) — игра от лица персонажа.' },
  ] };
  for (const text of [
    'Что такое МГ?', 'MG деген не?', 'MG nima degani?', 'What is metagaming?',
    'Can my character use information I heard in Discord?',
    '¿Puede mi personaje usar información de Discord?',
    'Meu personagem pode usar informações de Discord?',
  ]) assert.deepEqual(retrieveRules(text, 'report.question', glossary).map(rule => rule.id), ['terms:mg'], text);
  assert.deepEqual(retrieveRules('Can I return to where I died to get revenge?', 'report.question', glossary).map(rule => rule.id), ['terms:rk']);
  assert.deepEqual(retrieveRules('Discord does not open, help', 'report.question', glossary), []);
  assert.deepEqual(retrieveRules('Can my character remember events after death?', 'report.question', glossary), []);
  assert.deepEqual(retrieveRules('How can I open a bank account?', 'report.question', glossary), []);
});
