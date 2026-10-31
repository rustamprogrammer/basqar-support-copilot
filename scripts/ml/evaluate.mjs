import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { processMessageWithTrace, PROCESSOR_VERSION } from '../../lib/message-processing.ts';
import { modelInfo } from '../../lib/intent-model.ts';
import { textHash } from './dataset.mjs';
const args=process.argv.slice(2), arg=name=>args[args.indexOf(name)+1];
if(!args.includes('--input')||!args.includes('--output')) throw new Error('Usage: npm run ml:evaluate -- --input evaluation.jsonl --output report.json [--baseline path/to/message-processing.ts]');
const data=fs.readFileSync(arg('--input'),'utf8').replace(/^\uFEFF/,'');
const rows=data.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
if(args.includes('--holdout')) {
  const registry='.sites-runtime/ml/holdout-hashes.json';
  const hashes=new Set(fs.existsSync(registry)?JSON.parse(fs.readFileSync(registry,'utf8')):[]);
  rows.forEach(row=>hashes.add(textHash(row.text)));
  fs.mkdirSync(path.dirname(registry),{recursive:true});
  fs.writeFileSync(registry,JSON.stringify([...hashes].sort()));
}
const baseline=args.includes('--baseline')?(await import(pathToFileURL(path.resolve(arg('--baseline'))))).processMessageWithTrace:null;
function assess(row,result){
  const {classification,topic}=result.processing;
  if(row.ambiguous)return 'uncertain';
  if(!row.expectedClassification)throw new Error(`Missing expected classification: ${row.id}`);
  if(classification==='clarify'&&row.expectedClassification!=='clarify')return 'missed';
  if(classification!==row.expectedClassification)return 'wrong';
  if(classification==='report'&&!row.allowedTopics?.includes(topic))return 'wrong';
  return 'correct';
}
const results=rows.map(row=>{
  const after=processMessageWithTrace(row.text),before=baseline?baseline(row.text):row.before;
  return {...row,after,afterAssessment:assess(row,after),...(before&&{before,beforeAssessment:assess(row,before)}),correction:row.expectedCorrectedText?{before:before?.text===row.expectedCorrectedText,after:after.text===row.expectedCorrectedText}:null};
});
function stats(items,side){
  const counts=Object.fromEntries(['correct','wrong','missed','uncertain'].map(key=>[key,items.filter(r=>r[side+'Assessment']===key).length]));
  return {...counts,falseViolation:items.filter(r=>!r.ambiguous&&r[side]?.status==='violation'&&r.expectedClassification!=='violation').length,falseTrash:items.filter(r=>!r.ambiguous&&r[side]?.status==='trash'&&r.expectedClassification!=='trash').length,
    violationsDetected:items.filter(r=>r.expectedClassification==='violation'&&r[side]?.status==='violation').length,violationsTotal:items.filter(r=>!r.ambiguous&&r.expectedClassification==='violation').length};
}
const modelRows=results.filter(row=>row.after.processing.decisionSource==='classifier');
const summary={processorVersion:PROCESSOR_VERSION,modelVersion:modelInfo.version,total:rows.length,labelStatus:'provisional',datasetSha256:createHash('sha256').update(data).digest('hex'),before:stats(results,'before'),after:stats(results,'after'),
  model:{used:modelRows.length,correct:modelRows.filter(r=>r.afterAssessment==='correct').length,wrong:modelRows.filter(r=>r.afterAssessment==='wrong').length,uncertain:modelRows.filter(r=>r.afterAssessment==='uncertain').length},
  correction:{evaluated:results.filter(r=>r.correction).length,beforeCorrect:results.filter(r=>r.correction?.before).length,afterCorrect:results.filter(r=>r.correction?.after).length},
  groups:Object.fromEntries([...new Set(rows.map(r=>r.group))].map(group=>{const items=results.filter(r=>r.group===group);return [group,{total:items.length,before:stats(items,'before'),after:stats(items,'after')}];}))};
fs.mkdirSync(path.dirname(path.resolve(arg('--output'))),{recursive:true});
fs.writeFileSync(arg('--output'),JSON.stringify({summary,rows:results},null,2));
console.log(JSON.stringify(summary,null,2));
