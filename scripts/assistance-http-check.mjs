import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=process.env.BASE_URL;
const password=process.env.TEST_ADMIN_PASSWORD;
if(!target)throw new Error('Explicit BASE_URL is required. Secure mode additionally requires TEST_ADMIN_PASSWORD.');
const base=new URL(target);
if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||!base.port||Number(base.port)<1024||base.port==='8787'||base.username||base.password||base.search||base.hash||base.pathname!=='/'){
 throw new Error('Refusing target: use an explicit isolated HTTP loopback port, never port 8787.');
}
const output=path.resolve(process.env.TEST_OUTPUT_DIR??path.resolve(root,'..','artifacts','assistance-20261031'));
if(output===root||output.startsWith(root+path.sep))throw new Error('TEST_OUTPUT_DIR must be outside the repository.');
const runId=randomUUID();
const fixtureIds=new Set();
const checks=[];
const nonJsonReports=[];
const allCookieJars=[];
let adminReady=false;
let publicDemo=false;
let fixtureEntry;
let cleanup={messagesDeleted:0,knowledgeRetired:false};

function client(){
 const cookies=new Map();
 allCookieJars.push(cookies);
 return {
  cookies,
  async request(resource,method='GET',body){
   const headers={};
   if(cookies.size)headers.Cookie=[...cookies].map(([key,value])=>`${key}=${value}`).join('; ');
   if(body!==undefined)headers['Content-Type']='application/json';
   const response=await fetch(new URL(resource,base),{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
   for(const raw of response.headers.getSetCookie()){
    const pair=raw.split(';',1)[0];const index=pair.indexOf('=');
    if(index>0){const key=pair.slice(0,index),value=pair.slice(index+1);if(value)cookies.set(key,value);else cookies.delete(key);}
   }
   const text=await response.text();
   let data;try{data=JSON.parse(text);}catch{
    let safe=password?text.split(password).join('[redacted-password]'):text;
    for(const jar of allCookieJars)for(const value of jar.values())safe=safe.split(value).join('[redacted-cookie]');
    await mkdir(output,{recursive:true});
    const errorPath=path.join(output,`http-nonjson-${runId}-${nonJsonReports.length+1}.txt`);
    await writeFile(errorPath,safe);nonJsonReports.push({method,resource,status:response.status,path:errorPath});
    throw new Error(`${method} ${resource}: non-JSON HTTP ${response.status}; body saved: ${errorPath}; ${safe.replace(/\s+/gu,' ').slice(0,350)}`);
   }
   return {status:response.status,data};
  },
 };
}
const userA=client(),userB=client(),admin=client();
async function check(name,fn){
 const started=Date.now();
 try{await fn();checks.push({name,passed:true,durationMs:Date.now()-started});}
 catch(error){checks.push({name,passed:false,durationMs:Date.now()-started,error:String(error.message)});throw error;}
}
function noOwner(row){assert.equal(Object.hasOwn(row,'ownerHash'),false,'Owner hash must not be exposed');}
async function list(session,resource='/api/messages'){
 const response=await session.request(resource);assert.equal(response.status,200);assert.ok(Array.isArray(response.data));response.data.forEach(noOwner);return response.data;
}
async function submit(session,text,parentId){
 const id=randomUUID();fixtureIds.add(id);
 let response=await session.request('/api/messages','POST',{id,text,...(parentId?{parentId}:{})});
 if(response.status===409&&response.data.code==='session_required')response=await session.request('/api/messages','POST',{id,text,...(parentId?{parentId}:{})});
 assert.equal(response.status,201,`Submission failed: ${response.data.error??response.status}`);
 assert.equal(response.data.id,id,'A fresh fixture must keep its UUID');noOwner(response.data);return response.data;
}
async function service(session,row,action,extra={}){
 const response=await session.request('/api/service','POST',{id:row.id,revision:row.service.revision,action,...extra});
 assert.equal(response.status,200,`Service ${action} failed: ${response.data.error??response.status}`);noOwner(response.data);
 assert.equal(response.data.service.revision,row.service.revision+1);return response.data;
}
let faq,help,unknown,child;
let initialIds=new Set();

try{
 await check('rules-only health',async()=>{
  const response=await admin.request('/api/health');assert.equal(response.status,200);assert.equal(response.data.ok,true);
  assert.equal(response.data.processingMode,'rules');assert.equal(response.data.aiReviewEnabled,false);assert.equal(response.data.adminConfigured,true);
  publicDemo=response.data.publicDemo===true;
  if(!publicDemo&&(!password||password.length<20))throw new Error('Secure mode requires explicit TEST_ADMIN_PASSWORD (20+ characters).');
 });
 await check('admin authentication and protected scope',async()=>{
  assert.equal((await userA.request('/api/messages?scope=admin')).status,publicDemo?200:401);
  assert.equal((await userA.request('/api/knowledge')).status,publicDemo?200:401);
  const login=await admin.request('/api/admin','POST',publicDemo?{}:{password});assert.equal(login.status,200);assert.equal(login.data.authenticated,true);adminReady=true;
  const state=await admin.request('/api/admin');assert.equal(state.data.authenticated,true);
  assert.equal(state.data.publicDemo,publicDemo);
  if(publicDemo){
   const anonymous=await userB.request('/api/admin');assert.equal(anonymous.data.authenticated,true);assert.equal(anonymous.data.publicDemo,true);
   const logout=await admin.request('/api/admin','DELETE',{});assert.equal(logout.status,200);assert.equal(logout.data.publicDemo,true);
   assert.equal((await admin.request('/api/admin')).data.authenticated,true);
  }
  initialIds=new Set((await list(admin,'/api/messages?scope=admin')).map(row=>row.id));
 });
 await check('first POST establishes session without inserting',async()=>{
  const id=randomUUID();fixtureIds.add(id);
  const response=await userA.request('/api/messages','POST',{id,text:'Что такое ДМ?'});
  assert.equal(response.status,409);assert.equal(response.data.code,'session_required');assert.ok(userA.cookies.has('support_visitor'));
  assert.equal((await list(admin,`/api/messages?scope=admin&id=${id}`)).length,0);
  const retry=await userA.request('/api/messages','POST',{id,text:'Что такое ДМ?'});
  assert.equal(retry.status,201);assert.equal(retry.data.id,id);faq=retry.data;noOwner(faq);
  const again=await userA.request('/api/messages','POST',{id,text:'Что такое ДМ?'});
  assert.equal(again.status,201);assert.equal(again.data.id,id);
  assert.equal((await list(admin,`/api/messages?scope=admin&id=${id}`)).length,1);
 });
 await check('FAQ supplies approved DM definition',async()=>{
  assert.equal(faq.processing.route,'question');assert.equal(faq.processing.knowledge.status,'answered');assert.equal(faq.processing.knowledge.entryId,'faq-dm');
  assert.equal(faq.service.state,'answered');assert.equal(faq.service.reply.author,'knowledge');assert.ok(faq.service.reply.text.length>20);
 });
 await check('active attack gets immediate help priority',async()=>{
  help=await submit(userA,'Меня сейчас бьют, помогите');
  assert.equal(help.processing.route,'help');assert.equal(help.processing.urgency.level,'now');assert.equal(help.service.state,'queued');
  assert.ok(help.processing.followUp,'This fixture must offer clarification');
 });
 await check('unknown FAQ is queued for administrator',async()=>{
  unknown=await submit(userB,'Где выключить только голосовой чат, чтобы звук двигателя остался?');
  assert.equal(unknown.processing.route,'question');assert.equal(unknown.processing.knowledge.status,'needs_admin');assert.equal(unknown.service.state,'queued');
 });
 await check('message access follows demo or secure mode',async()=>{
  assert.equal((await list(userB,`/api/messages?id=${faq.id}`)).length,publicDemo?1:0);
  assert.equal((await list(userA,`/api/messages?id=${unknown.id}`)).length,publicDemo?1:0);
  const rowsA=await list(userA),rowsB=await list(userB),rowsAdmin=await list(admin,'/api/messages?scope=admin');
  assert.ok(rowsA.some(row=>row.id===faq.id));assert.equal(rowsA.some(row=>row.id===unknown.id),publicDemo);
  assert.ok(rowsB.some(row=>row.id===unknown.id));assert.equal(rowsB.some(row=>row.id===help.id),publicDemo);
  assert.ok(rowsAdmin.some(row=>row.id===faq.id)&&rowsAdmin.some(row=>row.id===unknown.id));
  if(publicDemo){
   help=await service(userB,help,'claim');help=await service(userA,help,'release');
   const patch=await userA.request('/api/messages','PATCH',{id:help.id,status:'pending',revision:help.service.revision});assert.equal(patch.status,200);help=patch.data;
  }else{
   assert.equal((await userB.request('/api/service','POST',{id:help.id,revision:help.service.revision,action:'need_admin'})).status,404);
   const claim=await userA.request('/api/service','POST',{id:help.id,revision:help.service.revision,action:'claim'});assert.ok([400,401,403].includes(claim.status));
   const patch=await userA.request('/api/messages','PATCH',{id:help.id,status:'accepted'});assert.equal(patch.status,401);
  }
 });
 await check('inbox access mode, filters and server pagination',async()=>{
  assert.equal((await userA.request('/api/inbox')).status,publicDemo?200:401);
  const result=await admin.request(`/api/inbox?category=help&workflow=pending&urgency=now&q=${help.id}&page=99&pageSize=2`);
  assert.equal(result.status,200);assert.equal(result.data.total,1);assert.equal(result.data.page,1);assert.equal(result.data.pageCount,1);assert.equal(result.data.pageSize,2);
  assert.deepEqual(result.data.items.map(row=>row.id),[help.id]);result.data.items.forEach(noOwner);
  assert.deepEqual(result.data.counts,{all:1,question:0,help:1,undetermined:0,violation:0,trash:0});
  assert.ok(result.data.allCount>=initialIds.size+3);
  const filtered=await admin.request(`/api/inbox?category=question&workflow=pending&q=${help.id}&pageSize=999`);
  assert.equal(filtered.status,200);assert.equal(filtered.data.total,0);assert.equal(filtered.data.counts.help,1);assert.equal(filtered.data.pageSize,50);assert.deepEqual(filtered.data.items,[]);
  const urgency=await admin.request(`/api/inbox?category=help&workflow=pending&urgency=normal&q=${help.id}`);
  assert.equal(urgency.status,200);assert.equal(urgency.data.total,0);assert.equal(urgency.data.counts.help,1);
 });
 await check('ID snapshots and lightweight selectors follow access mode',async()=>{
  assert.equal((await userA.request('/api/messages?idsOnly=true')).status,publicDemo?200:401);
  const snapshot=await admin.request('/api/messages?scope=admin&idsOnly=true');
  assert.equal(snapshot.status,200);assert.deepEqual(Object.keys(snapshot.data),['ids']);
  for(const id of [faq.id,help.id,unknown.id,...initialIds])assert.ok(snapshot.data.ids.includes(id));
  const own=await userA.request(`/api/messages?view=selector&q=${help.id}`);assert.equal(own.status,200);assert.equal(own.data.length,1);
  assert.deepEqual(Object.keys(own.data[0]).sort(),['createdAt','id','originalText','processing','text']);
  assert.deepEqual(Object.keys(own.data[0].processing).sort(),['context','route']);
  const other=await userA.request(`/api/messages?view=selector&q=${unknown.id}`);assert.equal(other.status,200);assert.equal(other.data.length,publicDemo?1:0);
  const adminOther=await admin.request(`/api/messages?view=selector&q=${unknown.id}`);assert.equal(adminOther.status,200);assert.equal(adminOther.data[0].id,unknown.id);
  const limited=await userA.request('/api/messages?view=selector&limit=1');assert.equal(limited.status,200);assert.equal(limited.data.length,1);
 });
 await check('claim uses revision CAS',async()=>{
  const previous=help;help=await service(admin,help,'claim');assert.equal(help.service.state,'in_progress');
  assert.equal((await admin.request('/api/service','POST',{id:help.id,revision:previous.service.revision,action:'claim'})).status,409);
 });
 await check('administrator can set explicit manual priority',async()=>{
  help=await service(admin,help,'priority',{level:'high',reason:'Синтетическая проверка ручного приоритета.'});
  assert.equal(help.service.manualUrgency,'high');assert.match(help.service.manualReason,/проверка/u);
 });
 await check('reply is visible to owner and feedback updates case',async()=>{
  const reply=`Тестовый ответ администратора ${runId}. Уточните место события.`;
  help=await service(admin,help,'reply',{text:reply});assert.equal(help.service.reply.author,'admin');assert.equal(help.service.state,'answered');
  const [visible]=await list(userA,`/api/messages?id=${help.id}`);assert.equal(visible.service.reply.text,reply);
  help=await service(userA,help,'helped');assert.equal(help.status,'accepted');assert.equal(help.service.state,'resolved');
  help=await service(userA,help,'need_admin');assert.equal(help.status,'pending');assert.equal(help.service.state,'queued');assert.equal(help.service.reply.text,reply);
 });
 await check('clarification preserves case history and manual priority',async()=>{
  const previous=help;child=await submit(userA,'Он уже ушёл, нападение закончилось.',help.id);
  assert.equal(child.service.caseId,previous.service.caseId);assert.equal(child.service.firstReceivedAt,previous.service.firstReceivedAt);
  assert.equal(child.service.manualUrgency,'high');assert.equal(child.service.manualReason,previous.service.manualReason);
  assert.ok(child.service.history.length>previous.service.history.length);
  for(const action of ['claim','priority','reply','helped','need_admin'])assert.ok(child.service.history.some(event=>event.action===action),`History lost ${action}`);
  const stale=await admin.request('/api/service','POST',{id:previous.id,revision:previous.service.revision,action:'claim'});
  assert.equal(stale.status,409);assert.equal(stale.data.latestId,child.id);
 });
 await check('terminal clarification can be restored without reopening its old parent',async()=>{
  for(const status of ['trash','violation']){
   const terminal=await admin.request('/api/messages','PATCH',{id:child.id,status,revision:child.service.revision});
   assert.equal(terminal.status,200,`Cannot mark clarification ${status}`);child=terminal.data;
   const restored=await admin.request('/api/messages','PATCH',{id:child.id,status:'pending',revision:child.service.revision});
   assert.equal(restored.status,200,`Cannot restore ${status} clarification`);child=restored.data;
   assert.equal(child.status,'pending');assert.equal(child.service.caseId,help.service.caseId);
   assert.equal(child.service.manualUrgency,'high');
   const stale=await admin.request('/api/messages','PATCH',{id:help.id,status:'accepted',revision:help.service.revision});
   assert.equal(stale.status,409);assert.equal(stale.data.latestId,child.id);
  }
 });
 await check('knowledge draft, confirmation and version CAS',async()=>{
  const suffix=runId.replaceAll('-','').slice(0,10);
  const entry={id:`http-fixture-${suffix}`,title:'Тестокод',answer:'Тестокод — синтетический термин из изолированной проверки HTTP.',aliases:['тестокод'],requiredTerms:[],excludedTerms:[],status:'draft',questionKind:'definition',source:{title:'Изолированная синтетическая проверка',version:runId}};
  let response=await admin.request('/api/knowledge','POST',{entry,expectedVersion:null});assert.equal(response.status,200);fixtureEntry=response.data;
  assert.equal(fixtureEntry.status,'draft');assert.ok(fixtureEntry.version);
  const draftQuestion=await submit(userA,'Что такое тестокод?');assert.notEqual(draftQuestion.processing.knowledge.status,'answered');
  const draftVersion=fixtureEntry.version;
  const unconfirmed=await admin.request('/api/knowledge','POST',{entry:{...fixtureEntry,status:'published'},expectedVersion:draftVersion});assert.equal(unconfirmed.status,400);
  response=await admin.request('/api/knowledge','POST',{entry:{...fixtureEntry,status:'published'},confirmed:true,expectedVersion:draftVersion});assert.equal(response.status,200);fixtureEntry=response.data;
  assert.equal(fixtureEntry.status,'published');assert.notEqual(fixtureEntry.version,draftVersion);
  const stale=await admin.request('/api/knowledge','POST',{entry:{...fixtureEntry,answer:'Устаревшее изменение.'},confirmed:true,expectedVersion:draftVersion});assert.equal(stale.status,409);
  const overwrite=await admin.request('/api/knowledge','POST',{entry,expectedVersion:null});assert.equal(overwrite.status,409);
  const entries=await admin.request('/api/knowledge');assert.equal(entries.status,200);assert.equal(entries.data.find(item=>item.id===entry.id).answer,fixtureEntry.answer);
 });
 await check('published fixture card can answer a new question',async()=>{
  const answered=await submit(userA,'Что означает тестокод?');
  assert.equal(answered.processing.route,'question');assert.equal(answered.processing.knowledge.status,'answered');assert.equal(answered.processing.knowledge.entryId,fixtureEntry.id);
  assert.equal(answered.service.reply.text,fixtureEntry.answer);assert.equal(answered.service.reply.entryVersion,fixtureEntry.version);
 });
}catch(error){
 process.exitCode=1;
 if(!checks.some(item=>!item.passed))checks.push({name:'unexpected failure',passed:false,error:String(error.message)});
}finally{
 if(adminReady){
  try{
   if(fixtureEntry){
    const retired=await admin.request('/api/knowledge','POST',{entry:{...fixtureEntry,status:'retired'},expectedVersion:fixtureEntry.version});
    assert.equal(retired.status,200);cleanup.knowledgeRetired=true;
   }
   const before=await list(admin,'/api/messages?scope=admin');
   const snapshot=before.filter(row=>fixtureIds.has(row.id)).map(row=>row.id);
   if(snapshot.length){
    const deleted=await admin.request('/api/messages','DELETE',{confirmation:'clear-messages',ids:snapshot});
    assert.equal(deleted.status,200);assert.equal(deleted.data.deletedCount,snapshot.length);cleanup.messagesDeleted=deleted.data.deletedCount;
   }
   const after=await list(admin,'/api/messages?scope=admin');
   assert.equal(after.some(row=>fixtureIds.has(row.id)),false,'Fixture cleanup left messages');
   for(const id of initialIds)assert.ok(after.some(row=>row.id===id),'Cleanup must preserve all pre-existing messages');
   checks.push({name:'cleanup only synthetic fixture IDs',passed:true});
  }catch(error){checks.push({name:'fixture cleanup',passed:false,error:String(error.message)});process.exitCode=1;}
 }
 const report={runId,createdAt:new Date().toISOString(),baseUrl:base.origin,publicDemo,checks,passed:checks.filter(item=>item.passed).length,failed:checks.filter(item=>!item.passed).length,cleanup,fixtureIds:[...fixtureIds],nonJsonReports};
 await mkdir(output,{recursive:true});const reportPath=path.join(output,`http-check-${runId}.json`);await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,failed:report.failed,failedChecks:checks.filter(item=>!item.passed).map(item=>({name:item.name,error:item.error})),report:reportPath,cleanup},null,2));
}
