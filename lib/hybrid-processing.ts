import { processMessageWithTrace } from "./message-processing.ts";
import { routeLabels, ROUTING_SCHEMA } from "./message-routes.ts";
import { requestReview, validateReviewDecision } from "./ai-review-client.ts";
import type { ReviewCandidate, ReviewContext, ReviewResult } from "./ai-review-client.ts";
import type { ClarificationContext, ProcessingStep, ProcessingTrace, Status } from "./message-types.ts";

export const HYBRID_VERSION = "hybrid-review-2-explicit";
export type ReviewInput = { original: string; candidate: ReviewCandidate; context?: ReviewContext };
type CheckedReview = { result: ReviewResult; cached: boolean } | { limited: true };
export type Reviewer = (input: ReviewInput) => Promise<CheckedReview>;
type Processed = ReturnType<typeof processMessageWithTrace>;

export function reviewCandidate(original: string, processed: Processed): ReviewCandidate {
  return {
    category: processed.processing.route ?? "undetermined",
    ...(processed.text !== original ? { corrected_text: processed.text } : {}),
    needs_clarification: processed.processing.needsClarification ?? false,
    ...(processed.processing.followUp ? { follow_up: processed.processing.followUp } : {}),
  };
}

/** Process rules once, then let a verifier accept or replace their result. Never modify rules. */
export async function processHybridMessage(original: string, context?: ClarificationContext, reviewer?: Reviewer) {
  const processed = processMessageWithTrace(original, context);
  const trace = processed.processing;
  let review: ProcessingTrace["aiReview"] = { outcome: "disabled", promptVersion: HYBRID_VERSION };
  let response: ReviewResult | undefined;
  if (reviewer) {
    try {
      const checked = await reviewer({ original, candidate: reviewCandidate(original, processed), ...(context ? {
        context: { parent_category: context.parentRoute ?? "undetermined", question: context.question },
      } : {}) });
      if ("limited" in checked) review = { ...review, outcome: "limited" };
      else {
        response = checked.result;
        if (response.ok && !validateReviewDecision(response.decision)) response = { ok: false, code: "invalid", elapsedMs: response.elapsedMs };
        review = response.ok ? {
          ...review, outcome: response.decision.ok ? "confirmed" : "replaced", model: response.model,
          ...(response.decision.reason ? { reason: response.decision.reason } : {}),
          cached: checked.cached, elapsedMs: response.elapsedMs,
          // A local cache hit has no new provider usage. Keep zeroes to avoid double billing in reports.
          usage: checked.cached ? { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 } : response.usage,
        } : { ...review, outcome: "unavailable", errorCode: response.code, elapsedMs: response.elapsedMs };
      }
    } catch { review = { ...review, outcome: "unavailable", errorCode: "network" }; }
  }
  const algorithm: NonNullable<ProcessingTrace["algorithm"]> = {
    text: processed.text, route: trace.route ?? null, needsClarification: !!trace.needsClarification,
    followUp: trace.followUp, version: trace.version, ruleId: trace.ruleId,
    reason: trace.steps.find(step => step.id === "rules" || step.id === "classified")?.detail,
  };
  const correction = response?.ok && !response.decision.ok ? response.decision.correction : null;
  const text = correction?.corrected_text ?? processed.text;
  const route = correction ? correction.category === "undetermined" ? null : correction.category : trace.route ?? null;
  const status: Status = route === "violation" ? "violation" : route === "trash" ? "trash" : "pending";
  // AI replacements must not inherit rule evidence, topics or missing details as if the AI validated them.
  const finalTrace: ProcessingTrace = correction ? {
    classification: route === "violation" ? "violation" : route === "trash" ? "trash" : correction.needs_clarification ? "clarify" : "report",
    route, routingSchema: ROUTING_SCHEMA, needsClarification: correction.needs_clarification,
    missingDetails: [], followUp: correction.follow_up ?? undefined,
    answerReadiness: "not_evaluated", context, version: HYBRID_VERSION, decisionSource: "ai", steps: [],
  } : { ...trace };
  const reviewText = {
    confirmed: "ИИ подтвердил результат алгоритма", replaced: "ИИ исправил результат алгоритма",
    unavailable: "ИИ недоступен — результат не проверен", disabled: "ИИ не подключён — результат не проверен",
    limited: "Лимит проверки ИИ — результат не проверен",
  }[review.outcome];
  const initialSteps: ProcessingStep[] = trace.steps
    .filter(step => !["classified", "routed", "details"].includes(step.id))
    .map(step => step.id === "received" ? step : { ...step, title: `Алгоритм: ${step.title.toLocaleLowerCase("ru")}` });
  initialSteps.push({ id: "algorithm-result", title: "Результат алгоритма", value: algorithm.route ? routeLabels[algorithm.route] : "Не определено", detail: algorithm.reason });
  const steps: ProcessingStep[] = [
    ...initialSteps,
    { id: "ai-review", title: "Проверка ИИ", value: reviewText, detail: review.reason },
    ...(correction ? [{ id: "ai-text" as const, title: "Текст после проверки ИИ", value: text }] : []),
    { id: "classified", title: "Итоговая категория", value: route ? routeLabels[route] : "Не определено", detail: review.reason ?? (correction ? "Решение ИИ после проверки исходного сообщения" : algorithm.reason) },
    ...(finalTrace.followUp ? [{ id: "details" as const, title: "Что уточнить", value: finalTrace.followUp }] : []),
    { id: "routed", title: "Куда отправлено", value: route === "violation" ? "В раздел «Нарушения»" : route === "trash" ? "В корзину" : route === null ? "В раздел «Не определено»" : route === "question" ? "В раздел «Вопросы»" : "В раздел «Помощь»" },
  ];
  return { text, status, corrected: text !== original.trim(), processing: { ...finalTrace, algorithm, aiReview: review, steps } };
}

/** Limits and cache are per worker process. They reset on restart and are not a distributed quota. */
export function createReviewService(options: {
  apiKey: string; maxCalls?: number; perMinute?: number; concurrency?: number; cacheTtlMs?: number;
  call?: typeof requestReview; now?: () => number;
}): Reviewer {
  const call = options.call ?? requestReview, now = options.now ?? Date.now;
  const maxCalls = Math.min(1000, Math.max(0, options.maxCalls ?? 200));
  const minuteLimit = Math.min(60, Math.max(0, options.perMinute ?? 20));
  const concurrency = Math.min(8, Math.max(1, options.concurrency ?? 4));
  const cacheTtl = options.cacheTtlMs ?? 600_000;
  const pending = new Map<string, Promise<ReviewResult>>();
  const cache = new Map<string, { until: number; result: ReviewResult }>();
  let calls = 0;
  let times: number[] = [];
  return async input => {
    const key = JSON.stringify([HYBRID_VERSION, input.original, input.candidate, input.context]);
    const time = now();
    const hit = cache.get(key);
    if (hit && hit.until > time) return { result: hit.result, cached: true };
    if (hit) cache.delete(key);
    const underway = pending.get(key);
    if (underway) return { result: await underway, cached: true };
    times = times.filter(stamp => stamp > time - 60_000);
    if (calls >= maxCalls || times.length >= minuteLimit || pending.size >= concurrency) return { limited: true };
    calls++; times.push(time);
    const work = Promise.resolve().then(() => call({ ...input, apiKey: options.apiKey }));
    pending.set(key, work);
    try {
      const result = await work;
      if (result.ok) {
        if (cache.size >= 128) cache.delete(cache.keys().next().value!);
        cache.set(key, { until: now() + cacheTtl, result });
      }
      return { result, cached: false };
    } finally { pending.delete(key); }
  };
}
