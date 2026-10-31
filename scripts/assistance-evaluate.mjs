import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
function option(name,fallback){const i=args.indexOf(name);return i<0?fallback:args[i+1];}
const mode=option('--mode','current');
const split=option('--split','development');
const stage=option('--stage',`${mode}-${new Date().toISOString().replace(/[:.]/g,'-')}`);
const output=option('--out',path.resolve(root,'..','artifacts','assistance-20261031'));
if(!['baseline','current'].includes(mode))throw new Error('--mode must be baseline or current');
if(!['development','holdout','all'].includes(split))throw new Error('--split must be development, holdout or all');
if(mode==='current'&&split!=='development'&&!args.includes('--final-holdout'))throw new Error('Holdout is for the final audit. Pass --final-holdout and do not tune on its failures.');
if(!/^[a-zA-Z0-9._-]+$/.test(stage))throw new Error('Use a plain stage name');

const source=await readFile(path.join(root,'evaluation','support-assistance-cases.json'),'utf8');
const dataset=JSON.parse(source);
const ids=new Set();const familySplits=new Map();
for(const row of dataset.cases){
 if(ids.has(row.id))throw new Error(`Duplicate id ${row.id}`);ids.add(row.id);
 if(familySplits.has(row.family)&&familySplits.get(row.family)!==row.split)throw new Error(`Family leakage: ${row.family}`);
 familySplits.set(row.family,row.split);
}
if(dataset.cases.length!==2000||dataset.cases.filter(x=>x.group==='urgency').length!==1000||dataset.cases.filter(x=>x.group==='faq').length!==1000)throw new Error('Expected exactly 1000 urgency + 1000 FAQ rows');
const cases=dataset.cases.filter(x=>split==='all'||x.split===split);
const processor=mode==='baseline'
 ?(await import('../lib/message-processing.ts')).processMessageWithTrace
 :(await import('../lib/support-processing.ts')).processSupportMessage;
