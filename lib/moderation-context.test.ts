import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectModeration } from "./message-moderation.ts";
import { processMessageWithTrace } from "./message-processing.ts";

const complaints = [
  "этот пидорас заебал меня, damn it, помогите админы",
  "ЭТОТ ПИДОРАС ЗАЕБАЛ МЕНЯ! Damn it! Помогите, админы!",
  "Админы помогите, этот мудак меня убил в ЗЗ",
  "Этот мудак меня ДМит, админ, разберитесь",
  "Он, сука, опять стреляет в меня, админы помогите",
  "Этот админ заебал меня банить, помогите",
  "Этот идиот мешает мне играть",
  "Этот мудак меня убил. Он сказал, что это шутка",
  "Этот мудак меня убил, он сказал это шутка",
  "Этот мудак меня убил. Это его шутка",
  "Этот пидорас заебал меня. Админ, ты поможешь?",
  "Ты видел, как этот мудак меня убил? Помоги, админ",
  "Этот мудак меня убил. Это шутка?",
  "Ты видел, этот админ мудак опять забанил меня без причины",
];
for (const text of complaints) test(`emotional complaint remains reviewable: ${text}`, () => {
  assert.equal(inspectModeration(text).kind, "complaint");
  const result = processMessageWithTrace(text);
  assert.equal(result.status, "pending");
  assert.equal(result.processing.steps.find(step => step.id === "moderated")?.value, "Возможная жалоба с руганью");
  assert.ok(result.processing.steps.some(step => step.id === "corrected"));
});

const violations = [
  "Админ, ты идиот, помоги",
  "Админ мудак, помоги",
  "Помогите, вы идиоты",
  "Ты меня заебал, админ",
  "АДМИН СНИМАЙ НАКАЗАНИЕ! ТЫ ЗАЕБАЛ УЖЕ ВСЕХ БАНИШЬ НЕ ЗА ЧТО",
  "Этот мудак меня убил. Админ, ты идиот",
  "Этот мудак меня убил, а ты идиот",
  "Этот мудак меня убил, идите нахуй",
  "Ты идиот, это шутка",
  "Дебил. Шучу",
  "Дебил, просто рофл",
  "Пидор, это пранк",
  "сососососоос пидорыв)))) шутка",
  "Этот мудак меня убил. Это шутка",
  "Этот мудак меня убил. Я просто пошутил",
];
for (const text of violations) test(`help or jokes do not excuse authored abuse: ${text}`, () => {
  const result = processMessageWithTrace(text);
  assert.equal(result.status, "violation");
  assert.equal(result.text, text);
  assert.deepEqual(result.processing.steps.map(step => step.id), ["received", "classified", "routed"]);
  assert.equal(result.processing.model, undefined);
});

const nonAbusive = [
  "Бля, админ, не могу зайти",
  "Заебал этот баг, админы помогите",
  "Ты не идиот, это шутка",
  "Он написал: ты идиот, это шутка",
  "Он написал ты заебал меня. Админы помогите",
  "Мне написали «ты идиот», потом сказали «шутка». Помогите",
  "Что значит шутка?",
  "Это шутка? Меня назвали дураком",
  "Что значит слово идиот? Это шутка?",
  "Игрок Joke_дурак шутит, помогите с багом",
  "Шутка была смешная, но теперь не могу зайти",
  "Сука, не могу зайти. Шутка была смешная",
  "Заебал этот баг. Это шутка",
  "Он молодец, а я лох, не могу зайти",
  "Этот тупой баг опять появился, админы помогите",
  "Админ, тупой вопрос: как сменить ник?",
  "стою говорю что прода\nм тачку и мне кинули мут после этого чела скзали что он мне заклеил скотчем рот и что я лох",
];
for (const text of nonAbusive) test(`no automatic violation for mere words or reported jokes: ${text}`, () => {
  assert.equal(processMessageWithTrace(text).status, "pending");
});

test("the original example asks for details rather than inventing a specific game violation", () => {
  const result = processMessageWithTrace(complaints[0]);
  assert.equal(result.processing.classification, "report");
  assert.equal(result.processing.route, "help");
  assert.equal(result.processing.steps.at(-1)?.value, "Администратору на проверку");
});

test("the trace explains the joke decision", () => {
  const result = processMessageWithTrace("сососососоос пидорыв)))) шутка");
  assert.match(result.processing.steps.find(step => step.id === "classified")!.detail!, /оправданием «шутка»/);
});
