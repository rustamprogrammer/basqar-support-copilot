import assert from "node:assert/strict";
import {test} from "node:test";
import {normalizeInputScripts} from "./input-script-normalization.ts";

const normal = (text: string) => normalizeInputScripts(text).text;

test("restores dictionary words from whole and partial keyboard mistakes", () => {
  for (const [source,target] of [
    ["Ult ghjxbnfnm ghfdbkf?", "Где прочитать правила?"],
    ["Где можно gjcvjnhtnm правила?", "Где можно посмотреть правила?"],
    ["Қfqlf rөvtr?", "Қайда көмек?"],
    ["Де можна gthtdshbnb завдання?", "Де можна перевірити завдання?"],
    ["Йфнуквфт нщквфь?", "Qayerdan yordam?"],
  ]) assert.equal(normal(source),target,source);
});

test("transliterated intent anchors retain their language and negation", () => {
  for (const [source,target] of [
    ["Gde prochitat pravila?", "Где прочитать правила?"],
    ["Yak vidnoviti dostup?", "Як відновити доступ?"],
    ["Qayda komek?", "Қайда көмек?"],
    ["Шикоят ёрдам беринг", "Shikoyat yordam bering"],
    ["ya ne ubival", "я не убивал"],
  ]) assert.equal(normal(source),target,source);
});

test("repair only distinctive one-letter errors in long reviewed words", () => {
  for (const [source,target] of [
    ["Помогте првоерьте парооль", "Помогите проверьте пароль"],
    ["Де подивтися правила?", "Де подивитися правила?"],
    ["тексеріңіздр көмеектесіңіздер", "тексеріңіздер көмектесіңіздер"],
    ["Qayerdan yrdam olish mumkin?", "Qayerdan yordam olish mumkin?"],
    ["пооомогите", "помогите"],
  ]) assert.equal(normal(source),target,source);
});

test("known mixed-script and invisible-letter errors are explainable", () => {
  for (const [source,target] of [
    ["админ, я не пиcал это", "админ, я не писал это"],
    ["yоrdam bеring", "yordam bering"],
    ["помо\u200bгите", "помогите"],
    ["тексе\u200dріңіздер", "тексеріңіздер"],
  ]) {
    const result=normalizeInputScripts(source);
    assert.equal(result.text,target,source);
    assert.ok(result.changes.length>0);
  }
});

test("spacing repair uses complete known words and an intent anchor", () => {
  for (const [source,target] of [
    ["Помогитепроверитьаккаунт", "Помогите проверить аккаунт"],
    ["помогитепожалуйста", "помогите пожалуйста"],
    ["yordambering", "yordam bering"],
    ["Ад мин, помо гите", "Админ, помогите"],
    ["Де поди витися?", "Де подивитися?"],
  ]) assert.equal(normal(source),target,source);
  for (const source of ["не могу", "не потрібно", "не можу", "керек емес", "yo'q emas", "можно ли", "не только"]) {
    assert.equal(normal(source),source,source);
  }
});

test("never guess foreign negation, suffixes, names or arbitrary unseen vocabulary", () => {
  for (const source of [
    "oldirmasamchi", "boglamasangiz", "өлтірмесем", "допомоглибиxyz", "xqzyr",
    "qaysi qoidada db etgan", "on ne ty he no men man", "my admin is not an idiot",
    "English prochitat on the server", "пoмoгитeMax Неизвeстнoe", "помогитепроверитьБлабла",
    "мен o'ldirmadim", "he said no, help me on the server", "DM DB RP AFK",
    "Не могу зайти, появляется ошибка подключения", "непочините",
    "выйти из здания", "он назвал меня", "келмеді шықпады", "купив машину",
    "транспорт пропал и платное получение не сработало", "Де почитати правила?",
  ]) assert.equal(normal(source),source,source);
});

test("evidence and identifiers survive every new normalization stage", () => {
  const source='«Помогте првоерьте» "yоrdam" \'пооомогите\' `ghfdbkf` @пооомогите /nick yоrdam https://g.test/пооомогите Alex_пооомогите nick=пооомогите ник првоерьте 42првоерьте';
  assert.equal(normal(source),source);
  assert.equal(normal('Првоерьте «пооомогите»'), 'Проверьте «пооомогите»');
});

test("language evidence is local and normalization stabilizes after one pass", () => {
  assert.equal(normal("правила. English prochitat"),"правила. English prochitat");
  assert.equal(normal("правила\nEnglish prochitat"),"правила\nEnglish prochitat");
  for (const source of ["Gde prochitat pravila?", "yоrdam bеring", "помогитепожалуйста", "Қfqlf rөvtr?"] ) {
    const once=normal(source);
    assert.equal(normal(once),once,source);
  }
});
