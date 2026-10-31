import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const archive = option('--archive'), filename = option('--rules');
if (!archive && !filename) throw new Error('Usage: node scripts/prepare-triage-corpus.mjs --rules /private/rules.json OR --archive /private/handout.tgz');
const raw = archive ? execFileSync('tar', ['-xOf', archive, 'handout/rules.json'], { encoding: 'utf8', maxBuffer: 5_000_000 }) : await readFile(filename, 'utf8');
const data = JSON.parse(raw);
if (!Array.isArray(data.rules) || !data.rules.length) throw new Error('Expected handout rules array.');
const chunks = [];
for (const section of data.rules) {
  if (!Number.isSafeInteger(section.id) || typeof section.category !== 'string') throw new Error('Invalid section.');
  for (const point of section.points ?? []) {
    if (typeof point.ref !== 'string' || typeof point.text !== 'string' || !point.text.trim()) throw new Error('Invalid rule point.');
    chunks.push({ id: `${section.id}:${point.ref}`, section: section.category, ref: point.ref, text: point.text.trim() });
  }
  // Some handout sections (RP definitions) contain text but no parsed points.
  if (!section.points?.length && typeof section.text === 'string') {
    for (const [i, part] of section.text.split(/(?:^|\n)\s*•\s*/u).filter(s => s.trim()).entries()) {
      const heading = part.split(/[—–]/u)[0].replace(/\s*\(.*$/u, '').trim();
      chunks.push({ id: `${section.id}:text-${i + 1}`, section: section.category, ref: `${section.category}: ${heading}`, text: part.trim() });
    }
  }
}
if (new Set(chunks.map(x => x.id)).size !== chunks.length) throw new Error('Duplicate section/ref pairs.');
const target = fileURLToPath(new URL('../lib/triage/corpus.local.json', import.meta.url));
const corpus = { version: createHash('sha256').update(raw).digest('hex'), source: 'Grand Mobile handout rules.json; local use only', chunks };
if (args.includes('--stdout')) process.stdout.write(JSON.stringify(corpus));
else {
  await writeFile(target, JSON.stringify(corpus, null, 2) + '\n');
  console.log(JSON.stringify({ sections: data.rules.length, chunks: chunks.length, version: corpus.version, output: target, apiCalls: 0 }));
}
