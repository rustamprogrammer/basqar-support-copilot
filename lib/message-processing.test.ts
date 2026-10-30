import assert from "node:assert/strict";
import { test } from "node:test";
import { processMessage, processMessageWithTrace } from "./message-processing.ts";

test("corrects a complete request before routing it", () => {
  assert.deepEqual(processMessage("памагите пажалуста не магу зайти в акаунт"), { text: "Помогите, пожалуйста, не могу зайти в аккаунт", status: "pending", corrected: true });
});
test("keeps message numbers while correcting a problem report", () => {
  assert.deepEqual(processMessage("у миня не атправляится саабщение 123"), { text: "У меня не отправляется сообщение 123", status: "pending", corrected: true });
});
test("does not rewrite names, links, quoted text, code or identifiers", () => {
  const original = 'Илья Миронов: АБ123, помошь123, https://example.com/памагите user@example.com «памагите» "помошь" `акаунт`';
  assert.equal(processMessage(original).text, original);
});
test("preserves negation and does not request help when it is declined", () => {
  const original = "Помощь больше не нужна. Пароль НЕ меняйте.";
  assert.deepEqual(processMessage(original), { text: original, status: "trash", corrected: false });
});
test("handles uppercase requests and known problem phrases", () => {
  assert.equal(processMessage("ПАМАГИТЕ!").text, "ПОМОГИТЕ!");
  assert.equal(processMessage("ПАМАГИТЕ!").status, "pending");
  assert.equal(processMessage("Не могу войти").status, "pending");
});
test("does not invent meaning for numbers or unfamiliar words", () => {
  assert.deepEqual(processMessage("123"), { text: "123", status: "trash", corrected: false });
  assert.equal(processMessage("Ксенофонт абракадабра").text, "Ксенофонт абракадабра");
  assert.equal(processMessage("помощник").status, "trash");
});

test("records the user's example in order and classifies the corrected complaint", () => {
  const original = "У мня не удеться зойти";
  const result = processMessageWithTrace(original);
  assert.equal(result.text, "У меня не получается зайти");
  assert.equal(result.status, "pending");
  assert.equal(result.processing.classification, "report");
  assert.deepEqual(result.processing.steps.map(step => step.id), ["received", "corrected", "classified", "routed"]);
  assert.deepEqual(result.processing.steps.map(step => step.value), [original, result.text, "Жалоба", "Администратору на проверку"]);
  assert.match(result.processing.steps[2].detail!, /не получается зайти/);
});

test("records trash without claiming to send it to the administrator", () => {
  const result = processMessageWithTrace(" 123 ");
  assert.equal(result.processing.classification, "trash");
  assert.equal(result.processing.steps[0].value, " 123 ");
  assert.equal(result.processing.steps[1].value, "123");
  assert.equal(result.processing.steps[1].detail, "Без изменений.");
  assert.equal(result.processing.steps[3].value, "В корзину");
});

test("keeps quoted variants intact and recognizes correctly written login complaints", () => {
  assert.equal(processMessage('«У мня не удеться зойти»').text, '«У мня не удеться зойти»');
  assert.equal(processMessage("Не удаётся зайти").status, "pending");
  assert.equal(processMessage("Не удается зайти").status, "pending");
});
