import fs from 'node:fs';
import { modelInfo } from '../../lib/intent-model.ts';
import { PROCESSOR_VERSION } from '../../lib/message-processing.ts';
const [freshFile,regressionFile]=process.argv.slice(2);
if(!freshFile||!regressionFile)throw Error('Usage: node scripts/ml/publish-report.mjs fresh-report.json regression-report.json');
const fresh=JSON.parse(fs.readFileSync(freshFile,'utf8')).summary;
const regression=JSON.parse(fs.readFileSync(regressionFile,'utf8')).summary;
for(const report of [fresh,regression])if(report.modelVersion!==modelInfo.version||report.processorVersion!==PROCESSOR_VERSION)throw Error('Report does not match current processor/model');
// Publish aggregate counts only; never publish source tickets or reviewed text.
fs.writeFileSync(new URL('../../lib/models/quality-summary.json',import.meta.url),JSON.stringify({generatedAt:new Date().toISOString(),model:modelInfo,fresh,regression},null,2));
console.log('Saved aggregate quality report; source messages remain local');
