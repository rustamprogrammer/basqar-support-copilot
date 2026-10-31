import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const languages = ['ru', 'kk', 'uk', 'uz'];
const routes = ['question', 'help', 'violation', 'trash', 'undetermined'];
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const fields = (source, names) => Object.fromEntries(names.map(name => [name, numeric(source?.[name])]));

async function summary(filename) {
  if (!filename || !/-summary\.json$/u.test(path.basename(filename))) throw new Error('Pass a *-summary.json file, never raw results or errors.');
  const value = JSON.parse(await readFile(filename, 'utf8'));
  if (!value || Array.isArray(value) || Array.isArray(value.results) || Array.isArray(value.errors)) throw new Error('A summary object is required.');
  return value;
}
function aggregate(value) {
  if (!value) return null;
  if (value.correct + value.errors !== value.total) throw new Error('Invalid aggregate counts.');
  return {
    ...fields(value, ['total', 'families', 'correct', 'errors', 'accuracyPercent', 'routeCorrect', 'routeAccuracyPercent']),
    urgency: fields(value.urgency, ['total', 'expectedNow', 'correctNow', 'missedNow', 'nowRecallPercent', 'falseNow', 'unavailable']),
    faq: fields(value.faq, ['total', 'answerable', 'answered', 'correctAnswers', 'unsafeAnswers', 'answerPrecisionPercent', 'answerRecallPercent', 'coveragePercent', 'needsAdmin']),
  };
}
function category(value) { return fields(value, ['total', 'correct', 'wrong', 'accuracy']); }
function comparison(value) {
  return value ? { baseline: String(value.baseline ?? ''), ...fields(value, ['baselineCorrect', 'improved', 'regressed', 'deltaCorrect', 'deltaPercentagePoints']) } : null;
}

const source = await summary(option('--assistance'));
if (!source.overall || !source.bySplit) throw new Error('Invalid assistance summary.');
const benchmarkPath = option('--benchmark');
const benchmark = benchmarkPath ? await summary(benchmarkPath) : null;
if (benchmark && benchmark.correct + benchmark.wrong !== benchmark.total) throw new Error('Invalid benchmark counts.');

// Whitelist numeric aggregates. Source summaries can also contain private paths,
// example messages and disputed-label text; none of those are published here.
const output = {
  schema: 'assistance-quality-v1',
  generatedAt: new Date().toISOString(),
  humanVerified: false,
  assistance: {
    stage: String(source.stage), createdAt: source.createdAt,
    overall: aggregate(source.overall),
    development: aggregate(source.bySplit.development),
    holdout: aggregate(source.bySplit.holdout),
    languages: languages.filter(language => source.byLanguage?.[language]).map(language => ({ language, ...aggregate(source.byLanguage[language]) })),
  },
  benchmark: benchmark ? {
    run: String(benchmark.run), createdAt: benchmark.createdAt,
    ...category(benchmark),
    diagnostics: fields(benchmark.diagnostics, ['undetermined', 'falseViolation', 'falseTrash', 'missedViolation', 'helpAsQuestion', 'questionAsHelp']),
    languages: languages.filter(language => benchmark.byLanguage?.[language]).map(language => ({ language, ...category(benchmark.byLanguage[language]) })),
    categories: routes.filter(route => benchmark.byExpected?.[route]).map(route => ({ route, ...category(benchmark.byExpected[route]) })),
    comparison: comparison(benchmark.comparedToHistorical ?? benchmark.comparedToPrevious),
    coverage: {
      urgency: fields(benchmark.urgency?.distribution, ['now', 'high', 'normal', 'not_evaluated']),
      urgencyUncertain: numeric(benchmark.urgency?.uncertain),
      faqAnswered: numeric(benchmark.faq?.answered),
      faqNeedsAdmin: numeric(benchmark.faq?.statuses?.needs_admin),
      faqCoverage: numeric(benchmark.faq?.coverage),
    },
    labels: fields(benchmark.labelProvenance, ['scenarios', 'baseTexts', 'disputedReferenceRows']),
  } : null,
};
const target = path.resolve(option('--out') ?? path.join(root, 'lib', 'assistance-quality-summary.json'));
await writeFile(target, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ file: target, stage: output.assistance.stage, benchmark: output.benchmark?.run ?? null, rawMessagesPublished: 0 }));
