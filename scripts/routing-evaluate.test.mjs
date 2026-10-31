import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeOf,summarize} from './routing-evaluate.mjs';
test('legacy adaptation does not treat clarification as successful help',()=>{
  assert.equal(routeOf({classification:'clarify'}),null);
  assert.equal(routeOf({classification:'report',topic:'Обжалование наказания'}),'help');
  assert.equal(routeOf({classification:'report',topic:'Вопрос по игре',route:null}),null);
});
test('reports dangerous routes, abstentions and ambiguous terminal decisions separately',()=>{
 const row=(expectedRoute,actualRoute,assessment)=>({expectedRoute,actualRoute,assessment,needsClarification:null});
 const stats=summarize([row('help','question','wrong'),row('help',null,'abstained'),row('question','question','correct'),row(null,'violation','ambiguous')]);
 assert.equal(stats.correct,1);assert.equal(stats.wrong,1);assert.equal(stats.abstained,1);assert.equal(stats.ambiguous,1);
 assert.equal(stats.helpAsQuestion,1);assert.equal(stats.ambiguousTerminal,1);
 assert.equal(stats.routeAccuracy,1/3);assert.equal(stats.coverage,2/3);assert.equal(stats.decisionPrecision,.5);
 assert.equal(stats.matrix.help.undetermined,1);
});
