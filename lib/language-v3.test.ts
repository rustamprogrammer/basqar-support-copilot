import assert from "node:assert/strict";
import { test } from "node:test";
import { correctText } from "./text-correction.ts";
import { normalizeGameText } from "./game-language.ts";
import { understandMessage } from "./message-understanding.ts";

test("curated spelling corrections preserve the request and are idempotent", () => {
  for (const [source, expected] of [
    ["я застляр помогите", "Я застрял помогите"],
    ["адмыны скртншот не обрезан", "Админы скриншот не обрезан"],
    ["за что баннн", "За что бан"],
    ["помогите не чего не магу делать", "Помогите ничего не могу делать"],
    ["она обізвала меня", "Она обозвала меня"],
    ["разбанте меня", "Разбаньте меня"],
  ]) {
    assert.equal(correctText(source), expected);
    assert.equal(correctText(expected), expected);
  }
});

test("repeated code letters are normalized without substituting another code", () => {
  for (const source of ["дмм", "дмммм", "DMM"]) assert.equal(correctText(source), "ДМ");
  for (const source of ["дббб", "DBBBB"]) assert.equal(correctText(source), "ДБ");
  assert.equal(correctText("дм дб"), "ДМ ДБ");
  assert.equal(correctText("дн дп дбг ddm Дмитрий"), "дн дп дбг ddm Дмитрий");
});

test("known joined complaints accept a short help suffix without segmenting arbitrary names", () => {
  for (const [source, expected] of [
    ["менядмятвззпомогите", "Меня ДМят в ЗЗ помогите"],
    ["менянедмятпж", "Меня не ДМят пж"],
    ["дбпомоги", "ДБ помоги"],
    ["оскроднипожалуйста", "Оск родни пожалуйста"],
  ]) {
    assert.equal(correctText(source), expected);
    assert.equal(correctText(expected), expected);
  }
  for (const source of ["Дмитрийпомогите", "подменядмятпомогите", "бананпомоги", "АБ123дмм", "супердмпомоги"]) {
    assert.equal(correctText(source), source);
  }
});

test("expanded normalization leaves protected evidence and identifiers intact", () => {
  const source = 'Alex_дмм @адмыны /разбанте 123дмм https://example.com/застляр «менядмятвззпомогите» "DB etgan" `дббб`';
  assert.equal(correctText(source), source);
});

test("Uzbek db particle works in either case and only in a local clause", () => {
  for (const code of ["db", "DB", "Db", "dB"]) {
    const corrected = correctText(`meni ${code} etgan`);
    assert.doesNotMatch(corrected, /ДБ/u);
    assert.equal(understandMessage(corrected).text, "меня сказал");
  }
  assert.equal(normalizeGameText("meni urdi. DB в ЗЗ"), "meni urdi. ДБ в ЗЗ");
  assert.equal(normalizeGameText("DB меня сбили; meni urdi"), "ДБ меня сбили; meni urdi");
});

test("language cues cannot leak through sentence boundaries or protected quotations", () => {
  assert.equal(understandMessage("yordam berilar. Men in Black").text, "помогите. Men in Black");
  assert.equal(understandMessage("Men in Black; yordam bering").text, "Men in Black; помогите");
  assert.equal(understandMessage('men «yordam bering»').text, 'men «yordam bering»');
  assert.equal(understandMessage("men o'ldirmadim").text, "я не убивал");
  assert.equal(understandMessage("мен өлтірген жоқпын").text, "я не убивал");
});

test("new game phrases retain unknown words rather than inventing a full translation", () => {
  const pairs = [
    ["moshinada ketyatsam oldirvordi", "в машине ketyatsam убил"],
    ["kelib boglab kozimi yopib qoyapdi", "kelib связал закрыл глаза qoyapdi"],
    ["278 chit bor ekan kuzatila", "278 есть читы ekan понаблюдайте"],
    ["boshqa admin korib tashxis qoysin", "пусть другой администратор рассмотрит"],
    ["diqqat bilan tekshiring", "внимательно проверьте"],
    ["мені бақылаңыз", "меня понаблюдайте"],
  ];
  for (const [source, expected] of pairs) assert.equal(understandMessage(source).text, expected);
});

test("negative Uzbek and Kazakh phrases stay negative", () => {
  for (const phrase of ["oldirmaganman", "o'ldirganim yo'q", "boglamadim", "bog'lamadi", "өлтірген емеспін", "байлаған жоқпын"]) {
    const result = understandMessage(phrase);
    assert.equal(result.translations.length, 1, phrase);
    assert.match(result.text, /^не /u, phrase);
  }
  assert.equal(understandMessage("chit yoq").text, "нет читов");
  assert.equal(understandMessage("chit bor").text, "есть читы");
  assert.equal(understandMessage("oldirmasamchi xqzyr").text, "oldirmasamchi xqzyr");
});
