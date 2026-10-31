import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { triage } from '../lib/triage/engine.ts';
import { ruleCorpus } from '../lib/triage/runtime.ts';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const source = option('--in'), out = option('--out');
if (!source || !out) throw new Error('Usage: node scripts/evaluate-triage.mjs --in labelled.jsonl --out report.local.json');
const raw = await readFile(source, 'utf8');
const rows = raw.trim().split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
let categoryCorrect = 0, categoryTotal = 0, priorityTotal = 0, citationFailures = 0, human = 0;
const matrix = Object.fromEntries(['p0', 'p1', 'p2', 'p3'].map(p => [p, { tp: 0, fp: 0, fn: 0, support: 0 }]));
const latency = [], byLanguage = {}, errors = [];
for (const [index, row] of rows.entries()) {
  if (!row.ticket || !row.expected) throw new Error(`Record ${index + 1}: expected {ticket,expected}.`);
  const result = triage(row.ticket, { corpus: ruleCorpus });
  latency.push(result.meta.elapsed_ms); human += Number(result.needs_human);
  // No free-text admin replies or verdicts are used as category labels.
  if (row.expected.category) {
    categoryTotal++; const correct = result.category === row.expected.category; categoryCorrect += Number(correct);
    const lang = byLanguage[result.lang] ??= { total: 0, correct: 0 }; lang.total++; lang.correct += Number(correct);
    if (!correct) errors.push({ index: index + 1, field: 'category', expected: row.expected.category, actual: result.category });
  }
  if (row.expected.priority) {
    if (!(row.expected.priority in matrix)) throw new Error(`Record ${index + 1}: unknown priority.`);
    priorityTotal++; matrix[row.expected.priority].support++;
    if (result.priority === row.expected.priority) matrix[result.priority].tp++;
    else { matrix[row.expected.priority].fn++; matrix[result.priority].fp++; errors.push({ index: index + 1, field: 'priority', expected: row.expected.priority, actual: result.priority }); }
  }
  for (const ref of result.draft_reply.cited) if (!result.meta.citations.some(rule => rule.ref === ref && ruleCorpus.chunks.some(original => original.id === rule.id && original.text === rule.text))) citationFailures++;
}
latency.sort((a, b) => a - b);
const f1 = s => 2 * s.tp + s.fp + s.fn ? 2 * s.tp / (2 * s.tp + s.fp + s.fn) : 0;
const report = {
  generatedAt: new Date().toISOString(), datasetSha256: createHash('sha256').update(raw).digest('hex'), corpusVersion: ruleCorpus.version,
  mode: 'local', total: rows.length, category: { labelled: categoryTotal, correct: categoryCorrect, accuracy: categoryTotal ? categoryCorrect / categoryTotal : null },
  priority: { labelled: priorityTotal, macroF1: priorityTotal ? Object.values(matrix).reduce((sum, s) => sum + f1(s), 0) / 4 : null, matrix },
  byLanguage, humanReviewRate: rows.length ? human / rows.length : null, citationExistenceFailures: citationFailures,
  processorP95Ms: latency[Math.max(0, Math.ceil(latency.length * .95) - 1)] ?? null, apiCalls: 0, apiCostUsd: 0,
  limitations: ['Local mode only; no provider calls.', 'Timing excludes HTTP and infrastructure.', 'Citation existence does not prove relevance.', 'Draft fluency, factual applicability and usefulness require blind human/native-speaker review.', 'Authored regression fixtures are not an independent accuracy benchmark.'], errors,
};
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
