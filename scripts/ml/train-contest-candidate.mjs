import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { prepareContestDataset, comparableIntent } from './contest-dataset.mjs';
import { predictIntent, predictIntentWithModel, modelInfo } from '../../lib/intent-model.ts';
import { correctText } from '../../lib/message-processing.ts';
import { understandMessage } from '../../lib/message-understanding.ts';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const trainingPath = option('--train'), holdoutPath = option('--holdout'), output = option('--out');
if (!trainingPath || !holdoutPath || !output) throw new Error('Usage: node scripts/ml/train-contest-candidate.mjs --train authored-training.jsonl --holdout untouched-holdout.jsonl --out PRIVATE_OUTPUT_DIRECTORY');
const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.resolve(output);
if (fs.existsSync(destination)) throw new Error('Choose a new output directory to preserve prior candidate results.');
const readRows = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const { prepared, heldout, counts } = prepareContestDataset(readRows(trainingPath), readRows(holdoutPath));
fs.mkdirSync(destination, { recursive: true });
const datasetPath = path.join(destination, 'training.local.jsonl'), candidatePath = path.join(destination, 'candidate.local.json');
fs.writeFileSync(datasetPath, prepared.map(row => JSON.stringify(row)).join('\n') + '\n');
const fit = spawnSync(process.execPath, [path.join(root, 'scripts/ml/train.mjs'), '--input', datasetPath, '--allow-provisional', '--output', candidatePath], { cwd: root, stdio: 'inherit', windowsHide: true });
if (fit.error) throw fit.error;
if (fit.status !== 0) throw new Error(`Candidate training failed with exit code ${fit.status}.`);
const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const parity = JSON.parse(fs.readFileSync(candidatePath.replace(/\.json$/u, '.parity.json'), 'utf8'));
for (const row of parity) {
  const prediction = predictIntentWithModel(candidate, row.text, row.understood);
  const maximum = Math.max(...row.probabilities);
  assert.equal(prediction.label, candidate.labels[row.probabilities.indexOf(maximum)]);
  assert.ok(Math.abs(prediction.score - maximum) < 1e-6, 'Python/TypeScript probability mismatch.');
}

// No fitting or threshold changes occur after opening the final holdout labels.
const evaluate = predict => {
  const result = { total: heldout.length, rawCorrect: 0, accepted: 0, correctAccepted: 0, wrongAccepted: 0, accuracy: 0, coverage: 0, acceptedPrecision: null };
  for (const row of heldout) {
    const understood = understandMessage(correctText(row.text)).text;
    const prediction = predict(row.text, understood);
    const correct = comparableIntent(prediction.label) === comparableIntent(row.label);
    result.rawCorrect += Number(correct);
    if (prediction.accepted) { result.accepted++; result.correctAccepted += Number(correct); result.wrongAccepted += Number(!correct); }
  }
  result.accuracy = result.total ? result.rawCorrect / result.total : 0;
  result.coverage = result.total ? result.accepted / result.total : 0;
  result.acceptedPrecision = result.accepted ? result.correctAccepted / result.accepted : null;
  return result;
};
const baseline = evaluate(predictIntent), measured = evaluate((original, understood) => predictIntentWithModel(candidate, original, understood));
const passesComparison = measured.accepted >= 5 && measured.acceptedPrecision >= .9 && measured.correctAccepted > baseline.correctAccepted && measured.wrongAccepted <= baseline.wrongAccepted && measured.rawCorrect >= baseline.rawCorrect;
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = {
  schema: 'contest-local-candidate-v1', createdAt: new Date().toISOString(), trainingKind: 'local TF-IDF logistic regression; not provider fine-tuning',
  counts, trainingSha256: sha256(trainingPath), holdoutSha256: sha256(holdoutPath),
  provenance: 'authored synthetic, provisional; not human approved', baselineVersion: modelInfo.version, candidateVersion: candidate.version,
  baseline, candidate: measured, thresholds: candidate.thresholds, pythonTypeScriptParity: { passed: parity.length, tolerance: 1e-6 },
  passesComparison, activated: false, providerApiCalls: 0, providerCostUsd: 0,
  limitations: ['Small synthetic dataset does not establish live accuracy.', 'The 14 contest categories are mapped to seven legacy intent topics; this candidate does not predict priority, citations or drafts.', 'Appeals and admin actions are compared as one category.', 'Whole families stay together in the training/validation split.', 'Holdout is excluded from fitting and threshold selection.', 'The current application does not call the legacy intent classifier; this candidate is not activated automatically.'],
};
fs.writeFileSync(path.join(destination, 'comparison.local.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, output: destination }, null, 2));