if(typeof processor!=='function')throw new Error('Required processor export is missing');
const started=Date.now();
const results=[];
for(const row of cases){
 let result;let error;
 try{result=await processor(row.text);}catch(caught){error=String(caught?.message??caught);}
 const trace=result?.processing;
 const actualRoute=trace?.route??null;
 const actualUrgency=mode==='current'?(trace?.urgency?.level??null):null;
 const knowledge=trace?.knowledge;
 const actualFaqStatus=mode==='baseline'?(actualRoute==='question'?'needs_admin':'not_applicable'):(knowledge?.status??'missing');
 const actualFaqId=mode==='current'?(knowledge?.entryId??null):null;
 const routeCorrect=actualRoute===row.expectedRoute;
 const componentCorrect=row.group==='urgency'
  ? actualUrgency===row.expectedUrgency
  : actualFaqStatus===row.expectedFaqStatus&&(row.expectedFaqStatus!=='answered'||actualFaqId===row.expectedFaqId);
 const failureKinds=[];
 if(error)failureKinds.push('processor_error');
 if(!routeCorrect)failureKinds.push('route_mismatch');
 if(!componentCorrect){
  if(!routeCorrect)failureKinds.push('component_result_affected_by_route');
  else if(row.group==='urgency')failureKinds.push(actualUrgency===null?'urgency_unavailable':'urgency_level_mismatch');
  else if(actualFaqStatus==='answered')failureKinds.push('faq_unsafe_answer');
  else if(row.expectedFaqStatus==='answered')failureKinds.push('faq_coverage_miss');
  else failureKinds.push('faq_status_mismatch');
 }
 results.push({...row,actualRoute,actualUrgency,actualFaqStatus,actualFaqId,routeCorrect,componentCorrect,correct:!error&&routeCorrect&&componentCorrect,
  failureKinds,
  reason:row.group==='urgency'?(trace?.urgency?.reason??(mode==='baseline'?'Urgency capability absent in baseline':'No urgency decision')):(knowledge?.reason??(mode==='baseline'?'No automatic knowledge answers in baseline':'No knowledge decision')),
  routingRule:trace?.ruleId??null,processingVersion:trace?.version??null,...(error?{error}:{}),});
}
const rate=(n,d)=>d?Math.round(n/d*10000)/100:null;
function aggregate(rows){
 const urgency=rows.filter(x=>x.group==='urgency');
 const faq=rows.filter(x=>x.group==='faq');
 const actualAnswers=faq.filter(x=>x.actualFaqStatus==='answered');
 const expectedAnswers=faq.filter(x=>x.expectedFaqStatus==='answered');
 const correctAnswers=actualAnswers.filter(x=>x.expectedFaqStatus==='answered'&&x.actualFaqId===x.expectedFaqId&&x.routeCorrect);
 const now=urgency.filter(x=>x.expectedUrgency==='now');
 const foundNow=now.filter(x=>x.actualUrgency==='now'&&x.actualRoute==='help');
 const correct=rows.filter(x=>x.correct).length;
 return {total:rows.length,families:new Set(rows.map(x=>x.family)).size,correct,errors:rows.length-correct,accuracyPercent:rate(correct,rows.length),routeCorrect:rows.filter(x=>x.routeCorrect).length,routeAccuracyPercent:rate(rows.filter(x=>x.routeCorrect).length,rows.length),componentCorrect:rows.filter(x=>x.componentCorrect).length,componentAccuracyGivenCorrectRoutePercent:rate(rows.filter(x=>x.routeCorrect&&x.componentCorrect).length,rows.filter(x=>x.routeCorrect).length),failureKinds:Object.fromEntries([...new Set(rows.flatMap(x=>x.failureKinds))].sort().map(kind=>[kind,rows.filter(x=>x.failureKinds.includes(kind)).length])),
  urgency:{total:urgency.length,expectedNow:now.length,correctNow:foundNow.length,missedNow:now.length-foundNow.length,nowRecallPercent:rate(foundNow.length,now.length),falseNow:urgency.filter(x=>x.actualUrgency==='now'&&x.expectedUrgency!=='now').length,unavailable:urgency.filter(x=>x.expectedUrgency!==null&&x.actualUrgency===null).length},
  faq:{total:faq.length,answerable:expectedAnswers.length,answered:actualAnswers.length,correctAnswers:correctAnswers.length,unsafeAnswers:actualAnswers.length-correctAnswers.length,answerPrecisionPercent:rate(correctAnswers.length,actualAnswers.length),answerRecallPercent:rate(correctAnswers.length,expectedAnswers.length),coveragePercent:rate(actualAnswers.length,faq.length),needsAdmin:faq.filter(x=>x.actualFaqStatus==='needs_admin').length},
 };
}
function by(field){return Object.fromEntries([...new Set(results.map(x=>x[field]))].sort().map(value=>[value,aggregate(results.filter(x=>x[field]===value))]));}
const summary={stage,mode,split,createdAt:new Date().toISOString(),durationMs:Date.now()-started,datasetSha256:createHash('sha256').update(source).digest('hex'),evaluationPolicy:'Expected labels fixed before inspecting new implementations. Component and routing accuracy both reported. Current full run is final holdout audit only.',limitations:dataset.limitations,overall:aggregate(results),byGroup:by('group'),bySplit:by('split'),byLanguage:by('language'),byMutation:by('mutation'),byFamily:by('family')};
await mkdir(output,{recursive:true});
await writeFile(path.join(output,`${stage}-summary.json`),JSON.stringify(summary,null,2)+'\n');
await writeFile(path.join(output,`${stage}-results.json`),JSON.stringify({stage,mode,split,datasetSha256:summary.datasetSha256,results},null,2)+'\n');
await writeFile(path.join(output,`${stage}-errors.json`),JSON.stringify({stage,mode,split,errors:results.filter(x=>!x.correct)},null,2)+'\n');
console.log(JSON.stringify({stage,mode,split,overall:summary.overall,byGroup:summary.byGroup,output},null,2));
