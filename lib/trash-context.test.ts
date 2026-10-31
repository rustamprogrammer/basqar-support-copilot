import assert from "node:assert/strict";
import { test } from "node:test";
import { processMessageWithTrace } from "./message-processing.ts";

const preserve = [
  'Здравствуйте, «Не удалось войти в аккаунт»',
  'Привет, "Connection failed"',
  'Спасибо, «ошибка входа»',
  'Привет, «памагите я застрял»',
  'Здравствуйте, “Ошибка 403”',
  'Привет, `unknown error`',
  'Привет /help',
  'Привет https://example.com/screenshot',
  'Привет @Player',
  'Помощь не нужна, «ошибка осталась»',
  'Я не говорил, что помощь не нужна. Ответьте мне.',
  'Кто сказал, что помощь не нужна? Я жду администратора.',
  'Помощь больше не нужна? Нет, нужна!',
  'Помощь не нужна?',
  'Мне сказали, что помощь не нужна',
  'Вчера помощь не нужна была, а сейчас нужна',
];
for (const text of preserve) test(`retain meaningful evidence or ambiguous cancellation: ${text}`, () => {
  const result = processMessageWithTrace(text);
  assert.equal(result.status, "pending");
  assert.equal(result.processing.classification, "clarify");
  assert.ok(result.processing.ruleId?.startsWith("route."));
  assert.equal(result.processing.steps[0].value, text);
});

for (const text of ["Привет", "Здравствуйте!", "Спасибо", "123", "Помощь больше не нужна", "Помощь не нужна", "Не нужна мне помощь", "Спасибо, помощь больше не нужна!", "Помощь не нужна, отменяю обращение", "Помощь не нужна, я уже разобрался", "Помощь больше не нужна. Пароль НЕ меняйте."]) {
  test(`keep explicit low-content or cancellation route: ${text}`, () => assert.equal(processMessageWithTrace(text).status, "trash"));
}

test("a clear problem remains a report instead of being reduced to an unknown quote", () => {
  const text = 'Здравствуйте, не могу войти, пишет «Connection failed»';
  const result = processMessageWithTrace(text);
  assert.equal(result.status, "pending");
  assert.equal(result.processing.classification, "report");
  assert.equal(result.processing.topic, "Помощь в игре");
  assert.ok(result.text.includes('«Connection failed»'));
});
