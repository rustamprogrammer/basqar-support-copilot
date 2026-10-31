import { readFile } from 'node:fs/promises';
try {
  const corpus = JSON.parse(await readFile(new URL('../lib/triage/corpus.local.json', import.meta.url), 'utf8'));
  if (!Array.isArray(corpus.chunks) || !corpus.chunks.length) throw new Error('Empty corpus');
} catch {
  throw new Error('Prepare the private rules corpus first: node scripts/prepare-triage-corpus.mjs --rules /path/to/rules.json. Raw rules and tickets must not be committed.');
}
