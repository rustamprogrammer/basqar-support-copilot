import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateQualityRequest } from "./quality-evaluation.ts";
import { SUPPORT_VERSION, processSupportMessage } from './support-processing.ts';

const request = (body: unknown) => new Request("http://localhost/api/quality/evaluate", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("evaluation preserves order and uses exactly the submission processor", async () => {
  const texts = ["Что такое ДМ?", "Меня убили в ЗЗ, помогите", "Админ, ты идиот", "123"];
  const result = await evaluateQualityRequest(request({ texts }));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  const expected = { version: SUPPORT_VERSION, results: texts.map(text => processSupportMessage(text)) };
  assert.deepEqual(await result.json(), JSON.parse(JSON.stringify(expected)));
});

test("evaluation rejects malformed JSON and non-string/empty/oversized batches", async () => {
  for (const body of [null, [], {}, { texts: "hello" }, { texts: [] }, { texts: [123] },
    { texts: [null] }, { texts: [" "] }, { texts: ["x".repeat(2001)] }, { texts: Array(11).fill("hello") }]) {
    assert.equal((await evaluateQualityRequest(request(body))).status, 400);
  }
  assert.equal((await evaluateQualityRequest(new Request("http://localhost", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await evaluateQualityRequest(new Request("http://localhost", { method: "POST" }))).status, 400);
});

test("evaluation accepts ten messages at the per-message boundary", async () => {
  const result = await evaluateQualityRequest(request({ texts: Array(10).fill("Помогите" + " ".repeat(1992)) }));
  assert.equal(result.status, 200);
  assert.equal((await result.json() as { results: unknown[] }).results.length, 10);
});

test("body limit is enforced both from Content-Length and from actual streamed bytes", async () => {
  const oversized = " ".repeat(80 * 1024 + 1);
  const headerOptions: HeadersInit[] = [{ "Content-Length": String(oversized.length) }, { "Content-Length": "1" }, {}];
  for (const headers of headerOptions) {
    const result = await evaluateQualityRequest(new Request("http://localhost", { method: "POST", headers, body: oversized }));
    assert.equal(result.status, 413);
  }
  const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
  assert.equal((await evaluateQualityRequest(new Request("http://localhost", { method: "POST", body: invalidUtf8 }))).status, 400);
});
