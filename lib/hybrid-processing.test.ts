import test from "node:test";
import assert from "node:assert/strict";
import { createReviewService, processHybridMessage, reviewCandidate } from "./hybrid-processing.ts";
import { processMessageWithTrace } from "./message-processing.ts";
import type { ReviewResult, ReviewDecision } from "./ai-review-client.ts";

const confirmed: ReviewResult = { ok: true, decision: { ok: true, correction: null, reason: null }, model: "test", elapsedMs: 10, usage: { inputTokens: 100, outputTokens: 9, cachedTokens: 0, cacheWriteTokens: 0 } };
const replacement = (category: "question" | "help" | "violation" | "trash" | "undetermined", needs = false): ReviewResult => ({
  ...confirmed, ok: true, decision: { ok: false, correction: { category, corrected_text: "Текст ИИ", needs_clarification: needs, follow_up: needs ? "Уточните, что случилось?" : null }, reason: "Проверено по исходному тексту" },
});
const input = { original: "Что такое ДМ?", candidate: { category: "question" as const, needs_clarification: false } };

test("confirmation keeps rules result, audit snapshot and adds honest verification", async () => {
  const original = "Что такое ДМ?", rules = processMessageWithTrace(original);
  const result = await processHybridMessage(original, undefined, async passed => {
    assert.equal(passed.original, original);
    assert.deepEqual(passed.candidate, reviewCandidate(original, rules));
    return { result: confirmed, cached: false };
  });
  assert.equal(result.text, rules.text);
  assert.equal(result.processing.route, rules.processing.route);
  assert.equal(result.processing.decisionSource, "rules");
  assert.equal(result.processing.aiReview?.outcome, "confirmed");
  assert.equal(result.processing.algorithm?.route, rules.processing.route);
  assert.equal(result.processing.steps.filter(step => step.id === "classified").length, 1);
  assert.equal(new Set(result.processing.steps.map(step => step.id)).size, result.processing.steps.length);
});

test("AI can overturn terminal rule violations; old rule evidence is not final", async () => {
  const original = "админ ты идиот";
  assert.equal(processMessageWithTrace(original).status, "violation");
  const result = await processHybridMessage(original, undefined, async () => ({ result: replacement("help"), cached: false }));
  assert.equal(result.status, "pending");
  assert.equal(result.processing.route, "help");
  assert.equal(result.processing.algorithm?.route, "violation");
  for (const key of ["ruleId", "events", "topic", "model"] as const) assert.equal(result.processing[key], undefined);
  assert.equal(result.processing.decisionSource, "ai");
  assert.equal(result.processing.followUp, undefined);
  assert.equal(result.processing.steps.some(step => step.value === "Отправлено автоматически. Обработка завершена."), false);
});

test("replacement routes and clarification stay consistent", async () => {
  for (const category of ["question", "help", "violation", "trash", "undetermined"] as const) {
    const result = await processHybridMessage("нужна помощь", undefined, async () => ({ result: replacement(category, category === "undetermined"), cached: false }));
    assert.equal(result.status, category === "violation" || category === "trash" ? category : "pending");
    assert.equal(result.processing.route, category === "undetermined" ? null : category);
    assert.equal(result.processing.needsClarification, category === "undetermined");
    assert.equal(!!result.processing.followUp, category === "undetermined");
  }
});

test("clarification supplies original combined text and prior question without local diagnostics", async () => {
  const original = "Не пускает\nУточнение: пишет неверный пароль";
  const context = { parentId: "x", answerText: "пишет неверный пароль", parentRoute: "help" as const, requestedDetails: ["account"], question: "Какая ошибка?" };
  const result = await processHybridMessage(original, context, async value => {
    assert.equal(value.original, original);
    assert.deepEqual(value.context, { parent_category: "help", question: "Какая ошибка?" });
    assert.equal("steps" in value.candidate, false);
    return { result: replacement("help"), cached: false };
  });
  assert.deepEqual(result.processing.context, context);
});

test("disabled, limited, failed and malformed reviews do not pretend to verify", async () => {
  const text = "Что такое ДМ?", rules = processMessageWithTrace(text);
  const disabled = await processHybridMessage(text);
  assert.equal(disabled.processing.aiReview?.outcome, "disabled");
  for (const response of [
    { limited: true as const },
    { result: { ok: false as const, code: "timeout" as const, elapsedMs: 12 }, cached: false },
    { result: { ...confirmed, decision: { ok: false, correction: null, reason: null } as ReviewDecision }, cached: false },
  ]) {
    const result = await processHybridMessage(text, undefined, async () => response);
    assert.equal(result.text, rules.text);
    assert.equal(result.processing.route, rules.processing.route);
    assert.notEqual(result.processing.aiReview?.outcome, "confirmed");
    assert.notEqual(result.processing.aiReview?.outcome, "replaced");
  }
  const thrown = await processHybridMessage(text, undefined, async () => { throw new Error("secret must not escape"); });
  assert.equal(JSON.stringify(thrown).includes("secret must not escape"), false);
});

test("concurrent duplicate reviews spend once and cached usage is zero", async () => {
  let calls = 0;
  const reviewer = createReviewService({ apiKey: "test", call: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); return confirmed; } });
  const [a, b] = await Promise.all([processHybridMessage(input.original, undefined, reviewer), processHybridMessage(input.original, undefined, reviewer)]);
  assert.equal(calls, 1);
  assert.equal(a.processing.aiReview?.usage?.inputTokens, 100);
  assert.equal(b.processing.aiReview?.usage?.inputTokens, 0);
  assert.equal(b.processing.aiReview?.cached, true);
});

test("cache includes original, candidate and context; total quota does not reset every minute", async () => {
  let calls = 0, now = 1000;
  const reviewer = createReviewService({ apiKey: "test", maxCalls: 2, now: () => now, call: async () => { calls++; return confirmed; } });
  await reviewer(input);
  await reviewer(input);
  assert.equal(calls, 1);
  await reviewer({ ...input, context: { question: "Что произошло?" } });
  now += 70_000;
  assert.deepEqual(await reviewer({ ...input, original: "Другой текст" }), { limited: true });
  assert.equal(calls, 2);
});

test("concurrency, minute limits, expiry and failures bound paid attempts", async () => {
  let release!: (value: ReviewResult) => void;
  const reviewer = createReviewService({ apiKey: "test", concurrency: 1, call: () => new Promise(resolve => { release = resolve; }) });
  const first = reviewer(input);
  await Promise.resolve();
  assert.deepEqual(await reviewer({ ...input, original: "Другой" }), { limited: true });
  release(confirmed); await first;
  let now = 1000, calls = 0;
  const short = createReviewService({ apiKey: "test", perMinute: 1, cacheTtlMs: 500, now: () => now, call: async () => { calls++; return { ok: false, code: "http", elapsedMs: 1 }; } });
  await short(input);
  assert.deepEqual(await short(input), { limited: true });
  now += 60_001; await short(input);
  assert.equal(calls, 2);
  const expiring = createReviewService({ apiKey: "test", cacheTtlMs: 500, now: () => now, call: async () => { calls++; return confirmed; } });
  await expiring(input); now += 501; await expiring(input);
  assert.equal(calls, 4);
});
