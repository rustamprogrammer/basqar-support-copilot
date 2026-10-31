import test from 'node:test';
import assert from 'node:assert/strict';
import { processSupportMessage } from './support-processing.ts';
import { normalizeInputScripts } from './input-script-normalization.ts';

test('The production assistance pipeline never calls a network reviewer', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No external service is permitted'); };
  try {
    for (const text of ['Что такое ДМ?', 'Меня сейчас убивают, помогите', 'Где поменять одежду?', 'админ ты идиот', '123']) {
      const result = processSupportMessage(text);
      assert.equal(result.processing.aiReview?.outcome, 'disabled');
      assert.equal(result.processing.decisionSource, 'rules');
    }
  } finally { globalThis.fetch = originalFetch; }
});
test('An ongoing attack gets urgency and an actionable clarification in the trace', () => {
  const { processing: trace } = processSupportMessage('Меня сейчас бьют, помогите');
  assert.equal(trace.route, 'help');
  assert.equal(trace.urgency?.level, 'now');
  assert.equal(trace.knowledge?.status, 'not_applicable');
  assert.ok(trace.steps.some(step => step.id === 'urgency'));
  if (trace.followUp) assert.ok(trace.steps.some(step => step.id === 'details' && step.value === trace.followUp));
});
test('A known definition produces an actual versioned answer; a missing procedure goes to an admin', () => {
  const known = processSupportMessage('Что такое ДМ?').processing;
  assert.equal(known.route, 'question');
  assert.equal(known.knowledge?.status, 'answered');
  assert.equal(known.answerReadiness, 'ready');
  assert.ok(known.steps.some(step => step.id === 'answer' && step.value === known.knowledge?.answer));
  const missing = processSupportMessage('Какая команда показывает мою машину на карте?').processing;
  assert.notEqual(missing.knowledge?.status, 'answered');
});
test('Reported problems and conflicting requests never get a glossary answer', () => {
  for (const text of ['Что такое ДМ, меня сейчас бьют!', 'Что такое ДМ и ДБ?', 'Вчера меня ДМили, хочу подать жалобу']) {
    assert.notEqual(processSupportMessage(text).processing.knowledge?.status, 'answered', text);
  }
});
test('An unrelated bad clarification is terminal moderation, without automatic answers', () => {
  const { processing } = processSupportMessage('Помогите\nУточнение: админ ты идиот', { parentId: 'previous', parentRoute: 'help', answerText: 'админ ты идиот' });
  assert.equal(processing.route, 'violation');
  assert.equal(processing.urgency, undefined);
  assert.equal(processing.knowledge?.status, 'not_applicable');
});
test('The extended vocabulary keeps a negation while recognizing multilingual purposes', () => {
  const examples = [
    ['Чтотакое РП?', 'question'],
    ['Що ознчає ДМ?', 'question'],
    ['DM деген не?', 'question'],
    ['Мене зараз ДМлять біля будинку, прийдіть', 'help'],
    ['Вчера меня били, хочу оформить жалобу', 'help'],
    ['Я не использую софт', null],
    ['оннедмит', null],
  ] as const;
  for (const [text, expected] of examples) assert.equal(processSupportMessage(text).processing.route, expected, text);
  for (const text of ['Alex_защитить', 'https://example.com/объясните', '/настройки']) assert.equal(normalizeInputScripts(text).text, text);
});
