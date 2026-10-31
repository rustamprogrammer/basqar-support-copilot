import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareCiCorpus, CI_CORPUS } from './prepare-ci-corpus.mjs';
import { validateCorpus } from '../lib/triage/retrieval.ts';

test('public CI fixture satisfies the corpus contract and is explicitly synthetic', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'basqar-ci-corpus-'));
  try {
    const target = path.join(directory, 'corpus.local.json');
    await prepareCiCorpus(target);
    const corpus = validateCorpus(JSON.parse(await readFile(target, 'utf8')));
    assert.deepEqual(corpus, CI_CORPUS);
    assert.equal(corpus.chunks.length, 1);
    assert.match(corpus.version, /^ci-synthetic-/u);
    assert.match(corpus.source, /never deploy/u);
  } finally {
    await rm(path.join(directory, 'corpus.local.json'), { force: true });
    await rmdir(directory);
  }
});

test('public CI preparation refuses to replace an existing private corpus', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'basqar-ci-corpus-'));
  try {
    const target = path.join(directory, 'corpus.local.json');
    const original = 'existing private corpus must remain unchanged\n';
    await writeFile(target, original);
    await assert.rejects(prepareCiCorpus(target), { code: 'EEXIST' });
    assert.equal(await readFile(target, 'utf8'), original);
  } finally {
    await rm(path.join(directory, 'corpus.local.json'), { force: true });
    await rmdir(directory);
  }
});
