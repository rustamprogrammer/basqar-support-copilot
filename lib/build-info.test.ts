import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BUILD_INFO } from './build-info.ts';
import { readBuildInfo } from '../scripts/build-info.mjs';

test('unbundled source never claims a build revision', () => {
  assert.deepEqual(BUILD_INFO, { commit: null, dirty: null, builtAt: null, mode: 'unknown' });
});

test('build metadata has a timestamp and does not invent a missing revision', () => {
  const result = readBuildInfo(fileURLToPath(new URL('../nonexistent-build-source/', import.meta.url)), 'build');
  assert.equal(result.commit, null);
  assert.equal(result.dirty, null);
  assert.equal(result.mode, 'build');
  assert.ok(Number.isFinite(Date.parse(result.builtAt)));
});
