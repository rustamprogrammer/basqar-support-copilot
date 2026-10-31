import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMessageBox, type Message } from "./message-types.ts";

function legacyMessage(): Message {
  // Database JSON predates the current three-box TypeScript contract.
  return {
    id: "legacy-message", text: "Не могу войти", originalText: "немогу заити",
    status: "pending", createdAt: 1,
    processing: {
      classification: "report", box: "request",
      ai: {
        result: { meaning_ru: "Не могу войти", box: "request", needs_human: true },
        source: "model", model: "old-model", note: "Старая запись", sources: [], web_search_calls: 0, usage: null,
      },
      steps: [
        { id: "received", title: "Исходный текст", value: "Запросы" },
        { id: "classified", title: "Категория", value: "Запросы" },
        { id: "routed", title: "Куда отправлено", value: "Запросы" },
      ],
    },
  } as unknown as Message;
}

test("legacy request metadata maps to complaints without modifying raw text, status or stored object", () => {
  const stored = legacyMessage();
  const snapshot = structuredClone(stored);
  const mapped = normalizeMessageBox(stored);
  assert.equal(mapped.processing?.box, "complaint");
  assert.equal(mapped.processing?.ai?.result.box, "complaint");
  assert.equal(mapped.processing?.steps[1].value, "Жалобы");
  assert.equal(mapped.processing?.steps[2].value, "Жалобы");
  assert.equal(mapped.processing?.steps[0].value, "Запросы");
  assert.equal(mapped.originalText, "немогу заити");
  assert.equal(mapped.text, "Не могу войти");
  assert.equal(mapped.status, "pending");
  assert.equal(mapped.id, stored.id);
  assert.equal(mapped.createdAt, stored.createdAt);
  assert.deepEqual(stored, snapshot);
});

test("all current boxes remain unchanged", () => {
  for (const box of ["question", "complaint", "violation"] as const) {
    const message = legacyMessage();
    message.processing!.box = box;
    message.processing!.ai!.result.box = box;
    const snapshot = structuredClone(message);
    assert.equal(normalizeMessageBox(message), message);
    assert.deepEqual(message, snapshot);
  }
});

test("legacy AI-only category supplies the complaint box without overwriting an existing current box", () => {
  const aiOnly = legacyMessage();
  delete aiOnly.processing!.box;
  assert.equal(normalizeMessageBox(aiOnly).processing?.box, "complaint");
  assert.equal(normalizeMessageBox(aiOnly).processing?.ai?.result.box, "complaint");

  const mixed = legacyMessage();
  mixed.processing!.box = "question";
  const mapped = normalizeMessageBox(mixed);
  assert.equal(mapped.processing?.box, "question");
  assert.equal(mapped.processing?.ai?.result.box, "complaint");
});

test("normalization is idempotent and tolerates old messages with no processing or AI", () => {
  const mapped = normalizeMessageBox(legacyMessage());
  assert.equal(normalizeMessageBox(mapped), mapped);

  const noProcessing = { ...legacyMessage(), processing: null };
  assert.equal(normalizeMessageBox(noProcessing), noProcessing);

  const noAi = legacyMessage();
  delete noAi.processing!.ai;
  assert.equal(normalizeMessageBox(noAi).processing?.box, "complaint");
});
