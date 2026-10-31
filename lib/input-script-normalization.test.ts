import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeInputScripts } from "./input-script-normalization.ts";

test("known Russian requests and complete negative phrases are normalized", () => {
  for (const [source, expected] of [
    ["pomogite", "помогите"], ["Pomogite pozhaluysta", "Помогите пожалуйста"],
    ["POMOGITE", "ПОМОГИТЕ"], ["ne mogu voiti", "не могу войти"],
    ["u menya ne rabotaet knopka", "у меня не работает knopka"],
    ["kak podat zhalobu?", "как подать жалобу?"],
    ["chto takoe DM i RP?", "что такое DM i RP?"],
    ["ya ne ubival", "я не убивал"], ["menya ne ubivali", "меня не убивали"],
    ["menya ne ubili", "меня не убили"], ["ne strelyaet", "не стреляет"],
    ["ne pomoshch", "не помощь"],
  ]) assert.equal(normalizeInputScripts(source).text, expected, source);
});

test("known wrong-layout words including internal punctuation are complete entries", () => {
  for (const [source, expected] of [
    ["gjvjubnt", "помогите"], ["Gjvjubnt", "Помогите"],
    ["gj;fkeqcnf", "пожалуйста"], ["gjvjubnt gj;fkeqcnf", "помогите пожалуйста"],
    ["(gj;fkeqcnf!)", "(пожалуйста!)"],
    ["z yt e,bdfk", "я не убивал"], ["yt vjue", "не могу"],
    ["rfr gjlfnm ;fkj,e", "как подать жалобу"], ["рудз", "хелп"],
    ["vtyz yt e,bkb", "меня не убили"], ["'nj wbnfnf", "это цитата"],
  ]) assert.equal(normalizeInputScripts(source).text, expected, source);
  assert.equal(normalizeInputScripts("English text with gj;fkeqcnf token").text, "English text with gj;fkeqcnf token");
  assert.equal(normalizeInputScripts("pomogite. English text gj;fkeqcnf").text, "помогите. English text gj;fkeqcnf");
});

test("Kazakh Latin and exact simplified Cyrillic forms preserve language and negation", () => {
  for (const [source, expected] of [
    ["komektesiniz", "көмектесіңіз"], ["magan komek kerek", "маған көмек керек"],
    ["mağan kömek kerek", "маған көмек керек"], ["kire almaimyn", "кіре алмаймын"],
    ["men oltirmedim", "мен өлтірмедім"], ["жумыс истемейди", "жұмыс істемейді"],
    ["комектесиниз", "көмектесіңіз"], ["rjvtrntcbybp", "көмектесіңіз"],
  ]) {
    const result = normalizeInputScripts(source);
    assert.equal(result.text, expected, source);
    assert.equal(result.changes[0]?.language, "kk", source);
  }
});

test("mixed-script correction uses known full words, not arbitrary homoglyph rewriting", () => {
  for (const [source, expected] of [
    ["пoмoгитe", "помогите"], ["пoчиниte", "почините"],
    ["komектес", "көмектес"], ["komектесиниз", "көмектесіңіз"],
  ]) {
    const result = normalizeInputScripts(source);
    assert.equal(result.text, expected);
    assert.equal(result.changes[0]?.kind, "mixed-script");
  }
  assert.equal(normalizeInputScripts("пoмoгитeMax Неизвeстнoe").text, "пoмoгитeMax Неизвeстнoe");
});

test("English, Uzbek, short ambiguous words and unknown strings are untouched", () => {
  for (const source of [
    "he said no, help me on the server", "my admin is not an idiot", "on ne ty he no men man",
    "meni oldirdi iltimos yordam bering", "men o'ldirmadim", "qaysi qoidada db etgan",
    "DM DB RP AFK ban mute help", "qwerty xqzyr unknown", "kire almaimynXYZ", "3omek 4agan",
  ]) assert.deepEqual(normalizeInputScripts(source), { text: source, changes: [] });
});

test("evidence, code, links, commands, handles and IDs stay exactly unchanged", () => {
  const source = '«pomogite» "gjvjubnt" \'komektesiniz\' `пoмoгитe` https://game.test/pomogite @pomogite /pomogite Alex_pomogite pomogite42 42gjvjubnt 123 ник: pomogite login@example.com';
  assert.deepEqual(normalizeInputScripts(source), { text: source, changes: [] });
  assert.equal(normalizeInputScripts("ник pomogite, помогите").text, "ник pomogite, помогите");
  assert.equal(normalizeInputScripts('on napisal «ty idiot», pomogite').text, 'он написал «ty idiot», помогите');
  assert.equal(normalizeInputScripts('igrok skazal: админ идиот').text, 'игрок сказал: админ идиот');
  assert.equal(normalizeInputScripts('eto tsitata: "admin idiot"').text, 'это цитата: "admin idiot"');
  assert.equal(normalizeInputScripts('ne nazyvay его так').text, 'не называй его так');
});

test("changes are attributable, ordered and normalization is idempotent", () => {
  const result = normalizeInputScripts("pomogite 247, kire almaimyn");
  assert.deepEqual(result.changes, [
    { source: "pomogite", target: "помогите", kind: "transliteration", language: "ru" },
    { source: "kire almaimyn", target: "кіре алмаймын", kind: "transliteration", language: "kk" },
  ]);
  assert.deepEqual(normalizeInputScripts(result.text), { text: result.text, changes: [] });
});
