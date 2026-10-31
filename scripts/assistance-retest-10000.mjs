import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const artifacts=path.resolve(root,'..','artifacts');
const args=process.argv.slice(2);
function option(name,fallback){const i=args.indexOf(name);return i<0?fallback:args[i+1];}
const previousRoot=path.join(artifacts,'benchmark-10000-2026-10-31');
const datasetPath=path.resolve(option('--dataset',path.join(previousRoot,'labels-frozen.jsonl')));
const previousSummaryPath=path.resolve(option('--baseline-summary',path.join(previousRoot,'run-06-final-site-summary.json')));
const previousRowsPath=path.resolve(option('--baseline-rows',path.join(previousRoot,'run-06-final-site-rows.jsonl')));
const historicalSummaryPath=path.resolve(option('--historical-summary',path.join(previousRoot,'run-06-final-site-summary.json')));
const historicalRowsPath=path.resolve(option('--historical-rows',path.join(previousRoot,'run-06-final-site-rows.jsonl')));
const auditPath=path.resolve(option('--audit',path.join(previousRoot,'label-audit.json')));
const out=path.resolve(option('--out',path.join(artifacts,'assistance-20261031')));
if(out===root||out.startsWith(root+path.sep))throw new Error('Output and source snapshot must stay outside the repository.');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const prefix=path.join(out,`retest-10000-${stamp}`);
const hash=data=>createHash('sha256').update(data).digest('hex');
const readLines=file=>fs.readFileSync(file,'utf8').trim().split(/\r?\n/u).map(JSON.parse);
const source=fs.readFileSync(datasetPath,'utf8');
const labels=source.trim().split(/\r?\n/u).map(JSON.parse);
const datasetSha256=hash(source);
const previousSummary=JSON.parse(fs.readFileSync(previousSummaryPath,'utf8'));
const previousRows=readLines(previousRowsPath),previous=new Map(previousRows.map(row=>[row.id,row]));
const historicalSummary=historicalSummaryPath===previousSummaryPath?previousSummary:JSON.parse(fs.readFileSync(historicalSummaryPath,'utf8'));
const historical=historicalRowsPath===previousRowsPath?previous:new Map(readLines(historicalRowsPath).map(row=>[row.id,row]));
const audit=JSON.parse(fs.readFileSync(auditPath,'utf8'));
if(labels.length!==10000||new Set(labels.map(row=>row.id)).size!==10000)throw new Error('Expected the original 10000 distinct IDs.');
if(previousSummary.datasetSha256!==datasetSha256)throw new Error('The previous report used a different dataset or labels.');
if(historicalSummary.datasetSha256!==datasetSha256)throw new Error('The historical report used a different dataset or labels.');
for(const label of labels){const before=previous.get(label.id);if(!before||before.text!==label.text||before.expected!==label.expected_route)throw new Error(`Baseline mismatch for ${label.id}`);}
for(const label of labels){const before=historical.get(label.id);if(!before||before.text!==label.text||before.expected!==label.expected_route)throw new Error(`Historical mismatch for ${label.id}`);}

