import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseContestReview } from './review-policy.ts';
import { triage } from './engine.ts';
import type { Ticket } from './types.ts';

const ticket = (text: string): Ticket => ({ kind: 'report', messages: [{ role: 'player', text }] });
test('uncertain skips only a complete trusted FAQ; all reviews that same FAQ', () => {
  const t = ticket('Что такое ДМ?'), baseline = triage(t);
  assert.equal(baseline.needs_human, false);
  assert.equal(chooseContestReview(t, baseline, 'uncertain').code, 'trusted_local_faq');
  assert.equal(chooseContestReview(t, baseline, 'uncertain').review, false);
  assert.equal(chooseContestReview(t, baseline, 'all').review, true);
});

test('needs_human false and high heuristic confidence never suppress complex inputs', () => {
  const faq = triage(ticket('Что такое ДМ?'));
  for (const text of ['Что такое ДМ и как мне вернуть машину?', 'Не надо объяснять ДМ; у меня пропала машина.', '«Что такое ДМ?» — так он сказал перед угрозой.']) {
    assert.equal(chooseContestReview(ticket(text), { ...faq, needs_human: false, confidence: .99 }, 'uncertain').review, true, text);
  }
  const long = ticket('Что такое ДМ? ' + 'Я описываю дополнительные обстоятельства. '.repeat(4));
  assert.equal(chooseContestReview(long, faq, 'uncertain').review, true);
});

test('anchored greetings never swallow a problem, attachment or another message', () => {
  const hello = ticket('Привет!!!'), baseline = triage(hello);
  assert.equal(chooseContestReview(hello, baseline, 'uncertain').code, 'trivial_greeting');
  assert.equal(chooseContestReview(hello, baseline, 'all').review, true);
  for (const t of [ticket('Привет, мой профиль исчез'), { ...hello, images_count: 1 }, { ...hello, messages: [...hello.messages, { role: 'player' as const, text: 'Помогите найти аккаунт' }] }]) {
    assert.equal(chooseContestReview(t, baseline, 'uncertain').review, true);
  }
});

test('critical, moderated, foreign, unresolved and ordinary substantive text is reviewed', () => {
  for (const text of ['Оплатил донат, он не пришёл', 'Мой аккаунт взломали', 'Админ ты идиот, исправьте оплату', 'No puedo entrar a mi cuenta', 'Эта штука не работает, проверьте', 'Помогите выбраться из текстур']) {
    const t = ticket(text), baseline = triage(t);
    assert.equal(chooseContestReview(t, baseline, 'uncertain').review, true, text);
  }
});

test('admin and reported-player messages never alter the review gate for a trusted FAQ', () => {
  const faq = ticket('Что такое ДМ?'), baseline = triage(faq);
  const extended: Ticket = { ...faq, messages: [...faq.messages, { role: 'admin', text: 'Взлом, платеж, срочно!' }, { role: 'reported_player', text: 'Платёж не пришёл' }] };
  assert.deepEqual(chooseContestReview(extended, baseline, 'uncertain'), chooseContestReview(faq, baseline, 'uncertain'));
});
