import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=process.argv[2];
if(!directory)throw new Error('Usage: node scripts/routing-publish.mjs artifact-directory');
const index=JSON.parse(fs.readFileSync(path.join(directory,'stage-index.json'),'utf8'));
const compact=name=>{
 const report=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
 if(report.model.enabled||report.model.used!==0)throw new Error('Expected rules-only report');
 return {stage:report.stage,processorVersion:report.processorVersion,datasetSha256:report.datasetSha256,
  labelStatus:report.labelStatus,humanReviewed:report.humanReviewed,summary:report.summary,comparison:report.comparison};
};
const stages=index.stages.map(stage=>({...stage,report:compact(stage.file)}));
if(new Set(stages.map(s=>s.report.datasetSha256)).size!==1)throw new Error('Stage datasets differ');
const fresh=index.fresh?{baseline:compact(index.fresh.baseline),final:compact(index.fresh.final)}:null;
const retest=index.retest?compact(index.retest):null;
if(fresh && fresh.baseline.datasetSha256!==fresh.final.datasetSha256)throw new Error('Fresh datasets differ');
if(retest && (!fresh || retest.datasetSha256!==fresh.final.datasetSha256 || retest.comparison?.baseline!==fresh.final.stage))throw new Error('Retest must compare the same dataset against the first blind report');
if(index.followUps!==undefined && !Array.isArray(index.followUps))throw new Error('Expected a followUps array');
const followUps=(index.followUps??[]).map(entry=>{
 if(!entry || typeof entry.title!=='string' || !entry.title.trim() || typeof entry.baseline!=='string' || typeof entry.final!=='string')throw new Error('Invalid follow-up entry');
 const baseline=compact(entry.baseline), final=compact(entry.final);
 if(typeof baseline.datasetSha256!=='string' || !/^[0-9a-f]{64}$/i.test(baseline.datasetSha256) || baseline.datasetSha256!==final.datasetSha256)throw new Error('Follow-up datasets differ');
 if(typeof baseline.stage!=='string' || !baseline.stage || final.comparison?.baseline!==baseline.stage)throw new Error('Follow-up must compare against its baseline stage');
 return {title:entry.title,baseline,final};
});
const result={generatedAt:new Date().toISOString(),schema:'purpose-v1',stages,
 fresh,retest,
 regression:index.regression?compact(index.regression):null,
 ...(followUps.length?{followUps}:{})};
fs.writeFileSync(fileURLToPath(new URL('../lib/routing-quality-summary.json',import.meta.url)),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({stages:stages.length,fresh:!!result.fresh,retest:!!result.retest,followUps:followUps.length,onlyAggregates:true}));