fs.mkdirSync(out,{recursive:true});
const snapshot=prefix+'-source';
fs.cpSync(path.join(root,'lib'),snapshot,{recursive:true,errorOnExist:true,force:false});
fs.writeFileSync(path.join(snapshot,'package.json'),'{"type":"module"}\n');
function sourceFiles(directory,relative=''){
 return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sourceFiles(path.join(directory,entry.name),path.join(relative,entry.name)):[path.join(relative,entry.name)]).sort();
}
const sourceManifest=sourceFiles(snapshot).map(name=>({name,sha256:hash(fs.readFileSync(path.join(snapshot,name)))}));
const runtimeSha256=hash(JSON.stringify(sourceManifest));
fs.writeFileSync(prefix+'-source-manifest.json',JSON.stringify({createdAt:new Date().toISOString(),snapshot,runtimeSha256,files:sourceManifest},null,2)+'\n');
let networkAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw new Error('Network access is forbidden during this frozen local evaluation.');};
const {processSupportMessage}=await import(pathToFileURL(path.join(snapshot,'support-processing.ts')).href);
const routeKeys=['question','help','violation','trash','undetermined'];
const key=value=>value??'undetermined';
const rows=[];
const started=Date.now();
function errorType(expected,actual){
 if(expected===actual)return null;
 if(actual===null)return 'undetermined_instead_of_known_route';
 if(expected===null)return 'resolved_ambiguous_reference';
 if(actual==='violation')return 'false_violation';
 if(actual==='trash')return 'false_trash';
 if(expected==='violation')return 'missed_violation';
 if(expected==='help'&&actual==='question')return 'help_as_question';
 if(expected==='question'&&actual==='help')return 'question_as_help';
 return 'other_route_mismatch';
}
for(const label of labels){
 const after=await processSupportMessage(label.text);
 const p=after.processing,actual=p.route??null;
 if(p.aiReview&&p.aiReview.outcome!=='disabled')throw new Error('AI review appeared in rules-only output.');
 if(p.decisionSource==='ai')throw new Error('AI decision appeared in rules-only output.');
 const disputes=(audit.uncertain_cases??[]).filter(item=>item.scenario_id===label.scenario_id&&(item.text_variant===label.base_text||item.text_variant===label.text));
 const before=previous.get(label.id);
 rows.push({id:label.id,text:label.text,language:label.language,textLanguage:label.text_language,expected:label.expected_route,actual,correct:actual===label.expected_route,
  errorType:errorType(label.expected_route,actual),scenarioId:label.scenario_id,baseId:label.base_id,baseText:label.base_text,noise:label.noise??[],topic:label.topic,referenceReason:label.reason,labelStatus:label.label_status,
  labelDisputed:disputes.length>0,labelDisputes:disputes,previous:{actual:before.actual,correct:before.correct},
  urgency:p.urgency??null,knowledge:p.knowledge??null,after});
 if(rows.length%1000===0){const correct=rows.filter(row=>row.correct).length;console.log(JSON.stringify({done:rows.length,total:10000,correct,seconds:Math.round((Date.now()-started)/1000)}));}
}
if(networkAttempts)throw new Error('Unexpected network access attempted.');
const count=values=>Object.fromEntries([...new Set(values)].sort().map(value=>[key(value),values.filter(v=>v===value).length]));
function score(items){const correct=items.filter(row=>row.correct).length;return {total:items.length,correct,wrong:items.length-correct,accuracy:items.length?correct/items.length:null};}
function groups(field){return Object.fromEntries([...new Set(rows.map(row=>row[field]))].map(value=>[key(value),score(rows.filter(row=>row[field]===value))]));}
const answers=rows.filter(row=>row.knowledge?.status==='answered');
const compared={baseline:previousSummary.run,baselineSource:previousSummary.source,baselineAccuracy:previousSummary.accuracy,
 baselineCorrect:previousSummary.correct,improved:rows.filter(row=>!row.previous.correct&&row.correct).length,regressed:rows.filter(row=>row.previous.correct&&!row.correct).length,
 stillCorrect:rows.filter(row=>row.previous.correct&&row.correct).length,stillWrong:rows.filter(row=>!row.previous.correct&&!row.correct).length,
 changedRoute:rows.filter(row=>row.actual!==row.previous.actual).length};
