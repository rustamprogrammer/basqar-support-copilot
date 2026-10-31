import {test} from "node:test";
import assert from "node:assert/strict";
import {processingRoute, messageRoute} from "./message-routes.ts";
import type {ProcessingTrace} from "./message-types.ts";
const trace=(classification:ProcessingTrace["classification"],topic?:string):ProcessingTrace=>({classification,topic,steps:[]});
test("historical report adapts without rewriting its topic",()=>{
  const old=trace("report","Обжалование наказания");
  assert.equal(processingRoute(old),"help");
  assert.equal(old.topic,"Обжалование наказания");
  assert.equal(processingRoute(trace("report","Вопрос по игре")),"question");
});
test("explicit uncertainty cannot inherit a confident legacy topic",()=>{
  assert.equal(processingRoute({...trace("report","Вопрос по игре"),route:null}),null);
});
test("manual disposition overrides automatic routing",()=>{
  assert.equal(messageRoute({status:"violation",processing:{...trace("report"),route:"help"}}),"violation");
  assert.equal(messageRoute({status:"pending",processing:trace("violation")}),null);
  assert.equal(messageRoute({status:"accepted",processing:trace("violation")}),null);
  assert.equal(messageRoute({status:"accepted",processing:trace("trash")}),null);
  assert.equal(messageRoute({status:"accepted",processing:{...trace("report"),route:"question"}}),"question");
});
