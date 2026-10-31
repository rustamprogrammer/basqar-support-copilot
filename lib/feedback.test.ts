import assert from "node:assert/strict";
import { test } from "node:test";
import { exportFeedback, feedbackLabel, parseFeedback } from "./feedback.ts";

const message = { id: "01234567-89ab-cdef-0123-456789abcdef", text: "Исправленный текст", originalText: "Исходный текст" };
const common = { messageId: message.id, correctedText: null, note: null };
const current = { ...common, routingSchema: "purpose-v1" };

test("route and missing details are independent, including an undetermined route", () => {
  for (const label of ["question", "help", "violation", "trash", "clarify"]) {
    for (const needsClarification of [true, false, null]) {
      const parsed = parseFeedback({ ...current, label, needsClarification });
      assert.equal(parsed?.label, label);
      assert.equal(parsed?.needsClarification, needsClarification);
    }
  }
});

test("current schema requires an explicit detail decision and rejects legacy topics", () => {
  for (const input of [
    { ...current, label: "help" },
    { ...current, label: "help", needsClarification: "false" },
    { ...current, label: "player", needsClarification: false },
    { ...current, label: "help", needsClarification: false, routingSchema: "future" },
    { ...current, label: "help", needsClarification: false, note: "x".repeat(501) },
    { ...current, label: "help", needsClarification: false, correctedText: "x".repeat(2001) },
  ]) assert.equal(parseFeedback(input), null);
});

test("legacy feedback stays legacy and does not acquire reviewed route or details", () => {
  const parsed = parseFeedback({ ...common, label: "appeal", needsClarification: true });
  assert.ok(parsed);
  assert.equal(parsed.routingSchema, null);
  assert.equal(parsed.needsClarification, null);
  const exported = exportFeedback(message, { ...parsed, updatedAt: 1 });
  assert.ok("legacyLabel" in exported);
  assert.equal(exported.legacyLabel, "appeal");
  assert.equal(exported.routeLabel, "appeal");
  assert.equal(exported.needsClarification, null);
  assert.equal("routingSchema" in exported, false);
  assert.equal("expectedRoute" in exported, false);
  assert.equal(exported.reviewStatus, "proposed");
});

test("exports preserve the original text and never promote public proposals to expert labels", () => {
  for (const label of ["question", "help", "violation", "trash", "clarify"]) {
    const parsed = parseFeedback({ ...current, label, needsClarification: false });
    assert.ok(parsed);
    const exported = exportFeedback(message, { ...parsed, updatedAt: 2 });
    assert.ok("expectedRoute" in exported && "routingSchema" in exported);
    assert.equal(exported.text, message.originalText);
    assert.equal(exported.expectedRoute, label === "clarify" ? null : label);
    assert.equal(exported.routeLabel, label);
    assert.equal(exported.routingSchema, "purpose-v1");
    assert.equal(exported.needsClarification, false);
    assert.equal(exported.reviewStatus, "proposed");
    assert.equal("labelStatus" in exported, false);
  }
  assert.equal(feedbackLabel({ label: "clarify", routingSchema: "purpose-v1" }), "Категория не определена");
});
