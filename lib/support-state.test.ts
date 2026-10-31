import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from './message-types.ts';
import { createSupportState, effectiveState, effectiveUrgency, latestCases, queueFlags, sortHelpQueue, updateSupportState, type ServiceAction } from './support-state.ts';

const now = 1_800_000_000_000;
function message(id = 'case-a', createdAt = now, level: 'now' | 'high' | 'normal' = 'normal'): Message {
  return { id, text: 'Нужна помощь', originalText: 'Нужна помощь', status: 'pending', createdAt,
    processing: { classification: 'report', route: 'help', steps: [], urgency: { level, eventTime: 'ongoing', uncertain: false, reason: 'Нужна помощь', evidence: [], needsLiveObservation: level === 'now' } },
    service: createSupportState(id, createdAt) };
}

test('A prepared knowledge answer is delivered with an immutable source version', () => {
  const service = createSupportState('faq', now, { answer: 'ДМ — урон без причины.', entryId: 'dm', entryVersion: '2026-01' });
  assert.equal(service.state, 'answered');
  assert.deepEqual(service.reply, { text: 'ДМ — урон без причины.', author: 'knowledge', at: now, entryId: 'dm', entryVersion: '2026-01' });
  assert.equal(service.history[0].action, 'knowledge_answer');
  assert.ok(service.history[0].detail?.includes('ДМ — урон без причины.'));
  assert.ok(service.history[0].detail?.includes('2026-01'));
});

test('Missing knowledge answers stay in the administrator queue', () => {
  assert.equal(createSupportState('empty', now, {}).state, 'queued');
  assert.equal(createSupportState('empty', now, { answer: '' }).reply, undefined);
});

test('Taking a case and replying preserves the source and records each action', () => {
  const row = message(), original = structuredClone(row);
  const claimed = updateSupportState(row, 'claim', {}, now + 10, true);
  assert.equal(claimed.state, 'in_progress');
  assert.equal(claimed.claimedAt, now + 10);
  const answered = updateSupportState({ ...row, service: claimed }, 'reply', { text: '  Проверил и помог.  ' }, now + 20, true);
  assert.equal(answered.state, 'answered');
  assert.deepEqual(answered.reply, { text: 'Проверил и помог.', author: 'admin', at: now + 20 });
  assert.equal(answered.revision, 2);
  assert.deepEqual(answered.history.map(event => event.action), ['queued', 'claim', 'reply']);
  assert.deepEqual(row, original);
});

test('Two independently prepared updates do not mutate one another or the stored snapshot', () => {
  const row = message(), before = structuredClone(row);
  const reply = updateSupportState(row, 'reply', { text: 'Первый ответ' }, now + 1, true);
  const priority = updateSupportState(row, 'priority', { level: 'now', reason: 'Продолжается нападение' }, now + 2, true);
  assert.deepEqual(row, before);
  assert.equal(reply.revision, 1);
  assert.equal(priority.revision, 1);
  assert.equal(reply.reply?.text, 'Первый ответ');
  assert.equal(priority.reply, undefined);
  assert.equal(reply.history.length, 2);
  assert.equal(priority.history.length, 2);
  // Both are proposals for the same revision. The API must atomically accept
  // only one snapshot; this pure-function test does not claim to test D1 CAS.
});

test('Changing priority after an answer never overwrites the answer', () => {
  const row = message();
  row.service = updateSupportState(row, 'reply', { text: 'Сохраняемый ответ' }, now + 1, true);
  const next = updateSupportState(row, 'priority', { level: 'high', reason: 'Уточнён ущерб' }, now + 2, true);
  assert.deepEqual(next.reply, row.service.reply);
  assert.equal(next.state, 'answered');
  assert.equal(next.history.filter(event => event.action === 'reply').length, 1);
});

