import {test} from "node:test";
import assert from "node:assert/strict";
import {useClarification} from "./clarification-routing.ts";
import {routeMessage} from "./message-routing.ts";
const decision=(text:string)=>routeMessage(text,text,text);
test("a follow-up question does not erase the parent's request for intervention",()=>{
  const result=useClarification(decision("Как подать жалобу?"),{parentId:"parent",answerText:"Как подать жалобу?",parentRoute:"help",requestedDetails:["player"]});
  assert.equal(result.route,"help");
});
test("clarifying a term can establish an information request",()=>{
  const result=useClarification(decision("ДМ"),{parentId:"parent",answerText:"Объясните значение",parentRoute:null,requestedDetails:["purpose"]});
  assert.equal(result.route,"question");
});
test("a yes or no answer does not resolve an either/or purpose question",()=>{
  const result=useClarification(decision("ДМ"),{parentId:"parent",answerText:"да",parentRoute:null,requestedDetails:["purpose"]});
  assert.equal(result.route,null);
});
test("legacy contexts do not silently invent a parent route",()=>{
  assert.equal(useClarification(decision("ДМ"),{parentId:"parent",answerText:"143"}).route,null);
});
