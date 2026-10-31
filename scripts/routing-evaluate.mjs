import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL, fileURLToPath} from 'node:url';

const routes = ['question', 'help', 'violation', 'trash'];
const key = route => route ?? 'undetermined';
const hash = value => createHash('sha256').update(value).digest('hex');
export function routeOf(processing) {
  if (Object.hasOwn(processing, 'route')) return processing.route;
  if (processing.classification === 'report') return processing.topic === 'Вопрос по игре' ? 'question' : 'help';
  return routes.includes(processing.classification) ? processing.classification : null;
}
export function summarize(rows) {
  const scored = rows.filter(row => row.expectedRoute !== null);
  const chosen = scored.filter(row => row.actualRoute !== null);
  const counts = Object.fromEntries(['correct','wrong','abstained','ambiguous'].map(k => [k, rows.filter(r => r.assessment === k).length]));
  const matrix = Object.fromEntries([...routes,'undetermined'].map(expected => [expected, Object.fromEntries([...routes,'undetermined'].map(actual => [actual, rows.filter(r => key(r.expectedRoute) === expected && key(r.actualRoute) === actual).length]))]));
  const details = rows.filter(r => typeof r.needsClarification === 'boolean');
  return {
    total: rows.length, scored: scored.length, ...counts, matrix,
    routeAccuracy: scored.length ? counts.correct / scored.length : null,
    coverage: scored.length ? chosen.length / scored.length : null,
    decisionPrecision: chosen.length ? counts.correct / chosen.length : null,
    helpAsQuestion: scored.filter(r => r.expectedRoute === 'help' && r.actualRoute === 'question').length,
    questionAsHelp: scored.filter(r => r.expectedRoute === 'question' && r.actualRoute === 'help').length,
    falseViolation: scored.filter(r => r.expectedRoute !== 'violation' && r.actualRoute === 'violation').length,
    falseTrash: scored.filter(r => r.expectedRoute !== 'trash' && r.actualRoute === 'trash').length,
    missedViolation: scored.filter(r => r.expectedRoute === 'violation' && r.actualRoute !== 'violation').length,
    ambiguousTerminal: rows.filter(r => r.expectedRoute === null && ['violation','trash'].includes(r.actualRoute)).length,
    details: {evaluated:details.length, correct:details.filter(r=>r.needsClarification===r.actualNeedsClarification).length,
      unnecessary:details.filter(r=>!r.needsClarification&&r.actualNeedsClarification).length,
      missing:details.filter(r=>r.needsClarification&&!r.actualNeedsClarification).length},
  };
}
export async function evaluate(args) {
  const option = name => {const index=args.indexOf(name); return index<0?null:args[index+1];};
  const input=option('--input'), output=option('--output');
  if(!input || !output) throw new Error('Usage: --input labels.json --output report.json [--lib directory --baseline report.json --stage name]');
  if(fs.existsSync(output)) throw new Error('Report exists; choose a new filename to preserve stage history');
  const source=fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'');
  const labels=source.trimStart().startsWith('[') ? JSON.parse(source) : source.split(/\r?\n/u).filter(line=>line.trim()).map(line=>JSON.parse(line));
  if(!Array.isArray(labels)||new Set(labels.map(r=>r.id)).size!==labels.length) throw new Error('Invalid or duplicate examples');
  for(const row of labels) {
    if(!row.id||typeof row.text!=='string'||!row.text.trim()||!(row.expectedRoute===null||routes.includes(row.expectedRoute))) throw new Error(`Invalid label ${row.id}`);
    if(![true,false,null].includes(row.needsClarification)) throw new Error(`Missing details label ${row.id}`);
  }
  const directory=path.resolve(option('--lib')||fileURLToPath(new URL('../lib/',import.meta.url)));
  const {processMessageWithTrace,PROCESSOR_VERSION}=await import(pathToFileURL(path.join(directory,'message-processing.ts')).href);
  const started=performance.now();
  const rows=labels.map(row=>{
    const after=processMessageWithTrace(row.text),p=after.processing;
    if(p.decisionSource==='classifier'||p.model) throw new Error('Learned model used');
    const actualRoute=routeOf(p);
    if(actualRoute!==null&&!routes.includes(actualRoute)) throw new Error(`Unknown runtime route ${actualRoute}`);
    const assessment=row.expectedRoute===null?'ambiguous':actualRoute===null?'abstained':actualRoute===row.expectedRoute?'correct':'wrong';
    return {...row,actualRoute,actualNeedsClarification:p.needsClarification??!!p.followUp,assessment,after};
  });
  const elapsedMs=performance.now()-started;
  const previous=option('--baseline')?JSON.parse(fs.readFileSync(option('--baseline'),'utf8')):null;
  let changes=[];
  if(previous) {
    if(previous.datasetSha256!==hash(source)) throw new Error('Baseline labels differ');
    const before=new Map(previous.rows.map(r=>[r.id,r]));
    changes=rows.flatMap(row=>{
      const old=before.get(row.id);
      if(!old||old.text!==row.text) throw new Error('Baseline text differs');
      if(old.actualRoute===row.actualRoute&&old.actualNeedsClarification===row.actualNeedsClarification&&old.after.text===row.after.text) return [];
      return [{id:row.id,text:row.text,expectedRoute:row.expectedRoute,
        before:{route:old.actualRoute,assessment:old.assessment,needsClarification:old.actualNeedsClarification},
        after:{route:row.actualRoute,assessment:row.assessment,needsClarification:row.actualNeedsClarification}}];
    });
  }
  const result={generatedAt:new Date().toISOString(),stage:option('--stage')||PROCESSOR_VERSION,processorVersion:PROCESSOR_VERSION,
    datasetSha256:hash(source),labelStatus:'assistant-provisional',humanReviewed:labels.filter(r=>r.labelStatus==='human-reviewed').length,
    runtimeSha256:hash(fs.readdirSync(directory).filter(f=>f.endsWith('.ts')&&!f.endsWith('.test.ts')).sort().map(f=>f+'\n'+fs.readFileSync(path.join(directory,f),'utf8')).join('\n')),
    elapsedMs,model:{enabled:false,used:0},summary:summarize(rows),
    comparison:previous?{baseline:previous.stage,improved:changes.filter(r=>r.before.assessment!=='correct'&&r.after.assessment==='correct').length,
      lostCorrect:changes.filter(r=>r.before.assessment==='correct'&&r.after.assessment!=='correct').length,
      abstainedToWrong:changes.filter(r=>r.before.assessment==='abstained'&&r.after.assessment==='wrong').length}:null,changes,rows};
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(result,null,2));
  return {output,stage:result.stage,...result.summary,comparison:result.comparison,elapsedMs};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {console.log(JSON.stringify(await evaluate(process.argv.slice(2)),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
