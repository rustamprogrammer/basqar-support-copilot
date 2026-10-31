import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Authored fixture, not an excerpt of the private handout. Public CI checks the
// code and build contract; it cannot establish real corpus retrieval quality.
export const CI_CORPUS = {
  version: 'ci-synthetic-v1',
  source: 'Synthetic public CI fixture only; not the Grand Mobile rules corpus; never deploy this build.',
  chunks: [{
    id: 'ci:synthetic-rule',
    section: 'Synthetic CI fixture',
    ref: 'CI-SYNTHETIC',
    text: 'This authored fixture exists only to validate the public CI build. It contains no game rules and is not a support knowledge source.',
  }],
};

export async function prepareCiCorpus(target = new URL('../lib/triage/corpus.local.json', import.meta.url)) {
  // Refuse any existing file, including an existing private corpus or symlink.
  await writeFile(target, JSON.stringify(CI_CORPUS, null, 2) + '\n', { flag: 'wx' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/prepare-ci-corpus.mjs (public CI only).');
  await prepareCiCorpus();
  console.log('Created synthetic CI corpus. This build must not be deployed or used to measure real rule retrieval.');
}
