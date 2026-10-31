import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { triage } from '../lib/triage/engine.ts';
import { processSupportMessage } from '../lib/support-processing.ts';
import { ruleCorpus } from '../lib/triage/runtime.ts';
import { modelSources, buildContestRequest, requestContestModel, applyContestModel, CONTEST_PROMPT_VERSION } from '../lib/triage/model.ts';
import { chooseContestReview, CONTEST_REVIEW_POLICY_VERSION } from '../lib/triage/review-policy.ts';
import { applyContestToSupport } from '../lib/triage/support-adapter.ts';
import { validateEvaluationInput, validateSpendLedger, normalizedHash, sha256, evaluationBreakdown } from './adversarial-evaluation.mjs';

const args = process.argv.slice(2);
const allowed = new Set(['--mode', '--in', '--out', '--manifest', '--ledger', '--budget-usd', '--key-file']);
if (args.length % 2 || args.some((arg, i) => i % 2 === 0 && !allowed.has(arg)) || new Set(args.filter((_, i) => i % 2 === 0)).size !== args.length / 2) throw new Error('Use unique --mode algorithm|ai|hybrid --in DATA --out REPORT.local.json --manifest MANIFEST [--ledger ABSOLUTE_LEDGER --budget-usd LIMIT --key-file ENVFILE].');
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
const mode = options['--mode'], sourcePath = options['--in'], outputArg = options['--out'], manifestPath = options['--manifest'];
if (!['algorithm', 'ai', 'hybrid'].includes(mode) || !sourcePath || !outputArg || !manifestPath || !outputArg.endsWith('.local.json')) throw new Error('Required: algorithm|ai|hybrid mode, input, manifest and ignored .local.json output.');
const output = path.resolve(outputArg), raw = fs.readFileSync(sourcePath, 'utf8'), manifestRaw = fs.readFileSync(manifestPath, 'utf8');
const rows = validateEvaluationInput(raw, JSON.parse(manifestRaw));
if (fs.existsSync(output) || fs.existsSync(output + '.tmp')) throw new Error('Report already exists: automatic reruns and overwrite are disabled.');
if ([sourcePath, manifestPath, options['--ledger'], options['--key-file']].filter(Boolean).some(file => path.resolve(file) === output)) throw new Error('Output must be a separate file.');
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceFiles = directory => fs.readdirSync(path.join(projectRoot, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? sourceFiles(`${directory}/${entry.name}`) : entry.isFile() && /\.(?:ts|tsx|mts|mjs|json)$/u.test(entry.name) ? [`${directory}/${entry.name}`] : []);
const codeFiles = ['scripts/evaluate-adversarial.mjs', 'scripts/adversarial-evaluation.mjs', ...sourceFiles('lib')].sort();
const report = { createdAt: new Date().toISOString(), finishedAt: null, state: 'running', mode,
  datasetSha256: sha256(raw), datasetSha256Lf: normalizedHash(raw), manifestSha256: sha256(manifestRaw), promptVersion: CONTEST_PROMPT_VERSION, reviewPolicyVersion: mode === 'hybrid' ? CONTEST_REVIEW_POLICY_VERSION : null,
  implementationSha256: Object.fromEntries(codeFiles.map(file => [file, sha256(fs.readFileSync(path.join(projectRoot, file)))])),
  corpusVersion: ruleCorpus.version, total: rows.length, ledgerStart: null, ledgerEnd: null, results: [], metrics: null,
  limitations: ['Authored adversarial fixtures are not a hidden independent population estimate.', 'AI mode scores raw validated model decisions: no local category, language inference, priority correction or fallback.', 'AI still uses the same rule corpus and classification-independent retrieval policy; this is AI with RAG, not a model without sources.', 'Hybrid uses the production uncertain-mode review gate and final adapter, including explicit local fallback on model failure; failures are also counted separately.', 'Invalid or missing predictions count as wrong; latency includes failures.', 'Citation existence does not establish semantic relevance or native-speaker fluency.'] };
const atomic = (file, value) => { fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(file + '.tmp', file); };
const checkpoint = () => { report.metrics = evaluationBreakdown(report.results); atomic(output, report); };
const originalFetch = globalThis.fetch;
let ledger, key, lockFd, lockPath, createdOutput = false;
const ledgerPath = options['--ledger'], budget = Number(options['--budget-usd']);
try {
  if (mode !== 'algorithm') {
    if (!ledgerPath || !path.isAbsolute(ledgerPath) || !fs.existsSync(ledgerPath) || !Number.isFinite(budget) || budget <= 0 || budget > 2) throw new Error('AI mode requires the existing absolute ledger and 0 < --budget-usd <= 2.');
    lockPath = ledgerPath + '.lock';
    lockFd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), report: output }));
    ledger = validateSpendLedger(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')));
    if (ledger.reservedUsd + rows.length * .002 > budget + 1e-12) throw new Error('Remaining budget cannot conservatively cover the whole dataset.');
    key = process.env.OPENAI_API_KEY;
    if (!key && options['--key-file']) key = fs.readFileSync(options['--key-file'], 'utf8').match(/^OPENAI_API_KEY\s*=\s*(.*)$/mu)?.[1].trim().replace(/^['"]|['"]$/gu, '');
    if (!key || !/^sk-[A-Za-z0-9_-]{17,4000}$/u.test(key)) throw new Error('API key is unavailable.');
    report.ledgerStart = structuredClone(ledger);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); createdOutput = true;
  for (const row of rows) {
    let calls = 0;
    const resultRow = { ...row, state: 'pending', prediction: null, elapsedMs: null, costUsd: mode === 'algorithm' ? 0 : null, providerCalls: 0, requestSha256: null, sources: [], modelResult: null, localResult: null, supportResult: null, gate: null, finalResult: null, finalSupportResult: null };
    report.results.push(resultRow);
    let localElapsedMs = 0;
    if (mode === 'hybrid') {
      const started = performance.now();
      resultRow.localResult = triage(row.ticket, { corpus: ruleCorpus });
      resultRow.gate = chooseContestReview(row.ticket, resultRow.localResult, 'uncertain');
      localElapsedMs = performance.now() - started;
    }
    if (mode === 'algorithm' || (mode === 'hybrid' && !resultRow.gate.review)) {
      globalThis.fetch = async () => { calls++; throw new Error('Network is disabled during algorithm evaluation.'); };
      checkpoint();
      const started = performance.now();
      const local = resultRow.localResult ?? triage(row.ticket, { corpus: ruleCorpus });
      if (calls) throw new Error('Algorithm evaluation attempted network access.');
      resultRow.elapsedMs = localElapsedMs + performance.now() - started; resultRow.localResult = local; resultRow.costUsd = 0;
      resultRow.supportResult = processSupportMessage(row.ticket.messages.filter(message => message.role === 'player').map(message => message.text).join('\n'));
      if (calls) throw new Error('Support diagnostic attempted network access.');
      resultRow.prediction = { category: local.category, priority: local.priority, lang: local.lang, needs_human: local.needs_human };
      resultRow.requestSha256 = sha256(JSON.stringify(row.ticket));
      if (mode === 'hybrid') {
        resultRow.finalResult = local;
        resultRow.finalSupportResult = applyContestToSupport(row.ticket.messages.filter(message => message.role === 'player').map(message => message.text).join('\n'), resultRow.supportResult, local,
          { outcome: 'disabled', promptVersion: CONTEST_PROMPT_VERSION, reason: resultRow.gate.reason, errorCode: resultRow.gate.code });
      }
      globalThis.fetch = originalFetch;
    } else {
      // In AI-only mode no local inference has run. In hybrid mode the local
      // baseline is used only by the gate/adapter, never by the model request.
      const neutral = { lang: 'und', meta: { citations: [] } };
      const sources = modelSources(row.ticket, neutral, ruleCorpus);
      const request = buildContestRequest(row.ticket, neutral, sources);
      resultRow.sources = sources; resultRow.requestSha256 = sha256(JSON.stringify(request));
      if (ledger.reservedUsd + .002 > budget + 1e-12) throw new Error('Budget exhausted; no further requests made.');
      ledger.reservedUsd += .002; ledger.calls++; atomic(ledgerPath, ledger);
      resultRow.state = 'reserved'; report.ledgerEnd = structuredClone(ledger); checkpoint();
      const started = performance.now();
      const model = await requestContestModel(row.ticket, neutral, sources, key, { fetcher: async (...input) => { calls++; return originalFetch(...input); } });
      resultRow.elapsedMs = localElapsedMs + performance.now() - started; resultRow.providerCalls = calls; resultRow.modelResult = model; resultRow.costUsd = model.costUsd;
      // Local preflight rejections did not make a provider request.
      if (!calls) ledger.calls--;
      if (model.costUsd === null) ledger.unknownCostCalls++;
      else {
        if (!Number.isFinite(model.costUsd) || model.costUsd < 0) throw new Error('Invalid model charge; conservative reservation is retained.');
        ledger.reservedUsd += model.costUsd - .002; ledger.measuredUsd += model.costUsd;
      }
      atomic(ledgerPath, ledger); report.ledgerEnd = structuredClone(ledger);
      if (mode === 'hybrid') {
        resultRow.finalResult = applyContestModel(resultRow.localResult, model, sources);
        const final = resultRow.finalResult;
        resultRow.prediction = { category: final.category, priority: final.priority, lang: final.lang, needs_human: final.needs_human };
        const original = row.ticket.messages.filter(message => message.role === 'player').map(message => message.text).join('\n');
        resultRow.supportResult = processSupportMessage(original);
        resultRow.finalSupportResult = applyContestToSupport(original, resultRow.supportResult, final, { outcome: model.ok ? 'replaced' : 'unavailable', promptVersion: CONTEST_PROMPT_VERSION,
          reason: model.ok ? model.decision.reason : 'ИИ не завершил проверку; сохранён локальный вариант.', ...(model.ok ? { model: model.model, usage: model.usage } : { errorCode: model.code }) });
      } else if (model.ok) resultRow.prediction = { category: model.decision.category, priority: model.decision.priority, lang: model.decision.lang, needs_human: model.decision.needs_human };
    }
    resultRow.state = 'complete'; checkpoint();
    console.log(JSON.stringify({ completed: report.results.length, total: rows.length, ok: resultRow.prediction !== null, cost: resultRow.costUsd }));
  }
  report.state = 'completed'; report.finishedAt = new Date().toISOString(); checkpoint();
} catch (error) {
  if (createdOutput) { report.state = 'failed'; report.finishedAt = new Date().toISOString(); report.failure = 'Run stopped; completed rows and conservative reservations are preserved. Do not automatically rerun.'; try { checkpoint(); } catch { /* Existing checkpoint remains authoritative. */ } }
  throw error;
} finally {
  key = undefined; globalThis.fetch = originalFetch;
  if (lockFd !== undefined) { fs.closeSync(lockFd); fs.unlinkSync(lockPath); }
}
