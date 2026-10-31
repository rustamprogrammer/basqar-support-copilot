import fs from 'node:fs';
import assert from 'node:assert/strict';
import { predictIntent } from '../../lib/intent-model.ts';
import model from '../../lib/models/intent-model.json' with {type:'json'};
const file=process.argv[2];
if(!file)throw Error('Usage: npm run ml:verify -- candidate.parity.json');
const rows=JSON.parse(fs.readFileSync(file,'utf8'));
for(const row of rows){
  const prediction=predictIntent(row.text,row.understood);
  const max=Math.max(...row.probabilities), label=model.labels[row.probabilities.indexOf(max)];
  assert.equal(prediction.label,label);
  assert.ok(Math.abs(prediction.score-max)<1e-6,`Python/TypeScript score mismatch: ${prediction.score} vs ${max}`);
}
console.log(`Python/TypeScript parity passed: ${rows.length} examples`);
