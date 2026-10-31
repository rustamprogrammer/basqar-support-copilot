import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareClarification, canClarify } from "./message-context.ts";
import { processMessageWithTrace } from "./message-processing.ts";
import type { Message } from "./message-types.ts";

const parent: Message = { id: "00000000-0000-4000-8000-000000000001", createdAt: 1, originalText: "Слив 10 пп", ...processMessageWithTrace("Слив 10 пп") };

test("clarification preserves the original and obtains a new decision from both messages", () => {
  const before = structuredClone(parent);
  const prepared = prepareClarification(parent, "Игрок 10 убил меня без причины, это ДМ");
  assert.ok(!("error" in prepared));
  assert.equal(prepared.originalText, "Слив 10 пп\nУточнение: Игрок 10 убил меня без причины, это ДМ");
  assert.deepEqual(prepared.context, { parentId: parent.id, answerText: "Игрок 10 убил меня без причины, это ДМ", parentRoute:null,requestedDetails:["meaning"],question:parent.processing!.followUp });
  const result = processMessageWithTrace(prepared.originalText,prepared.context);
  assert.equal(result.processing.classification, "report");
  assert.equal(result.processing.topic, "Жалоба на игрока");
  assert.deepEqual(parent, before);
});

test("clarification cannot bypass direct-insult moderation", () => {
  const prepared = prepareClarification(parent, "Админ, ты идиот");
  assert.ok(!("error" in prepared));
  const result = processMessageWithTrace(prepared.originalText);
  assert.equal(result.status, "violation");
  assert.deepEqual(result.processing.steps.map(step => step.id), ["received", "classified", "routed"]);
});

test("missing, completed, and non-question parents cannot be supplemented", () => {
  assert.equal(prepareClarification(undefined, "ДМ").status, 404);
  assert.equal(prepareClarification({ ...parent, status: "accepted" }, "ДМ").status, 409);
  assert.equal(prepareClarification({ ...parent, processing: null }, "ДМ").status, 409);
  assert.equal(prepareClarification(parent, "   ").status, 400);
});

test("AI violation with a real problem can receive a requested clarification", () => {
  const violation: Message = { ...parent, status: "violation", processing: { ...parent.processing!, route: "violation", needsClarification: true, followUp: "Когда пропала машина?", aiReview: { outcome: "replaced", promptVersion: "hybrid-review-1" } } };
  assert.equal(canClarify(violation), true);
  const reply = prepareClarification(violation, "После перезахода");
  assert.ok(!("error" in reply));
  assert.equal(reply.context.parentRoute, "violation");
  assert.equal(canClarify({ ...violation, status: "accepted" }), false);
  assert.equal(canClarify({ ...violation, status: "trash" }), false);
  assert.equal(canClarify({ ...violation, processing: { ...violation.processing!, aiReview: undefined } }), false);
});

test("clarification enforces the total limit and preserves chained context", () => {
  const full = { ...parent, originalText: "а".repeat(1987) };
  assert.ok(!("error" in prepareClarification(full, "б")));
  assert.equal(prepareClarification(full, "бб").status, 400);
  const prepared = prepareClarification({ ...parent, originalText: "Слив\nУточнение: ПП" }, "Игрок 10");
  assert.ok(!("error" in prepared));
  assert.equal(prepared.originalText, "Слив\nУточнение: ПП\nУточнение: Игрок 10");
});
