import { createHash } from 'node:crypto';
import { CATEGORIES, parseTicket } from '../lib/triage/types.ts';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const normalizedHash = text => sha256(text.replace(/\r\n/gu, '\n'));
const priorities = ['p0', 'p1', 'p2', 'p3'];
const languages = ['ru', 'kk', 'uz', 'en', 'es', 'pt', 'und'];

export function validateEvaluationInput(raw, manifest) {
  const rows = raw.trim().split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON at dataset row ${index + 1}.`); }
  });
  if (!rows.length || rows.length > 100) throw new Error('Dataset must contain 1–100 rows.');
  if (!manifest || manifest.datasetSha256Lf !== normalizedHash(raw) || manifest.total !== rows.length || !Array.isArray(manifest.ids)) throw new Error('Manifest hash/count/IDs do not match the frozen dataset.');
  const ids = new Set();
  return rows.map((row, index) => {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || row.id.length > 160 || ids.has(row.id) || manifest.ids[index] !== row.id) throw new Error(`Invalid, duplicate or reordered ID at row ${index + 1}.`);
    ids.add(row.id);
    const expected = row.expected;
    if (!expected || !CATEGORIES.includes(expected.category) || !priorities.includes(expected.priority) || !languages.includes(expected.lang) || typeof expected.needs_human !== 'boolean') throw new Error(`Invalid expected labels at row ${index + 1}.`);
    const ticket = parseTicket(row.ticket);
    if (!expected.category.startsWith(ticket.kind + '.')) throw new Error(`Category/channel mismatch at row ${index + 1}.`);
    if (!Array.isArray(row.challenge_tags) || !row.challenge_tags.length || row.challenge_tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 100)) throw new Error(`Invalid challenge_tags at row ${index + 1}.`);
    if (manifest.ids.length !== rows.length) throw new Error('Manifest contains extra IDs.');
    // parseTicket strips retrospective labels and unknown fields before inference.
    return { id: row.id, scenario_id: row.scenario_id ?? row.id, ticket, expected: { category: expected.category, priority: expected.priority, lang: expected.lang, needs_human: expected.needs_human }, challenge_tags: [...new Set(row.challenge_tags)], label_reason: row.label_reason ?? null };
  });
}

export function validateSpendLedger(ledger) {
  if (!ledger || !Number.isFinite(ledger.reservedUsd) || ledger.reservedUsd < 0 || !Number.isFinite(ledger.measuredUsd) || ledger.measuredUsd < 0 || ledger.reservedUsd + 1e-9 < ledger.measuredUsd
    || !Number.isSafeInteger(ledger.calls) || ledger.calls < 0 || !Number.isSafeInteger(ledger.unknownCostCalls) || ledger.unknownCostCalls < 0 || ledger.unknownCostCalls > ledger.calls) throw new Error('Invalid existing spend ledger.');
  return ledger;
}

const fraction = (numerator, denominator) => denominator ? numerator / denominator : null;
export function evaluationMetrics(rows) {
  const completed = rows.filter(row => row.state === 'complete');
  const correct = field => completed.filter(row => row.prediction?.[field] === row.expected[field]).length;
  const matrix = Object.fromEntries(priorities.map(priority => [priority, {
    tp: completed.filter(row => row.expected.priority === priority && row.prediction?.priority === priority).length,
    fp: completed.filter(row => row.expected.priority !== priority && row.prediction?.priority === priority).length,
    fn: completed.filter(row => row.expected.priority === priority && row.prediction?.priority !== priority).length,
  }]));
  const critical = completed.filter(row => row.expected.priority === 'p0');
  const human = completed.filter(row => row.expected.needs_human);
  const latency = completed.map(row => row.elapsedMs).sort((a, b) => a - b);
  return { total: completed.length, successfulPredictions: completed.filter(row => row.prediction !== null).length,
    modelOutcomes: { attempted: completed.filter(row => row.modelResult != null).length, valid: completed.filter(row => row.modelResult?.ok === true).length,
      failed: completed.filter(row => row.modelResult?.ok === false).length, skippedByPolicy: completed.filter(row => row.gate?.review === false).length,
      errors: Object.fromEntries([...new Set(completed.filter(row => row.modelResult?.ok === false).map(row => row.modelResult.code))].sort().map(code => [code, completed.filter(row => row.modelResult?.ok === false && row.modelResult.code === code).length])) },
    categoryAccuracy: fraction(correct('category'), completed.length), priorityAccuracy: fraction(correct('priority'), completed.length), languageAccuracy: fraction(correct('lang'), completed.length),
    priorityMacroF1: completed.length ? Object.values(matrix).reduce((sum, m) => sum + (2 * m.tp + m.fp + m.fn ? 2 * m.tp / (2 * m.tp + m.fp + m.fn) : 0), 0) / 4 : null,
    priorityMatrix: matrix, criticalRecall: fraction(critical.filter(row => row.prediction?.priority === 'p0').length, critical.length), criticalTotal: critical.length,
    humanSafety: { required: human.length, explicitHumanRecall: fraction(human.filter(row => row.prediction?.needs_human === true).length, human.length), unsafeAutomaticDecisions: human.filter(row => row.prediction?.needs_human === false).length, abstentions: human.filter(row => row.prediction === null).length },
    latencyMs: { p50: latency.length ? latency[Math.ceil(latency.length * .5) - 1] : null, p95: latency.length ? latency[Math.ceil(latency.length * .95) - 1] : null, max: latency.at(-1) ?? null },
    costs: { knownUsd: completed.reduce((sum, row) => sum + (row.costUsd ?? 0), 0), unknownCalls: completed.filter(row => row.costUsd === null).length, providerCalls: completed.reduce((sum, row) => sum + row.providerCalls, 0) },
  };
}

export function evaluationBreakdown(rows) {
  const completed = rows.filter(row => row.state === 'complete');
  const groups = (values, predicate) => Object.fromEntries([...new Set(values)].sort().map(value => [value, evaluationMetrics(completed.filter(row => predicate(row, value)))]));
  return { ...evaluationMetrics(completed), byLanguage: groups(completed.map(row => row.expected.lang), (row, value) => row.expected.lang === value),
    byChallengeTag: groups(completed.flatMap(row => row.challenge_tags), (row, value) => row.challenge_tags.includes(value)) };
}
