import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvaluationInput, validateSpendLedger, normalizedHash, evaluationMetrics, evaluationBreakdown } from './adversarial-evaluation.mjs';

const fixture = { id: 'case-1', ticket: { kind: 'report', messages: [{ role: 'player', text: 'Не могу войти в аккаунт' }] }, expected: { category: 'report.account', priority: 'p0', lang: 'ru', needs_human: true }, challenge_tags: ['access'] };
const bundle = (rows = [fixture]) => { const raw = rows.map(JSON.stringify).join('\n') + '\n'; return { raw, manifest: { datasetSha256Lf: normalizedHash(raw), total: rows.length, ids: rows.map(row => row.id) } }; };

test('frozen dataset validates exact normalized hash, count and ordered unique IDs', () => {
  const { raw, manifest } = bundle();
  assert.equal(validateEvaluationInput(raw.replace(/\n/gu, '\r\n'), manifest).length, 1);
  assert.throws(() => validateEvaluationInput(raw + '\n', manifest));
  assert.throws(() => validateEvaluationInput(raw, { ...manifest, total: 100 }));
  assert.throws(() => validateEvaluationInput(raw, { ...manifest, ids: ['wrong'] }));
  const duplicated = bundle([fixture, fixture]);
  assert.throws(() => validateEvaluationInput(duplicated.raw, duplicated.manifest));
});

test('all ticket shapes and labels are checked before inference; retrospective fields are removed', () => {
  for (const patch of [{ expected: { ...fixture.expected, priority: 'p9' } }, { challenge_tags: [] }, { ticket: { ...fixture.ticket, messages: [] } }]) {
    const data = bundle([{ ...fixture, ...patch }]);
    assert.throws(() => validateEvaluationInput(data.raw, data.manifest));
  }
  const data = bundle([{ ...fixture, ticket: { ...fixture.ticket, verdict: 'SECRET LABEL', expected_category: 'report.account' } }]);
  const [clean] = validateEvaluationInput(data.raw, data.manifest);
  assert.equal(clean.ticket.verdict, undefined); assert.equal(clean.ticket.expected_category, undefined);
});

test('spend ledger must retain measured and unknown-call accounting', () => {
  const ledger = { reservedUsd: .02, measuredUsd: .01, calls: 4, unknownCostCalls: 2 };
  assert.equal(validateSpendLedger(ledger), ledger);
  for (const patch of [{ reservedUsd: .001 }, { measuredUsd: -1 }, { calls: 1 }, { unknownCostCalls: 1.5 }]) assert.throws(() => validateSpendLedger({ ...ledger, ...patch }));
});

test('failed AI predictions count wrong and as critical misses, never as correct fallbacks', () => {
  const rows = [
    { ...fixture, state: 'complete', prediction: null, elapsedMs: 4000, costUsd: null, providerCalls: 1 },
    { ...fixture, id: 'case-2', state: 'complete', prediction: fixture.expected, elapsedMs: 1000, costUsd: .0002, providerCalls: 1 },
    { ...fixture, id: 'not-complete', state: 'reserved', prediction: null },
  ];
  const result = evaluationMetrics(rows);
  assert.equal(result.total, 2); assert.equal(result.categoryAccuracy, .5); assert.equal(result.criticalRecall, .5);
  assert.equal(result.priorityMatrix.p0.fn, 1); assert.equal(result.humanSafety.abstentions, 1);
  assert.equal(result.latencyMs.p95, 4000); assert.equal(result.costs.unknownCalls, 1);
  assert.equal(evaluationBreakdown(rows).byChallengeTag.access.total, 2);
});

test('hybrid fallback accuracy is independent from model failure and gate counts', () => {
  const rows = [
    { ...fixture, state: 'complete', prediction: fixture.expected, gate: { review: true }, modelResult: { ok: false, code: 'timeout' }, elapsedMs: 4000, costUsd: null, providerCalls: 1 },
    { ...fixture, id: 'local-skip', state: 'complete', prediction: fixture.expected, gate: { review: false }, modelResult: null, elapsedMs: 10, costUsd: 0, providerCalls: 0 },
  ];
  const result = evaluationMetrics(rows);
  assert.equal(result.categoryAccuracy, 1);
  assert.deepEqual(result.modelOutcomes, { attempted: 1, valid: 0, failed: 1, skippedByPolicy: 1, errors: { timeout: 1 } });
  assert.equal(result.costs.providerCalls, 1); assert.equal(result.costs.unknownCalls, 1);
});
