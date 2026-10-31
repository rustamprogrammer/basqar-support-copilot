import assert from "node:assert/strict";
import { test } from "node:test";
import { processMessageWithTrace } from "./message-processing.ts";

const abusive = [
  "сука ты любитель прям жб кидать дура ебливая",
  "Ты дурак", "ВЫ ДЕБИЛЫ", "Админ мудак", "администраторы идиоты",
  "помогите, админы вы дебилы", "Что значит ДМ, ты идиот?",
  "Ты ДМишь, идиот", "Разбаньте меня, админ мудак",
  "Ты совсем тупая", "Дура ебливая", "Иди нахуй", "Пошёл на хуй",
  "Ты не дурак, а полный идиот", "Ты не дурак. Но ты мудак",
  "Меня оскорбили: «ты дурак». А ты идиот",
  "Он написал ты идиот, а ты дурак",
  "Он написал: идиот. Ты дебил", "Долбоёб", "Админ, ты мразь",
];
for (const input of abusive) test(`authored insult: ${input}`, () => {
  const result = processMessageWithTrace(input);
  assert.equal(result.status, "violation");
  assert.equal(result.processing.classification, "violation");
  assert.equal(result.processing.topic, "Оскорбление в обращении");
  assert.match(result.processing.steps.find(step => step.id === "classified")!.detail!, /Найдено выражение: «.+»/);
  assert.equal(result.processing.steps.find(step => step.id === "routed")!.value, "В раздел «Нарушения»");
  assert.equal(result.processing.steps[0].value, input);
});

const ordinary = [
  "Меня оскорбили", "Он оскорбляет мою родню", "оскродни", "ДМ в ЗЗ",
  "Меня оскорбили: «ты дурак»", 'Он сказал "ты идиот"',
  "Он написал ты идиот", "Он пишет: ты дурак", "Мне пишут ты дебил",
  "Меня назвали дураком", "Ты меня назвал дурой", "Не называй меня дурой",
  "Игрок говорит ты идиот", "Мне дали бан за слова ты дурак",
  "Что означает слово дурак?", "Можно ли говорить ты дурак?",
  "Нельзя писать ты идиот", "Ты не дурак", "Вы не такие идиоты",
  "Ты вовсе не дурак", "Я не говорил ты идиот", "Я идиот, не могу войти",
  "Меня ДМят, блядь", "Бля, не могу зайти", "Сука, меня ДМят",
  "Ты поможешь?", "Я узбек", "Я казах", "дурак это оскорбление?",
  "«ты дурак»", '"ты дурак"', '`ты дурак`', "@дурак помощь",
  "Игрок Alex_дурак ДМит", "https://example.com/ты-дурак помощь",
];
for (const input of ordinary) test(`do not accuse the reporter: ${input}`, () => {
  assert.notEqual(processMessageWithTrace(input).status, "violation");
});

test("complaint, uncertainty and trash routes remain distinct", () => {
  assert.equal(processMessageWithTrace('Меня оскорбили: «ты дурак»').processing.topic, "Жалоба на игрока");
  assert.equal(processMessageWithTrace("Слив 10 пп").processing.classification, "clarify");
  assert.equal(processMessageWithTrace("123").status, "trash");
});

test("a violation finishes processing before correction, translation and intent analysis", () => {
  const input = "  памагите meni urdi в зз, админ ты идиот  ";
  const result = processMessageWithTrace(input);
  assert.equal(result.status, "violation");
  assert.equal(result.text, input.trim());
  assert.equal(result.corrected, false);
  assert.deepEqual(result.processing.steps.map(step => step.id), ["received", "classified", "routed"]);
  assert.equal(result.processing.steps[0].value, input);
  assert.match(result.processing.steps.at(-1)!.detail!, /Обработка завершена/);
});

test("reported insults still get the normal correction and understanding stages", () => {
  const result = processMessageWithTrace('памагите meni urdi, он сказал «ты идиот»');
  assert.equal(result.status, "pending");
  assert.equal(result.corrected, true);
  assert.ok(result.processing.steps.some(step => step.id === "understood"));
});
