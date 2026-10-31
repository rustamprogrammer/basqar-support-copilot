import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdversarialReport } from './adversarial-report.mjs';

const expected = { lang: 'ru', category: 'report.help', priority: 'p2', needs_human: true };
const row = (id, prediction = expected) => ({ id, scenario_id: id, ticket: { kind: 'report', messages: [{ role: 'player', text: '<script>alert("XSS")</script> & broken UI' }] }, expected, challenge_tags: ['xss<test>'], label_reason: 'Test reason', state: 'complete', prediction, elapsedMs: 100, costUsd: 0, providerCalls: 0 });
const report = rows => ({ datasetSha256Lf: 'same-hash', total: 2, state: 'completed', results: rows });

test('report counts actual rescues and regressions without selecting an oracle hybrid', () => {
  const algorithm = report([row('one', { ...expected, category: 'report.question' }), row('two')]);
  const ai = report([row('one'), row('two', null)]);
  const hybrid = report([row('one', null), row('two', null)]);
  const { summary } = buildAdversarialReport(algorithm, ai, hybrid);
  assert.deepEqual(summary.counts, { algorithmErrors: 1, aiErrors: 1, aiRescues: 1, aiRegressions: 1, bothErrors: 0, hybridErrors: 2 });
  assert.equal(summary.runs.hybrid.metrics.jointAccuracy, 0);
});

test('missing predictions count as failures on the full denominator and unsafe text is escaped', () => {
  const algorithm = report([row('one'), row('two')]);
  algorithm.results[0].localResult = { draft_reply: { text: '</script><img src=x onerror=alert(1)>' }, meta: { citations: [{ text: 'PRIVATE SOURCE MUST NOT APPEAR' }] } };
  const ai = { ...report([row('one')]), state: 'failed', rawHeaders: { secret: 'SECRET HEADER MUST NOT APPEAR' } };
  const { html, summary } = buildAdversarialReport(algorithm, ai);
  assert.equal(summary.runs.ai.metrics.total, 2);
  assert.equal(summary.runs.ai.metrics.categoryAccuracy, .5);
  assert.equal(summary.runs.ai.metrics.failures, 1);
  assert.equal(summary.runs.ai.missing, 1);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('PRIVATE SOURCE MUST NOT APPEAR'), false);
  assert.equal(html.includes('SECRET HEADER MUST NOT APPEAR'), false);
  assert.equal(JSON.stringify(summary).includes('broken UI'), false);
});

test('changed inputs, labels or dataset hashes cannot be compared as the same run', () => {
  const algorithm = report([row('one'), row('two')]);
  assert.throws(() => buildAdversarialReport(algorithm, { ...algorithm, datasetSha256Lf: 'different' }));
  assert.throws(() => buildAdversarialReport(algorithm, report([row('one'), { ...row('two'), expected: { ...expected, priority: 'p0' } }])));
});

test('hybrid displays the actual final triage draft including appended citations', () => {
  const algorithm = report([row('one'), row('two')]);
  const ai = report([row('one'), row('two')]);
  const hybrid = report([row('one'), row('two')]);
  hybrid.results[0].modelResult = { ok: true, decision: { draft: 'RAW MODEL DRAFT MUST NOT REPLACE FINAL' } };
  hybrid.results[0].finalResult = { draft_reply: { text: 'Final reviewed draft.\nSource reference: Rule <2.1>.' } };
  hybrid.results[1].modelResult = { ok: false, code: 'timeout' };
  hybrid.results[1].localResult = { draft_reply: { text: 'LOCAL BASELINE DRAFT MUST NOT REPLACE FINAL' } };
  hybrid.results[1].finalResult = { draft_reply: { text: 'Final fallback draft after support integration.' } };
  const { html } = buildAdversarialReport(algorithm, ai, hybrid);
  assert.ok(html.includes('Final reviewed draft.\nSource reference: Rule &lt;2.1&gt;.'));
  assert.ok(html.includes('Final fallback draft after support integration.'));
  assert.equal(html.includes('RAW MODEL DRAFT MUST NOT REPLACE FINAL'), false);
  assert.equal(html.includes('LOCAL BASELINE DRAFT MUST NOT REPLACE FINAL'), false);
});
