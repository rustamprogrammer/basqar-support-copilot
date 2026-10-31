import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeInputScripts } from "./input-script-normalization.ts";
import { processMessageWithTrace } from "./message-processing.ts";
import { evaluateQualityRequest } from "./quality-evaluation.ts";

test("character flooding is bounded before processing and keeps the original evidence", () => {
  const source = "а".repeat(2000);
  const normalized = normalizeInputScripts(source);
  assert.equal(normalized.text, "ааа");
  assert.equal(normalized.changes[0].kind, "repetition");
  const result = processMessageWithTrace(source);
  assert.equal(result.status, "trash");
  assert.equal(result.processing.steps[0].value, source);
  assert.notEqual(result.status, "violation");
});

test("long repeats inside authored words are shortened without changing protected evidence", () => {
  const repeated = "о".repeat(100);
  const source = `п${repeated}могите «п${repeated}могите» https://game.test/${repeated} @${repeated} ник ${repeated}`;
  const normalized = normalizeInputScripts(source);
  assert.ok(normalized.text.startsWith("помогите "));
  assert.ok(normalized.text.endsWith(`«п${repeated}могите» https://game.test/${repeated} @${repeated} ник ${repeated}`));
  assert.equal(normalizeInputScripts(normalized.text).text, normalized.text);
  assert.notEqual(processMessageWithTrace(`п${repeated}могите меня убили`).status, "violation");
});

test("a maximum-size read-only batch of character floods completes normally", { timeout: 5000 }, async () => {
  const source = "а".repeat(2000);
  const response = await evaluateQualityRequest(new Request("http://localhost/api/quality/evaluate", {
    method: "POST", body: JSON.stringify({ texts: Array(10).fill(source) }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { results: ReturnType<typeof processMessageWithTrace>[] };
  assert.equal(body.results.length, 10);
  assert.ok(body.results.every(result => result.status === "trash" && result.processing.steps[0].value === source));
});