test('A player can mark an answer helpful and reopen the case without losing it', () => {
  const row = message();
  row.service = createSupportState(row.id, row.createdAt, { answer: 'Готовая инструкция', entryId: 'settings', entryVersion: 'v1' });
  const resolved = updateSupportState(row, 'helped', {}, now + 1, false);
  const reopened = updateSupportState({ ...row, service: resolved }, 'need_admin', {}, now + 2, false);
  assert.equal(resolved.state, 'resolved');
  assert.equal(reopened.state, 'queued');
  assert.deepEqual(reopened.reply, resolved.reply);
  assert.equal(reopened.firstReceivedAt, now);
});

test('A visitor cannot claim, answer, release, or set priority', () => {
  const row = message();
  row.service = createSupportState(row.id, now, { answer: 'Есть ответ' });
  for (const action of ['claim', 'release', 'reply', 'priority'] as ServiceAction[]) {
    assert.throws(() => updateSupportState(row, action, { text: 'Поддельный ответ', level: 'now', reason: 'Обход' }, now + 1, false), /администратора/);
  }
});

test('A visitor cannot acknowledge a response that has never been sent', () => {
  for (const action of ['helped', 'need_admin'] as const) {
    assert.throws(() => updateSupportState(message(), action, {}, now, false), /нет ответа/);
  }
});

test('Empty and oversized replies fail without changing the case', () => {
  const row = message(), before = structuredClone(row);
  for (const text of ['', '   ', 'а'.repeat(4001)]) {
    assert.throws(() => updateSupportState(row, 'reply', { text }, now, true), /4000/);
    assert.deepEqual(row, before);
  }
  assert.equal(updateSupportState(row, 'reply', { text: 'а'.repeat(4000) }, now, true).reply?.text.length, 4000);
});

test('Manual priorities require a help case and a reason', () => {
  const row = message();
  assert.throws(() => updateSupportState(row, 'priority', { level: 'now', reason: '   ' }, now, true));
  assert.throws(() => updateSupportState(row, 'priority', { level: 'now', reason: 'а'.repeat(301) }, now, true));
  assert.throws(() => updateSupportState({ ...row, processing: { classification: 'report', route: 'question', steps: [] } }, 'priority', { level: 'now', reason: 'Проверка' }, now, true), /помощи/);
  const manual = updateSupportState(row, 'priority', { level: 'high', reason: '  Проверка аккаунта  ' }, now, true);
  assert.equal(manual.manualReason, 'Проверка аккаунта');
  assert.equal(effectiveUrgency({ ...row, service: manual }), 'high');
});

test('A clarification keeps the original waiting time and case identity across generations', () => {
  const parent = message('root', now - 30 * 60_000);
  const child = { ...message('child', now - 10_000), service: createSupportState('child', now - 10_000, undefined, parent) };
  const grandchild = createSupportState('grandchild', now, undefined, child);
  assert.equal(grandchild.caseId, parent.id);
  assert.equal(grandchild.firstReceivedAt, parent.createdAt);
  assert.equal(grandchild.state, 'queued');
});

test('A clarification preserves administrator decisions and reply history without resending an old answer', () => {
  const parent = message('root', now - 50_000);
  parent.service = updateSupportState(parent, 'priority', { level: 'now', reason: 'Наблюдение администратора' }, now - 40_000, true);
  parent.service = updateSupportState(parent, 'reply', { text: 'Проверил в игре, жду уточнения.' }, now - 30_000, true);
  const child = createSupportState('child', now, undefined, parent);
  assert.equal(child.manualUrgency, 'now');
  assert.equal(child.manualReason, 'Наблюдение администратора');
  assert.ok(child.history.some(event => event.action === 'reply' && event.detail === 'Проверил в игре, жду уточнения.'));
  assert.equal(child.reply, undefined);
  assert.equal(child.state, 'queued');
});

