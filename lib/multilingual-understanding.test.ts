import assert from "node:assert/strict";
import {test} from "node:test";
import {understandMessage} from "./message-understanding.ts";
import {normalizeInputScripts} from "./input-script-normalization.ts";
import {processMessageWithTrace} from "./message-processing.ts";

test("shared Kazakh and Ukrainian pronouns use local language context", () => {
  assert.equal(understandMessage("мені көмектес").text, "меня помогите");
  assert.equal(understandMessage("мені допоможіть").text, "мне помогите");
  assert.equal(understandMessage("мені").text, "мені");
  const mixed = understandMessage("мені көмектес. мені допоможіть");
  assert.equal(mixed.text, "меня помогите. мне помогите");
  assert.ok(mixed.translations.some(item=>item.language === "kk"));
  assert.ok(mixed.translations.some(item=>item.language === "uk"));
});

test("Uzbek Cyrillic aliases preserve the meaning and negation of known Latin phrases", () => {
  for (const [source, expected] of [
    ["ёрдам беринг", "помогите"], ["мен ўлдирмадим", "я не убивал"],
    ["чит йўқ", "нет читов"], ["қўлимни боғлади", "связал руки"],
    ["кира олмаяпман", "не могу зайти"],
  ]) assert.equal(understandMessage(source).text, expected, source);
});

test("known joined phrases and mixed alphabets do not require arbitrary word splitting", () => {
  assert.equal(understandMessage("yordambering").text, "помогите");
  assert.equal(understandMessage("ёрдамберинг").text, "помогите");
  assert.equal(understandMessage("жұмысістемейді").text, "не работает");
  assert.equal(understandMessage("yоrdam bеring").text, "помогите");
  assert.equal(understandMessage("суперyordambering").text, "суперyordambering");
});

test("unknown conditional and negative suffixes cannot become positive actions", () => {
  for (const source of ["oldirmasamchi", "boglamasangiz", "өлтірмесем", "допомоглибиxyz", "xqzyr"]) {
    assert.equal(understandMessage(source).text, source);
    assert.equal(understandMessage(source).translations.length, 0);
  }
});

test("evidence and explicit identifiers are preserved in all supported scripts", () => {
  const text = 'Alex_yordam @допоможіть /көмектес 123 https://game.test/yordam user@yordam.test «ёрдам беринг» "допоможіть" `көмектес`';
  assert.equal(understandMessage(text).text, text);
  assert.equal(understandMessage(text).translations.length, 0);
  for (const source of ["ник yordam", "логин: допоможіть", "nickname=көмектес", "'ёрдам беринг'"]) {
    assert.equal(understandMessage(source).text, source);
  }
});

test("language anchors cannot cross a sentence or protected quotation", () => {
  for (const source of ["Men in Black; ёрдам беринг", "men «ёрдам беринг»", "мені. көмектес"]) {
    assert.ok(understandMessage(source).text.startsWith(source.split(/[; .]/u)[0]), source);
  }
});

test("Ukrainian keyboard layout and transliteration reach the language step", () => {
  for (const source of ["ljgjvj;snm", "dopomozhit"]) {
    assert.equal(normalizeInputScripts(source).text, "допоможіть");
    const after = processMessageWithTrace(source);
    assert.equal(after.processing.route, "help");
    const step = after.processing.steps.find(step=>step.id === "understood");
    assert.match(step!.value, /помогите/u);
    assert.match(step!.detail!, /укр\./u);
  }
});

test("foreign translations leave game abbreviations and the saved message separate", () => {
  const source = "ДМ nima degani?";
  const after = processMessageWithTrace(source);
  assert.equal(after.text, source);
  assert.equal(after.processing.route, "question");
  assert.equal(understandMessage(source).text, "ДМ что такое?");
});

test("translated failures reach help while instructions remain questions", () => {
  for (const source of ["чатқа жаза алмаймын", "Кнопка не тиснеться", "pul hisoblanmadi", "bosh menyuga otib yuborvotti"]) {
    assert.equal(processMessageWithTrace(source).processing.route, "help", source);
  }
  assert.equal(processMessageWithTrace("Чи можна повернути гроші?").processing.route, "question");
  assert.equal(processMessageWithTrace("Как починить кнопку, если она не нажимается?").processing.route, "question");
  const appeal = processMessageWithTrace("за що мут");
  assert.equal(appeal.processing.route, "help");
  assert.equal(appeal.processing.needsClarification, true);
});
