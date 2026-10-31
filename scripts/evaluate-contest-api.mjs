import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { triage } from '../lib/triage/engine.ts';
import { ruleCorpus } from '../lib/triage/runtime.ts';
import { modelSources, requestContestModel, applyContestModel, CONTEST_PROMPT_VERSION } from '../lib/triage/model.ts';

const args = process.argv.slice(2);
const option = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; };
const source = option('--in'), output = option('--out'), ledgerPath = option('--ledger');
const budget = Number(option('--budget-usd'));
if (!source || !output || !ledgerPath || !Number.isFinite(budget) || budget <= 0 || budget > 2) throw new Error('Use --in fixtures.jsonl --out report.local.json --ledger spend.local.json --budget-usd LIMIT (0 < LIMIT <= 2).');
let key = process.env.OPENAI_API_KEY;
if (!key && option('--key-file')) key = fs.readFileSync(option('--key-file'), 'utf8').match(/^OPENAI_API_KEY\s*=\s*(.*)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
if (!key?.startsWith('sk-')) throw new Error('API key is unavailable.');
const raw = fs.readFileSync(source, 'utf8'), rows = raw.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : { reservedUsd: 0, measuredUsd: 0, calls: 0, unknownCostCalls: 0 };
if (!Number.isFinite(ledger.reservedUsd) || ledger.reservedUsd < 0) throw new Error('Invalid spend ledger.');
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.mkdirSync(path.dirname(path.resolve(ledgerPath)), { recursive: true });
const atomic = (file, value) => { fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n'); fs.renameSync(file + '.tmp', file); };
const results = [];
for (const [index, row] of rows.entries()) {
  if (!row.ticket || !row.expected) throw new Error(`Invalid fixture ${index + 1}`);
  if (ledger.reservedUsd + 0.002 > budget) throw new Error('Budget exhausted; no further API requests made.');
  // Persist a conservative reservation BEFORE the request; crashes/timeouts cannot
  // lead to unaccounted retries. Never automatically retry paid requests.
  ledger.reservedUsd += 0.002; ledger.calls++; atomic(ledgerPath, ledger);
  const started = performance.now();
  const baseline = triage(row.ticket, { corpus: ruleCorpus });
  const sources = modelSources(row.ticket, baseline, ruleCorpus);
  const model = await requestContestModel(row.ticket, baseline, sources, key);
  const final = applyContestModel(baseline, model, sources);
  const elapsedMs = performance.now() - started;
  if (model.costUsd === null) ledger.unknownCostCalls++;
  else { ledger.reservedUsd += model.costUsd - 0.002; ledger.measuredUsd += model.costUsd; }
  atomic(ledgerPath, ledger);
  results.push({ id: row.id ?? row.scenario_id ?? index + 1, expected: row.expected,
    local: { category: baseline.category, priority: baseline.priority, lang: baseline.lang },
    modelOk: model.ok, modelError: model.ok ? null : model.code, elapsedMs,
    categoryCorrect: final.category === row.expected.category, priorityCorrect: final.priority === row.expected.priority,
    languageCorrect: row.expected.lang ? final.lang === row.expected.lang : null, result: final });
  console.log(JSON.stringify({ completed: index + 1, total: rows.length, modelOk: model.ok, elapsedMs: Math.round(elapsedMs), costUsd: model.costUsd }));
}
const sorted = results.map(x => x.elapsedMs).sort((a,b) => a-b);
const supported = ['p0','p1','p2','p3'].map(p => ({ p, tp: results.filter(x => x.expected.priority === p && x.result.priority === p).length, fp: results.filter(x => x.expected.priority !== p && x.result.priority === p).length, fn: results.filter(x => x.expected.priority === p && x.result.priority !== p).length }));
const report = { generatedAt: new Date().toISOString(), datasetSha256: createHash('sha256').update(raw).digest('hex'), promptVersion: CONTEST_PROMPT_VERSION,
  datasetSha256Lf: createHash('sha256').update(raw.replace(/\r\n/gu, '\n')).digest('hex'),
  implementationSha256: Object.fromEntries(['model.ts', 'engine.ts', 'retrieval.ts'].map(file => [file, createHash('sha256').update(fs.readFileSync(new URL('../lib/triage/' + file, import.meta.url))).digest('hex')])),
  corpusVersion: ruleCorpus.version,
  model: 'gpt-6-luna', total: results.length, successfulModelCalls: results.filter(x => x.modelOk).length,
  categoryAccuracy: results.filter(x => x.categoryCorrect).length / results.length,
  priorityAccuracy: results.filter(x => x.priorityCorrect).length / results.length,
  priorityMacroF1: supported.reduce((s,x) => s + (2*x.tp+x.fp+x.fn ? 2*x.tp/(2*x.tp+x.fp+x.fn) : 0),0)/4,
  languageAccuracy: results.filter(x => x.languageCorrect).length / results.filter(x => x.languageCorrect !== null).length,
  humanReviewRate: results.filter(x => x.result.needs_human).length/results.length,
  p95Ms: sorted[Math.ceil(sorted.length*.95)-1], ledger,
  limitations: ['Authored synthetic examples, not hidden contest test.', 'Fallbacks included; model failures reported separately.', 'Citation ID existence is enforced; semantic relevance and draft quality require blind administrator/native-speaker review.', 'No paid fine-tuning was performed by this script.'], results };
atomic(output, report);
console.log(JSON.stringify({ ...report, results: undefined }));
