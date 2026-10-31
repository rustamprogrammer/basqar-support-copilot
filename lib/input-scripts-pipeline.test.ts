import assert from "node:assert/strict";
import { test } from "node:test";
import { processMessageWithTrace } from "./message-processing.ts";
import { correctText } from "./text-correction.ts";

for (const [source, canonical] of [
  ["pomogite", "Помогите"],
  ["gjvjubnt", "Помогите"],
  ["пoмoгитe", "Помогите"],
  ["ne mogu zayti", "Не могу зайти"],
  ["chto takoe DM?", "Что такое ДМ?"],
  ["komektesiniz", "Көмектесіңіз"],
]) test(`restores intent without inventing an automatic answer: ${source}`, () => {
  const result = processMessageWithTrace(source);
  const reference = processMessageWithTrace(canonical);
  assert.equal(result.processing.route, reference.processing.route);
  assert.equal(result.processing.needsClarification, reference.processing.needsClarification);
  assert.equal(result.processing.answerReadiness, "not_evaluated");
  assert.equal(result.processing.steps[0].value, source);
  assert.equal(result.processing.steps[1].id, "normalized");
  assert.equal(result.processing.model, undefined);
  assert.equal(result.corrected, true);
  assert.equal(correctText(result.text), result.text);
});

test("keeps protected evidence intact while repairing the plea", () => {
  const protectedPart = 'https://example.com/gjvjubnt @pomogite Alex_Pomogite «gjvjubnt» "pomogite" `pomogite` /pomogite 143';
  const original = `pomogite ${protectedPart}`;
  const result = processMessageWithTrace(original);
  assert.equal(result.text, `Помогите ${protectedPart}`);
  assert.equal(result.processing.route, "help");
  assert.equal(result.processing.steps[0].value, original);
});

test("normalizes attribution before the single terminal moderation decision", () => {
  const result = processMessageWithTrace("on napisal: админ идиот, pomogite");
  assert.equal(result.status, "pending");
  assert.equal(result.processing.route, "help");
  assert.equal(result.processing.steps.find(step => step.id === "moderated")?.value, "Пересказ или отрицание");
});

test("keeps reported speech quoted and still detects a separate authored insult", () => {
  const reported = processMessageWithTrace('on napisal «ty idiot», pomogite');
  assert.equal(reported.status, "pending");
  assert.equal(reported.processing.route, "help");
  assert.ok(reported.text.includes('«ty idiot»'));
  const own = processMessageWithTrace('on napisal «ty idiot». Админ, ты дурак');
  assert.equal(own.status, "violation");
  assert.deepEqual(own.processing.steps.map(step => step.id), ["received", "normalized", "classified", "routed"]);
  assert.equal(own.processing.steps[0].value, 'on napisal «ty idiot». Админ, ты дурак');
});

test("a clarification keeps the restored parent help context", () => {
  const parent = processMessageWithTrace("pomogite");
  assert.equal(parent.processing.route, "help");
  assert.equal(parent.processing.needsClarification, true);
  const child = processMessageWithTrace("pomogite\nУточнение: не могу зайти", {
    parentId: "parent", answerText: "не могу зайти", parentRoute: "help", requestedDetails: ["problem"],
  });
  assert.equal(child.processing.route, "help");
  assert.equal(child.processing.context?.parentId, "parent");
});

test("a Kazakh request still asks for the missing problem description", () => {
  const result = processMessageWithTrace("magan komek kerek");
  assert.equal(result.processing.route, "help");
  assert.equal(result.processing.needsClarification, true);
  assert.deepEqual(result.processing.missingDetails, ["problem"]);
  const declined = processMessageWithTrace("көмек керек емес");
  assert.notEqual(declined.processing.route, "help");
});