test('A failed knowledge answer remains in the case history after a new clarification', () => {
  const parent = message('faq-parent', now - 5000);
  parent.service = createSupportState(parent.id, parent.createdAt, { answer: 'Старая инструкция', entryId: 'login', entryVersion: 'v1' });
  const child = createSupportState('faq-child', now, undefined, parent);
  assert.ok(child.history.some(event => event.action === 'knowledge_answer' && event.detail?.includes('Старая инструкция')));
  assert.equal(child.reply, undefined);
  assert.equal(child.state, 'queued');
});

test('Grouping selects one latest record per case independent of input order', () => {
  const a = message('a', now - 200), a2 = { ...message('a2', now - 100), service: createSupportState('a2', now - 100, undefined, a) }, b = message('b', now);
  assert.deepEqual(latestCases([a2, b, a]).map(row => row.id).sort(), ['a2', 'b']);
  assert.deepEqual(latestCases([a, a2, b]).map(row => row.id).sort(), ['a2', 'b']);
});

test('Case grouping uses a deterministic tie-break for simultaneous clarifications', () => {
  const parent = message('root', now - 1000), children = ['b', 'a'].map(id => ({ ...message(id, now), service: createSupportState(id, now, undefined, parent) }));
  assert.equal(latestCases(children)[0].id, latestCases([...children].reverse())[0].id);
});

test('A legacy rejected clarification cannot hide its still-pending help case', () => {
  for (const route of ['trash', 'violation'] as const) {
    const parent = message('root', now - 2000);
    const rejected: Message = { ...message('rejected', now), status: route,
      processing: { classification: route, route, steps: [] }, service: createSupportState('rejected', now, undefined, parent) };
    const visible = latestCases([parent, rejected]);
    assert.ok(visible.some(row => row.id === parent.id), route);
    assert.ok(visible.some(row => row.id === rejected.id), route);
  }
});

test('Old current incidents get a freshness warning but remain urgent and open', () => {
  const row = message('live', now - 6 * 60_000, 'now');
  assert.equal(queueFlags(row, now).stale, true);
  assert.equal(effectiveUrgency(row), 'now');
  assert.equal(effectiveState(row), 'queued');
});

test('Aging uses the first report time and does not reset on clarification', () => {
  const parent = message('root', now - 20 * 60_000), child = { ...message('child', now), service: createSupportState('child', now, undefined, parent) };
  // A new ID/location answer does not prove that the attack is still happening.
  // Until explicit confirmation timestamps exist, warn conservatively from the
  // original report time, even if a later clarification says it is continuing.
  assert.deepEqual(queueFlags(child, now), { stale: true, overdue: true, minutes: 20 });
});

test('Answered and resolved cases are not shown as waiting overdue', () => {
  const row = message('old', now - 60 * 60_000);
  row.service = updateSupportState(row, 'reply', { text: 'Готово' }, now, true);
  assert.equal(queueFlags(row, now).overdue, false);
  row.service = updateSupportState(row, 'helped', {}, now + 1, false);
  assert.equal(queueFlags(row, now + 1).overdue, false);
});

test('Aging prevents starvation but never overtakes a live intervention', () => {
  const live = message('live', now - 1000, 'now'), old = message('old', now - 30 * 60_000), high = message('high', now - 20_000, 'high'), recent = message('recent', now - 3000);
  const input = [recent, high, old, live], before = [...input];
  assert.deepEqual(sortHelpQueue(input, now).map(row => row.id), ['live', 'old', 'high', 'recent']);
  assert.deepEqual(input, before);
});

test('Manual priority takes precedence over the algorithm and waiting time cannot be negative', () => {
  const row = message('future', now + 60_000, 'now');
  row.service = updateSupportState(row, 'priority', { level: 'normal', reason: 'Событие завершено' }, now, true);
  assert.equal(effectiveUrgency(row), 'normal');
  assert.equal(queueFlags(row, now).minutes, 0);
});

test('Legacy accepted records remain resolved without a service payload', () => {
  assert.equal(effectiveState({ ...message(), status: 'accepted', service: undefined }), 'resolved');
});
