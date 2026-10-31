import {test} from "node:test";
import assert from "node:assert/strict";
import {routeMessage} from "./message-routing.ts";
import {clarifyDecision, referencedPlayer} from "./message-details.ts";
import {correctText} from "./text-correction.ts";
import {understandMessage} from "./message-understanding.ts";
const decide=(input:string)=>{const corrected=correctText(input),understood=understandMessage(corrected).text;return clarifyDecision(input,understood,routeMessage(input,corrected,understood));};
test("help route survives a missing problem description",()=>{
 const result=decide("Помощь");assert.equal(result.route,"help");assert.equal(result.needsClarification,true);assert.deepEqual(result.missingDetails,["problem"]);
});
test("asking about a known definition does not demand incident evidence",()=>{
 const result=decide("Что такое ДМ?");assert.equal(result.route,"question");assert.equal(result.followUp,undefined);
});
test("an ID plus an incident does not request the same ID again",()=>{
 assert.equal(decide("143 ДМ").needsClarification,false);
 assert.equal(decide("ДМ\nУточнение: 143").needsClarification,false);
});
test("punishment durations, rule numbers and URL digits are not player IDs",()=>{
 for(const text of ["мут 30 минут", "оск 2.1", "дм https://example.com/143", "дм /report143"])assert.equal(referencedPlayer(text),false,text);
 assert.equal(referencedPlayer("игрок 143 ДМ"),true);
});
test("ask only for the missing useful fact",()=>{
 const result=decide("Вытащите мою машину из воды");assert.equal(result.route,"help");assert.equal(result.followUp,"Где находится транспорт?");
 const appeal=decide("Мне выдали бан за ДМ, прошу пересмотреть наказание");assert.equal(appeal.followUp,undefined);
});
test("a quote can name a definition subject without becoming the author's statement",()=>{
 assert.equal(decide('Что значит «DB»?').needsClarification,false);
});
test("noise does not supply a missing problem or object",()=>{
 for(const text of ["help xaxax","пхахахха помогите)","Ну сними пж(","Я хочу пожаловаться на игрока Alex_Test24","Спек пж"])assert.equal(decide(text).needsClarification,true,text);
});
test("an account of the incident or a link can already permit review",()=>{
 for(const text of ["Я вышел из машины и игрок меня убил","https://game.test/proof ДМ"])assert.equal(decide(text).needsClarification,false,text);
});
