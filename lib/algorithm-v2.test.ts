import assert from "node:assert/strict";
import { test } from "node:test";
import { processMessageWithTrace as process } from "./message-processing.ts";
import { parseFeedback } from "./feedback.ts";
import { validateDataset } from "../scripts/ml/dataset.mjs";

const intents = [
  ["130дм", "Жалоба на игрока"], ["76дб", "Жалоба на игрока"],
  ["Покажи фрапс на мой ДМ", "Обжалование наказания"],
  ["Где я софтер? Это баг, почему варн?", "Обжалование наказания"],
  ["Измените мне ник у меня нон рп ник", "Помощь в игре"],
  ["Достанти моюмашину из воды", "Помощь в игре"],
  ["какой пункт надо указывать при жалобе на ДБ", "Вопрос по игре"],
  ["за упом родни бан или мут?", "Вопрос по игре"],
  ["у меня пропала квартира я ее не продавал", "Аккаунт и имущество"],
  ["noqonuniy bloklash", "Обжалование наказания"],
];
for (const [input, topic] of intents) test(`v2 intent: ${input}`, () => assert.equal(process(input).processing.topic, topic));
test("ID segmentation leaves evidence, handles and identifiers unchanged", () => {
  assert.equal(process("130дм").text, "130 ДМ");
  for (const text of ['«130дм»','/130дм','https://example.com/130дм','@130дм','Alex_130дм','AB130дм','dm130']) assert.equal(process(text).text,text);
});
test("Uzbek particle db is not a new drive-by allegation", () => {
  const result = process("qaysi qoidada spawn bers kere db etgan?");
  assert.doesNotMatch(result.text, /ДБ/);
  assert.match(result.processing.steps.find(s => s.id === "understood")!.value, /сказал/);
});
for (const text of ["Пошли вы нахуй", "адм пидр", "ты пиздаболка", "я вашу мать ебал", "сын шлюхи"]) test(`v2 authored abuse: ${text}`, () => {
  const result = process(text);
  assert.equal(result.status, "violation");
  assert.deepEqual(result.processing.steps.map(s=>s.id), ["received", "classified", "routed"]);
  assert.equal(result.processing.model, undefined);
});
for (const text of ['Мне написали: «я вашу мать ебал»', 'Он написал пошли вы нахуй', 'Ты не пидор', 'Мне дали бан за слова сын шлюхи']) test(`v2 reported abuse: ${text}`, () => assert.notEqual(process(text).status,"violation"));
test("feedback validates labels and text limits without approving examples", () => {
  const input = { messageId:"11111111-1111-4111-8111-111111111111",label:"help",note:"  пример  " };
  assert.equal(parseFeedback(input)?.note,"пример");
  assert.equal(parseFeedback({...input,label:"__proto__"}),null);
  assert.equal(parseFeedback({...input,correctedText:"a".repeat(2001)}),null);
  assert.equal(parseFeedback({...input,note:12}),null);
});
test("training excludes proposed, provisional and test rows by default", () => {
  const rows = ["approved","provisional","proposed"].map((reviewStatus,i)=>({id:String(i),text:`обращение ${i}`,label:"help",split:"train",reviewStatus}));
  assert.equal(validateDataset(rows).length,1);
  assert.equal(validateDataset(rows,true).length,2);
  assert.equal(validateDataset([{...rows[0],split:"test"}]).length,0);
});
test("training refuses text leakage and conflicting labels", () => {
  const base={id:"1",text:"ДМ у магазина",label:"player",split:"train",reviewStatus:"approved"};
  assert.throws(()=>validateDataset([base,{...base,id:"2",text:"дм у магазина!",split:"test"}]),/crosses/);
  assert.throws(()=>validateDataset([base,{...base,id:"2",label:"help"}]),/conflicting/);
});
test("rule numbers do not break the scope of reported speech", () => {
  assert.notEqual(process("прочитайте чат там написано шли 1.1 спины еблан это означает дуэль и потом он позвал администратора").status,"violation");
  assert.equal(process("админ тп баг").processing.topic,"Помощь в игре");
});
