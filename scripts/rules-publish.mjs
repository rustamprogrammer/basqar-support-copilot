import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const paths = process.argv.slice(2);
if (paths.length !== 3) throw new Error('Usage: node scripts/rules-publish.mjs regression.json additional.json holdout.json');
const summaries = paths.map(file => {
  const { summary } = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!summary?.before || !summary.after || summary.model?.enabled !== false || summary.model?.used !== 0) throw new Error('Expected a rules-only comparison report');
  // Publish aggregates only. Full reports contain private ticket text and stay local.
  const { generatedAt, processorVersion, baselineProcessorVersion, total, datasetSha256, labelStatus, before, after, correction, changes, groups } = summary;
  return { generatedAt, processorVersion, baselineProcessorVersion, total, datasetSha256, labelStatus, before, after, correction, changes, groups };
});
if (new Set(summaries.map(item => item.processorVersion)).size !== 1) throw new Error('Processor versions differ');
const [regression, additional, holdout] = summaries;
fs.writeFileSync(fileURLToPath(new URL('../lib/quality-summary.json', import.meta.url)), JSON.stringify({ generatedAt: new Date().toISOString(), regression, additional, holdout }, null, 2) + '\n');
console.log('Published aggregate rules evaluation. No ticket text included.');
