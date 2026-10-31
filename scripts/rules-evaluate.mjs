import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Rules-only evaluation. Never call predictIntent or import the trained model.
// A historic processor is loaded only for its exported correctText function;
// its processMessageWithTrace entry point is deliberately not called.
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
if (!arg('--input') || !arg('--output')) throw new Error('Usage: node scripts/rules-evaluate.mjs --input evaluation.jsonl --output report.json [--baseline-only --baseline-lib directory | --baseline-report report.json]');
const inputPath = path.resolve(arg('--input'));
const input = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
const rows = input.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate evaluation ids');
for (const row of rows) {
  if (!row.id || typeof row.text !== 'string' || !row.text.trim()) throw new Error('Invalid evaluation example');
  if (!row.ambiguous && !['report', 'clarify', 'violation', 'trash'].includes(row.expectedClassification)) throw new Error(`Missing label: ${row.id}`);
  if (!row.ambiguous && row.expectedClassification === 'report' && !row.allowedTopics?.length) throw new Error(`Missing report topics: ${row.id}`);
}
let processMessage, processorVersion;
const baselineOnly = args.includes('--baseline-only');
if (baselineOnly) {
  if (!arg('--baseline-lib')) throw new Error('--baseline-only needs --baseline-lib');
  const base = path.resolve(arg('--baseline-lib'));
  const load = name => import(pathToFileURL(path.join(base, name)).href);
  const [{ correctText, PROCESSOR_VERSION }, { inspectModeration }, { understandMessage }, { classifyMessage }] = await Promise.all([
    load('message-processing.ts'), load('message-moderation.ts'), load('message-understanding.ts'), load('message-classification.ts'),
  ]);
  processorVersion = `${PROCESSOR_VERSION}-pure-rules`;
  processMessage = original => {
    const moderation = inspectModeration(original);
    if (moderation.kind === 'violation') return {
      text: original.trim(), status: 'violation', corrected: false,
      processing: { classification: 'violation', topic: 'Оскорбление в обращении', version: processorVersion, decisionSource: 'rules', steps: [] },
    };
    const text = correctText(original);
    const understood = understandMessage(text);
    const decision = classifyMessage(original, text, understood.text);
    return {
      text, status: decision.status, corrected: text !== original.trim(),
      processing: { classification: decision.classification, topic: decision.topic, version: processorVersion, decisionSource: 'rules', reason: decision.reason, steps: [] },
    };
  };
} else {
  const current = await import('../lib/message-processing.ts');
  processMessage = current.processMessageWithTrace;
  processorVersion = current.PROCESSOR_VERSION;
}
let previous = null;
if (arg('--baseline-report')) {
  previous = JSON.parse(fs.readFileSync(path.resolve(arg('--baseline-report')), 'utf8'));
  if (previous.summary.model?.used !== 0) throw new Error('Comparison baseline must also use zero learned-model decisions');
  if (previous.rows.length !== rows.length) throw new Error('Baseline length differs');
}
const oldById = new Map(previous?.rows.map(row => [row.id, row]) ?? []);
function assess(row, result) {
  if (row.ambiguous) return 'uncertain';
  const { classification, topic } = result.processing;
  if (classification === 'clarify' && row.expectedClassification !== 'clarify') return 'missed';
  if (classification !== row.expectedClassification) return 'wrong';
  if (classification === 'report' && !row.allowedTopics.includes(topic)) return 'wrong';
  return 'correct';
}
const evaluated = rows.map(row => {
  const old = oldById.get(row.id);
  if (previous && (!old || old.text !== row.text || old.expectedClassification !== row.expectedClassification || !!old.ambiguous !== !!row.ambiguous || JSON.stringify(old.allowedTopics) !== JSON.stringify(row.allowedTopics))) throw new Error(`Baseline labels/text changed: ${row.id}`);
  const after = processMessage(row.text);
  if (after.processing.decisionSource === 'classifier' || after.processing.model) throw new Error(`Learned model appeared in rules-only evaluation: ${row.id}`);
  const before = old?.after;
  const acceptedCorrections = row.allowedCorrectedTexts ?? (row.expectedCorrectedText !== undefined ? [row.expectedCorrectedText] : null);
  // Ignore historical input.before: older files contain trained-model outputs.
  const metadata = { ...row };
  delete metadata.before;
  return { ...metadata, ...(before && { before, beforeAssessment: assess(row, before) }), after, afterAssessment: assess(row, after), correction: acceptedCorrections ? { before: before ? acceptedCorrections.includes(before.text) : null, after: acceptedCorrections.includes(after.text) } : null };
});
function stats(items, side) {
  const counts = Object.fromEntries(['correct', 'wrong', 'missed', 'uncertain'].map(key => [key, items.filter(row => row[`${side}Assessment`] === key).length]));
  const scored = items.filter(row => !row.ambiguous);
  const chosen = category => scored.filter(row => row[side]?.processing.classification === category);
  const wanted = category => scored.filter(row => row.expectedClassification === category);
  const violations = chosen('violation'), trash = chosen('trash');
  const violationsDetected = violations.filter(row => row.expectedClassification === 'violation').length;
  return {
    ...counts,
    falseViolation: violations.filter(row => row.expectedClassification !== 'violation').length,
    falseTrash: trash.filter(row => row.expectedClassification !== 'trash').length,
    violationsDetected, violationsTotal: wanted('violation').length,
    violationsSelected: violations.length, trashDetected: trash.filter(row => row.expectedClassification === 'trash').length, trashTotal: wanted('trash').length,
    classifiedCoverage: scored.length ? scored.filter(row => row[side]?.processing.classification !== 'clarify').length / scored.length : null,
  };
}
const groups = Object.fromEntries([...new Set(rows.map(row => row.group))].map(group => {
  const members = evaluated.filter(row => row.group === group);
  return [group, { total: members.length, ...(previous && { before: stats(members, 'before') }), after: stats(members, 'after') }];
}));
const changed = previous ? evaluated.filter(row => row.before.processing.classification !== row.after.processing.classification || row.before.processing.topic !== row.after.processing.topic || row.before.text !== row.after.text).map(row => ({
  id: row.id, text: row.text, group: row.group, expectedClassification: row.expectedClassification, allowedTopics: row.allowedTopics,
  before: { classification: row.before.processing.classification, topic: row.before.processing.topic, text: row.before.text, assessment: row.beforeAssessment },
  after: { classification: row.after.processing.classification, topic: row.after.processing.topic, text: row.after.text, assessment: row.afterAssessment },
})) : [];
// Approval provenance must be explicit; missing or unknown markers remain provisional.
const labelStatusCounts = { "human-reviewed": 0, provisional: 0 };
for (const row of rows) labelStatusCounts[row.labelStatus === "human-reviewed" ? "human-reviewed" : "provisional"]++;
const labelStatus = labelStatusCounts["human-reviewed"] && labelStatusCounts.provisional ? "mixed" : labelStatusCounts["human-reviewed"] ? "human-reviewed" : "provisional";
const summary = {
  generatedAt: new Date().toISOString(), processorVersion, modelVersion: null, labelStatus, labelStatusCounts,
  total: rows.length, datasetSha256: createHash('sha256').update(input).digest('hex'), baselineProcessorVersion: previous?.summary.processorVersion ?? null,
  ...(previous && { before: stats(evaluated, 'before') }), after: stats(evaluated, 'after'),
  model: { enabled: false, used: 0, correct: 0, wrong: 0, uncertain: 0 },
  correction: { evaluated: evaluated.filter(row => row.correction).length, beforeCorrect: previous ? evaluated.filter(row => row.correction?.before).length : null, afterCorrect: evaluated.filter(row => row.correction?.after).length },
  changes: { total: changed.length, improved: evaluated.filter(row => row.beforeAssessment && row.beforeAssessment !== 'correct' && row.afterAssessment === 'correct').length, regressed: evaluated.filter(row => row.beforeAssessment === 'correct' && row.afterAssessment !== 'correct').length },
  groups,
};
const outputPath = path.resolve(arg('--output'));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify({ summary, changes: changed, rows: evaluated }, null, 2));
const consoleSummary = { ...summary };
delete consoleSummary.groups;
console.log(JSON.stringify({ output: outputPath, ...consoleSummary }, null, 2));
