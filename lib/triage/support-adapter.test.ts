import test from 'node:test';
import assert from 'node:assert/strict';
import { processSupportMessage } from '../support-processing.ts';
import { canClarify } from '../message-context.ts';
import { createSupportState } from '../support-state.ts';
import { assessHelpUrgency } from '../help-urgency.ts';
import { applyContestToSupport } from './support-adapter.ts';
import { triage } from './engine.ts';
import type { Category, TriageResult } from './types.ts';

const review = { outcome: 'replaced' as const, promptVersion: 'adapter-test' };
const original = 'ДМ';
function result(category: Category, mode: 'local' | 'rules+ai' = 'rules+ai'): TriageResult {
  const baseline = triage({ kind: 'report', messages: [{ role: 'player', text: original }] });
  return { ...baseline, category, needs_human: true, meta: { ...baseline.meta, mode } };
}

test('AI rerouting clears the old automatic question but retains the algorithm evidence', () => {
  const local = processSupportMessage(original);
  assert.equal(local.processing.needsClarification, true);
  assert.ok(local.processing.followUp);
  for (const category of ['report.question', 'report.help', 'report.offtopic'] as const) {
    const updated = applyContestToSupport(original, local, result(category), review);
    assert.equal(updated.processing.needsClarification, false);
    assert.equal(updated.processing.followUp, undefined);
    assert.deepEqual(updated.processing.missingDetails, []);
    assert.equal(updated.processing.steps.some(step => step.id === 'details'), false);
    assert.equal(updated.processing.algorithm?.needsClarification, true);
    assert.equal(updated.processing.algorithm?.followUp, local.processing.followUp);
    assert.equal(updated.processing.knowledge?.answer, undefined);
    const service = createSupportState('message', 1, updated.processing.knowledge?.status === 'answered' ? updated.processing.knowledge : undefined);
    const saved = { ...updated, id: 'message', originalText: original, createdAt: 1, service };
    assert.equal(canClarify(saved), false);
    assert.equal(service.reply, undefined);
    assert.equal(service.state, 'queued');
    assert.equal(updated.status, category === 'report.offtopic' ? 'trash' : 'pending');
  }
});

test('a local fallback retains the existing clarification workflow', () => {
  const local = processSupportMessage(original);
  const updated = applyContestToSupport(original, local, result('report.help', 'local'), { outcome: 'unavailable', promptVersion: 'adapter-test' });
  assert.equal(updated.processing.followUp, local.processing.followUp);
  assert.equal(updated.processing.needsClarification, local.processing.needsClarification);
  assert.deepEqual(updated.processing.missingDetails, local.processing.missingDetails);
  assert.equal(canClarify({ ...updated, id: 'message', originalText: original, createdAt: 1 }), true);
});

test('validated AI rescues accounts, payments and real help from local trash and violation', () => {
  const text = 'Нужна проверка проблемы, меня не поняли';
  const originalLocal = processSupportMessage(text);
  for (const route of ['trash', 'violation'] as const) for (const category of ['report.account', 'report.payment', 'report.help', 'report.question'] as const) {
    const local = { ...originalLocal, status: route, processing: { ...originalLocal.processing, route, classification: route } };
    const updated = applyContestToSupport(text, local, result(category), review);
    assert.equal(updated.status, 'pending');
    assert.equal(updated.processing.route, category === 'report.question' ? 'question' : 'help');
    assert.equal(updated.processing.algorithm?.route, route);
    assert.equal(updated.processing.triage?.meta.moderation_flag, route === 'violation');
    assert.equal(updated.processing.knowledge?.answer, undefined);
    assert.equal(updated.processing.decisionSource, 'ai');
  }
});

test('failed review queues substantive terminal text without claiming an AI decision', () => {
  const text = 'Верните доступ, мой профиль больше не открывается';
  const originalLocal = processSupportMessage(text);
  for (const route of ['trash', 'violation'] as const) for (const outcome of ['unavailable', 'limited'] as const) {
    const local = { ...originalLocal, status: route, processing: { ...originalLocal.processing, route, classification: route } };
    const localTriage = result('report.offtopic', 'local');
    const updated = applyContestToSupport(text, local, localTriage, { outcome, promptVersion: 'test', errorCode: 'timeout' });
    assert.equal(updated.status, 'pending');
    assert.equal(updated.processing.route, null);
    assert.equal(updated.processing.decisionSource, 'rules');
    assert.equal(updated.processing.triage?.category, 'report.offtopic');
    assert.equal(updated.processing.triage?.meta.mode, 'local');
    assert.equal(updated.processing.aiReview?.outcome, outcome);
    assert.equal(updated.processing.algorithm?.route, route);
    assert.equal(updated.processing.triage?.needs_human, true);
    assert.equal(updated.processing.knowledge?.answer, undefined);
    assert.equal(updated.processing.followUp, undefined);
    assert.equal(createSupportState('manual', 1).state, 'queued');
  }
});

test('disabled AI and a trivial greeting retain local terminal handling', () => {
  for (const [text, outcome] of [['Привет', 'unavailable'], ['Проверьте мой аккаунт', 'disabled']] as const) {
    const local = processSupportMessage(text);
    const marked = { ...local, status: 'trash' as const, processing: { ...local.processing, route: 'trash' as const, classification: 'trash' as const } };
    const updated = applyContestToSupport(text, marked, result('report.offtopic', 'local'), { outcome, promptVersion: 'test' });
    assert.equal(updated.status, 'trash');
    assert.equal(updated.processing.route, 'trash');
  }
});

test('accepted English account P0 elevates help queue for fresh and cached reviews without inventing live observations', () => {
  const text = 'My account has been hacked and I cannot log in.';
  const local = processSupportMessage(text);
  const localUrgency = local.processing.urgency ?? assessHelpUrgency(text, local.text);
  assert.equal(localUrgency.level, 'normal');
  const accepted = { ...result('report.account'), priority: 'p0' as const };
  for (const cached of [false, true]) {
    const updated = applyContestToSupport(text, local, accepted, { ...review, cached });
    assert.equal(updated.processing.route, 'help');
    assert.equal(updated.status, 'pending');
    assert.equal(updated.processing.urgency?.level, 'now');
    assert.match(updated.processing.urgency?.reason ?? '', /P0/u);
    assert.equal(updated.processing.urgency?.eventTime, localUrgency.eventTime);
    assert.equal(updated.processing.urgency?.needsLiveObservation, localUrgency.needsLiveObservation);
    assert.equal(updated.processing.steps.find(step => step.id === 'urgency')?.value, 'Сейчас');
    assert.equal(updated.processing.knowledge?.answer, undefined);
  }
});

test('accepted P1 establishes a high queue floor without lowering an already ongoing emergency', () => {
  const text = 'Please investigate this incident.';
  const local = processSupportMessage(text);
  const accepted = { ...result('report.complaint'), priority: 'p1' as const };
  assert.equal(applyContestToSupport(text, local, accepted, review).processing.urgency?.level, 'high');
  const ongoing = processSupportMessage('Меня сейчас убивают возле банка, помогите');
  assert.equal(ongoing.processing.urgency?.level, 'now');
  const updated = applyContestToSupport('Меня сейчас убивают возле банка, помогите', ongoing, accepted, review);
  assert.equal(updated.processing.urgency?.level, 'now');
  assert.equal(updated.processing.urgency?.needsLiveObservation, true);
  const fallback = applyContestToSupport(text, local, { ...accepted, meta: { ...accepted.meta, mode: 'local' } }, { outcome: 'unavailable', promptVersion: 'test' });
  assert.equal(fallback.processing.urgency?.level, local.processing.urgency?.level);
});
