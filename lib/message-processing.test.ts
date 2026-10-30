import assert from "node:assert/strict";
import { test } from "node:test";
import { processMessage } from "./message-processing.ts";

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