const historicalComparison={baseline:historicalSummary.run,baselineSource:historicalSummary.source,baselineCorrect:historicalSummary.correct,baselineAccuracy:historicalSummary.accuracy,
 improved:rows.filter(row=>!historical.get(row.id).correct&&row.correct).length,regressed:rows.filter(row=>historical.get(row.id).correct&&!row.correct).length,
 deltaCorrect:score(rows).correct-historicalSummary.correct,deltaPercentagePoints:(score(rows).accuracy-historicalSummary.accuracy)*100,
 byLanguage:Object.fromEntries([...new Set(rows.map(row=>row.language))].map(language=>{const selected=rows.filter(row=>row.language===language),oldCorrect=selected.filter(row=>historical.get(row.id).correct).length;return [language,{...score(selected),previousCorrect:oldCorrect,previousAccuracy:oldCorrect/selected.length,deltaCorrect:score(selected).correct-oldCorrect}];})),
 byExpected:Object.fromEntries([...new Set(rows.map(row=>row.expected))].map(expected=>{const selected=rows.filter(row=>row.expected===expected),oldCorrect=selected.filter(row=>historical.get(row.id).correct).length;return [key(expected),{...score(selected),previousCorrect:oldCorrect,previousAccuracy:oldCorrect/selected.length,deltaCorrect:score(selected).correct-oldCorrect}];})),
};
const groupComparison=field=>Object.fromEntries([...new Set(rows.map(row=>row[field]))].map(value=>{
 const selected=rows.filter(row=>row[field]===value),oldCorrect=selected.filter(row=>row.previous.correct).length;
 const current=score(selected);return [key(value),{...current,previousCorrect:oldCorrect,previousAccuracy:oldCorrect/selected.length,deltaCorrect:current.correct-oldCorrect,deltaPercentagePoints:(current.correct-oldCorrect)/selected.length*100}];
}));
const summary={run:`retest-10000-${stamp}`,createdAt:new Date().toISOString(),source:'frozen-local-processSupportMessage',method:'All original 10000 inputs, no API calls, no HTTP requests, no database writes; identical frozen expected-route labels.',
 datasetPath,datasetSha256,snapshot,runtimeSha256,elapsedSeconds:(Date.now()-started)/1000,networkAttempts,versions:[...new Set(rows.map(row=>row.after.processing.version))],
 ...score(rows),accuracyMetric:'Exact route equality over all 10000, including 337 expected null/undetermined, identical to run-06-final-site.',
 byLanguage:groups('language'),byExpected:groups('expected'),byActual:count(rows.map(row=>row.actual)),byTopic:groups('topic'),
 byNoise:Object.fromEntries([...new Set(rows.flatMap(row=>row.noise))].sort().map(noise=>[noise,score(rows.filter(row=>row.noise.includes(noise)))])),
 errorTypes:count(rows.filter(row=>!row.correct).map(row=>row.errorType)),
 diagnostics:{undetermined:rows.filter(row=>row.actual===null).length,falseViolation:rows.filter(row=>row.expected!=='violation'&&row.actual==='violation').length,falseTrash:rows.filter(row=>row.expected!=='trash'&&row.actual==='trash').length,missedViolation:rows.filter(row=>row.expected==='violation'&&row.actual!=='violation').length,helpAsQuestion:rows.filter(row=>row.expected==='help'&&row.actual==='question').length,questionAsHelp:rows.filter(row=>row.expected==='question'&&row.actual==='help').length},
 matrix:Object.fromEntries(routeKeys.map(expected=>[expected,Object.fromEntries(routeKeys.map(actual=>[actual,rows.filter(row=>key(row.expected)===expected&&key(row.actual)===actual).length]))])),
 comparedToPrevious:{...compared,deltaCorrect:score(rows).correct-previousSummary.correct,deltaPercentagePoints:(score(rows).accuracy-previousSummary.accuracy)*100,byLanguage:groupComparison('language'),byExpected:groupComparison('expected')},
 comparedToHistorical:historicalComparison,
 urgency:{independentLabelsAvailable:false,accuracy:null,distribution:count(rows.map(row=>row.urgency?.level??'not_evaluated')),byEventTime:count(rows.filter(row=>row.urgency).map(row=>row.urgency.eventTime)),uncertain:rows.filter(row=>row.urgency?.uncertain).length,note:'Distribution only: this corpus has no independent urgency labels.'},
 faq:{independentLabelsAvailable:false,accuracy:null,precision:null,statuses:count(rows.map(row=>row.knowledge?.status??'missing')),answered:answers.length,coverage:answers.length/rows.length,answeredByEntry:count(answers.map(row=>row.knowledge.entryId)),answeredWhereReferenceRouteIsNotQuestion:answers.filter(row=>row.expected!=='question').length,note:'Coverage and routing diagnostics only. No independent expected FAQ IDs or answer correctness labels exist for these 10000.'},
 labelProvenance:{statuses:count(labels.map(row=>row.label_status)),scenarios:new Set(labels.map(row=>row.scenario_id)).size,baseTexts:new Set(labels.map(row=>row.base_id)).size,uniqueTexts:new Set(labels.map(row=>row.text)).size,author:'Previously authored by assistant agents; not human-verified.',auditReviewer:audit.reviewer,auditType:audit.audit_type,auditPredictionsSeen:audit.classifier_outputs_seen,auditScenarioCoverage:audit.coverage.scenarios_reviewed,auditBaseVariantCoverage:audit.coverage.text_variants_reviewed,auditTotalBaseVariants:audit.coverage.text_variants_total,disputedReferenceRows:rows.filter(row=>row.labelDisputed).length,disputedReferenceScore:score(rows.filter(row=>row.labelDisputed)),disputedBoundaries:audit.uncertain_cases,limitations:audit.limitations,knownDataset:true},
 files:{rows:prefix+'-rows.jsonl',errors:prefix+'-errors.jsonl',changes:prefix+'-changes.jsonl',summary:prefix+'-summary.json',sourceManifest:prefix+'-source-manifest.json'},
};
for(const [name,items] of [['rows',rows],['errors',rows.filter(row=>!row.correct)],['changes',rows.filter(row=>row.previous.actual!==row.actual)]])fs.writeFileSync(`${prefix}-${name}.jsonl`,items.map(row=>JSON.stringify(row)).join('\n')+'\n');
fs.writeFileSync(prefix+'-summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({summary:summary.files.summary,total:summary.total,correct:summary.correct,wrong:summary.wrong,accuracy:summary.accuracy,comparedToPrevious:summary.comparedToPrevious,diagnostics:summary.diagnostics,faq:summary.faq,urgency:summary.urgency,labelDisputes:summary.labelProvenance.disputedReferenceRows},null,2));
