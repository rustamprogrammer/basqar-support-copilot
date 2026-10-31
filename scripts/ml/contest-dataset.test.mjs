import test from 'node:test';
import assert from 'node:assert/strict';
import { contestExample, prepareContestDataset, comparableIntent } from './contest-dataset.mjs';

const sample = (id, category = 'report.help', family = id) => ({ id, family, ticket: { messages: [{ role: 'player', text: `Player message number ${id}` }, { role: 'admin', text: 'Private verdict and punishment' }] }, expected: { category } });
test('training export excludes administrator text and keeps provisional provenance', () => {
  const row = contestExample(sample('one'), 0);
  assert.equal(row.text, 'Player message number one');
  assert.equal(row.reviewStatus, 'provisional');
  assert.equal(row.label, 'help');
  assert.equal(comparableIntent('appeal'), comparableIntent('administration'));
});
test('holdout text and family overlap both block training', () => {
  assert.throws(() => prepareContestDataset([sample('same')], [sample('same')]), /overlaps protected/);
  assert.throws(() => prepareContestDataset([sample('a', 'report.help', 'family')], [sample('b', 'report.help', 'family')]), /overlaps protected/);
});
test('deterministic training split keeps every family and translation together', () => {
  const labels = ['report.help', 'report.question', 'report.account', 'report.payment'];
  const rows = Array.from({ length: 60 }, (_, index) => sample(String(index), labels[index % labels.length], `family-${Math.floor(index / 2)}`));
  const a = prepareContestDataset(rows, [sample('heldout')]);
  const b = prepareContestDataset([...rows].reverse(), [sample('heldout')]);
  const splits = list => Object.fromEntries(list.map(row => [row.id, row.split]));
  assert.deepEqual(splits(a.prepared), splits(b.prepared));
  for (const family of new Set(a.prepared.map(row => row.family))) assert.equal(new Set(a.prepared.filter(row => row.family === family).map(row => row.split)).size, 1);
  assert.equal(a.counts.train + a.counts.validation, 60);
});
