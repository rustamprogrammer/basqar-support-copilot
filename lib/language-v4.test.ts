import assert from "node:assert/strict";
import { test } from "node:test";
import { correctText } from "./text-correction.ts";
import { separateIdAction } from "./game-language.ts";
import { understandMessage } from "./message-understanding.ts";
import { processMessageWithTrace } from "./message-processing.ts";

test("known support misspellings are corrected without changing negation", () => {
  const examples = [
    ["помгаити", "Помогите"], ["помшрте", "Помогите"], ["помо6ите", "Помогите"],
    ["почените машину пж", "Почините машину пж"],
    ["не почените, а вытащите машину", "Не почините, а вытащите машину"],
    ["витащиье с дерева", "Вытащите с дерева"],
    ["мотоцикол гдето улетел", "Мотоцикл гдето улетел"],
    ["я некаво не дбшил", "Я никого не ДБшил"],
    ["54 айди деемит", "54 айди ДМит"],
  ];
  for (const [source, expected] of examples) {
    assert.equal(correctText(source), expected);
    assert.equal(correctText(expected), expected, `second correction: ${source}`);
  }
});

test("joined IDs accept only complete known support actions and preserve identifiers", () => {
  for (const [source, expected] of [
    ["302вытащите", "302 вытащите"], ["84починитепж", "84 почините пж"],
    ["57DM", "57 ДМ"], ["57DB", "57 ДБ"], ["14спек", "14 спек"],
    ["273переверните", "273 переверните"], ["14проследите", "14 проследите"],
  ]) {
    assert.equal(separateIdAction(source), expected);
    assert.equal(correctText(expected), expected);
  }
  for (const source of ["A302вытащите", "302вытащитеMax", "302вытащите_я", "302дмм", "1234567вытащите", "ник57dm", "302починка"]) {
    assert.equal(correctText(source), source);
  }
  assert.equal(correctText("123DB etgan"), "123DB etgan");
});

test("known pleas join with recipients and polite endings without splitting names", () => {
  for (const [source, expected] of [
    ["помогитемне", "Помогите мне"], ["админыпомогитепж", "Админы помогите пж"],
    ["вытащитеменяпожалуйста", "Вытащите меня пожалуйста"],
    ["помогитепожалуйста", "Помогите, пожалуйста"],
    ["помогитеее пжжжж", "Помогите пж"],
  ]) {
    assert.equal(correctText(source), expected);
    assert.equal(correctText(expected), expected);
  }
  for (const source of ["Дмитрийпомоги", "непочините", "суперпомогитемне", "помом", "Оскар радниг", "435соыт"]) {
    assert.equal(correctText(source), source);
  }
});

test("mixed numeric spelling exception does not affect quoted evidence or names", () => {
  const source = 'Alex_помо6ите @помо6ите /помо6ите userпомо6ите 123помо6ите https://game.test/помо6ите «помо6ите» "302вытащите" `почените`';
  assert.equal(correctText(source), source);
  assert.equal(correctText("помо6ите 302"), "Помогите 302");
  assert.equal(correctText("ПОМО6ИТЕ"), "ПОМОГИТЕ");
});

test("exact Uzbek and Kazakh proof requests keep their imperative meaning", () => {
  for (const [source, expected] of [
    ["doki tez ber", "дайте доказательства быстро"],
    ["doki bering", "дайте доказательства"],
    ["dalillarni bering", "дайте доказательства"],
    ["дәлел көрсетіңіз", "покажите доказательства"],
    ["далел бериниз", "дайте доказательства"],
  ]) assert.equal(understandMessage(source).text, expected);
  // Unknown negative/conditional forms must not be stemmed to a positive command.
  for (const source of ["doki bermang", "doki tez bermang", "doki bersam", "doki tez berish"]) {
    assert.equal(understandMessage(source).text, source);
  }
  assert.equal(understandMessage('«doki tez ber» "дәлел көрсетіңіз"').translations.length, 0);
  assert.equal(understandMessage("doki tez ber xqzyr").text, "дайте доказательства быстро xqzyr");
});

test("a proof request remains intervention when a rule question is also present", () => {
  for (const source of [
    "qaysi qoidada spawn berdi? doki tez ber",
    "qaysi qoidada DB etgan? doki bering",
    "Покажите правило, дәлел көрсетіңіз",
  ]) assert.equal(processMessageWithTrace(source).processing.route, "help", source);
  assert.equal(processMessageWithTrace("qaysi qoidada?").processing.route, "question");
  assert.equal(processMessageWithTrace('Что значит «doki tez ber»?').processing.route, "question");
});
