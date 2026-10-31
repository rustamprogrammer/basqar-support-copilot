import test from 'node:test';
import assert from 'node:assert/strict';
import { triage } from './engine.ts';
import { refreshTriageAfterKnowledgeChange } from './knowledge-refresh.ts';
import { applyContestToSupport } from './support-adapter.ts';
import { processSupportMessage } from '../support-processing.ts';
import { createSupportState } from '../support-state.ts';
import { KNOWLEDGE_ENTRIES } from '../knowledge-base.ts';

const original = 'Что такое ДМ?';
const ticket = { kind: 'report', messages: [{ role: 'player', text: original }] };
const failedReview = { outcome: 'unavailable' as const, promptVersion: 'test', errorCode: 'unsafe_or_invalid_draft', reason: 'Проверка ИИ не завершена.' };

test('refreshing a retired FAQ preserves known and unknown API costs plus failure reasons', () => {
  const refreshed = triage(ticket, { entries: [] });
  for (const cost of [0.000217, null, 0]) {
    const failed = { ...triage(ticket), needs_human: true, reasons: ['Платная проверка ИИ отклонена валидатором.'], meta: { ...triage(ticket).meta, api_cost_usd: cost } };
    const result = refreshTriageAfterKnowledgeChange(failed, refreshed, failedReview);
    assert.equal(result.meta.api_cost_usd, cost);
    assert.equal(result.needs_human, true);
    assert.equal(result.draft_reply.text, refreshed.draft_reply.text);
    assert.ok(result.reasons.includes(failed.reasons[0]));
    assert.equal(result.meta.mode, 'local');
  }
});

test('a newly published FAQ cannot erase a failed human-review requirement or create an automatic reply', () => {
  const old = triage(ticket);
  const failed = { ...old, needs_human: true, reasons: ['ИИ недоступен.'], meta: { ...old.meta, api_cost_usd: null } };
  const currentEntries = KNOWLEDGE_ENTRIES.map(entry => ({ ...entry, version: `${entry.version}-new` }));
  const local = processSupportMessage(original, undefined, currentEntries);
  assert.equal(local.processing.knowledge?.status, 'answered');
  const recomputed = triage(ticket, { support: local, entries: currentEntries });
  assert.equal(recomputed.needs_human, false);
  const refreshed = refreshTriageAfterKnowledgeChange(failed, recomputed, failedReview);
  const processed = applyContestToSupport(original, local, refreshed, failedReview);
  const service = createSupportState('new-message', 1, processed.processing.knowledge?.status === 'answered' ? processed.processing.knowledge : undefined);
  assert.equal(refreshed.needs_human, true);
  assert.equal(processed.processing.knowledge?.status, 'needs_admin');
  assert.equal(processed.processing.knowledge?.answer, undefined);
  assert.equal(processed.processing.steps.some(step => step.id === 'answer'), false);
  assert.equal(service.state, 'queued');
  assert.equal(service.reply, undefined);
  assert.equal(processed.processing.triage?.meta.api_cost_usd, null);
});

test('completed model drafts remain independent of a changed automatic FAQ', () => {
  const base = triage(ticket);
  const generated = { ...base, needs_human: true, draft_reply: { ...base.draft_reply, text: 'Ответ администратора ещё нужен.' }, meta: { ...base.meta, mode: 'rules+ai' as const, api_cost_usd: .0001 } };
  assert.equal(refreshTriageAfterKnowledgeChange(generated, triage(ticket, { entries: [] }), { outcome: 'replaced', promptVersion: 'test' }), generated);
});

test('FAQ stays automatic only when the resulting triage permits it', () => {
  const local = processSupportMessage(original), base = triage(ticket);
  for (const outcome of ['unavailable', 'limited', 'disabled'] as const) {
    for (const needsHuman of [false, true]) {
      const processed = applyContestToSupport(original, local, { ...base, needs_human: needsHuman }, { outcome, promptVersion: 'test' });
      const service = createSupportState('faq-message', 1, processed.processing.knowledge?.status === 'answered' ? processed.processing.knowledge : undefined);
      assert.equal(service.state, needsHuman ? 'queued' : 'answered');
      assert.equal(!!service.reply, !needsHuman);
    }
  }
});
