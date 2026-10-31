import { AI_REVIEW_PROMPT } from "./ai-review-prompt.ts";

const REVIEW_MODEL = "gpt-6-luna";
const CATEGORIES = ["question", "help", "violation", "trash", "undetermined"] as const;
const MAX_ORIGINAL_LENGTH = 2000;
const MAX_CORRECTED_LENGTH = 6000;
const MAX_SHORT_LENGTH = 300;

export type ReviewCategory = typeof CATEGORIES[number];
export type ReviewCandidate = {
  category: ReviewCategory;
  corrected_text?: string;
  needs_clarification: boolean;
  follow_up?: string;
  urgency?: 'now' | 'high' | 'normal' | null;
  knowledge_id?: string | null;
};
export type ReviewVerifiedAnswer = { id: string; title: string; answer: string; source: { title: string; version: string; ref?: string }; questionKind?: 'definition' | 'permission'; requiredTerms?: string[]; excludedTerms?: string[] };
export type ReviewContext = { parent_category?: ReviewCategory; question?: string };
export type ReviewDecision = {
  ok: boolean;
  correction: null | {
    category: ReviewCategory;
    corrected_text: string;
    needs_clarification: boolean;
    follow_up: string | null;
    urgency?: 'now' | 'high' | 'normal' | null;
    knowledge_id?: string | null;
  };
  reason: string | null;
};
export type ReviewResult =
  | {
    ok: true;
    decision: ReviewDecision;
    model: string;
    usage: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number };
    elapsedMs: number;
  }
  | { ok: false; code: "timeout" | "network" | "http" | "invalid" | "refusal"; elapsedMs: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCategory(value: unknown): value is ReviewCategory {
  return typeof value === "string" && CATEGORIES.includes(value as ReviewCategory);
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Reject incomplete or inconsistent decisions before they can replace the algorithm result. */
export function validateReviewDecision(value: unknown): value is ReviewDecision {
  if (!isRecord(value) || !exactKeys(value, ["ok", "correction", "reason"]) || typeof value.ok !== "boolean") return false;
  if (value.ok) return value.correction === null && value.reason === null;
  if (value.reason !== null && !boundedText(value.reason, MAX_SHORT_LENGTH)) return false;
  const correction = value.correction;
  if (!isRecord(correction) || !(exactKeys(correction, ["category", "corrected_text", "needs_clarification", "follow_up"]) || exactKeys(correction, ["category", "corrected_text", "needs_clarification", "follow_up", "urgency", "knowledge_id"]))) return false;
  if (!isCategory(correction.category) || !boundedText(correction.corrected_text, MAX_CORRECTED_LENGTH) || typeof correction.needs_clarification !== "boolean") return false;
  if (correction.urgency !== undefined && correction.urgency !== null && (correction.category !== 'help' || !['now', 'high', 'normal'].includes(String(correction.urgency)))) return false;
  if (correction.knowledge_id !== undefined && correction.knowledge_id !== null && (correction.category !== 'question' || correction.needs_clarification || !boundedText(correction.knowledge_id, 160))) return false;
  if (correction.category === "undetermined" && !correction.needs_clarification) return false;
  return correction.needs_clarification
    ? boundedText(correction.follow_up, MAX_SHORT_LENGTH)
    : correction.follow_up === null;
}

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "correction", "reason"],
  properties: {
    ok: { type: "boolean" },
    correction: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["category", "corrected_text", "needs_clarification", "follow_up", "urgency", "knowledge_id"],
          properties: {
            category: { type: "string", enum: [...CATEGORIES] },
            corrected_text: { type: "string", minLength: 1, maxLength: MAX_CORRECTED_LENGTH },
            needs_clarification: { type: "boolean" },
            follow_up: { type: ["string", "null"], maxLength: MAX_SHORT_LENGTH },
            urgency: { type: ['string', 'null'], enum: ['now', 'high', 'normal', null] },
            knowledge_id: { type: ['string', 'null'], maxLength: 160 },
          },
        },
      ],
    },
    reason: { type: ["string", "null"], maxLength: MAX_SHORT_LENGTH },
  },
};

/** Builds a request without credentials. Only explicitly allowed data fields cross the API boundary. */
export function buildReviewRequest(original: string, candidate: ReviewCandidate, context?: ReviewContext, options: { model?: string; verifiedAnswers?: readonly ReviewVerifiedAnswer[] } = {}) {
  if (!boundedText(original, MAX_ORIGINAL_LENGTH) || !isRecord(candidate) || !isCategory(candidate.category) || typeof candidate.needs_clarification !== "boolean") {
    throw new TypeError("Invalid review input");
  }
  if (candidate.corrected_text !== undefined && !boundedText(candidate.corrected_text, MAX_CORRECTED_LENGTH)) throw new TypeError("Invalid review candidate");
  if (candidate.follow_up !== undefined && !boundedText(candidate.follow_up, MAX_SHORT_LENGTH)) throw new TypeError("Invalid review candidate");
  if (options.model !== undefined && !/^gpt-[a-z0-9][a-z0-9.-]{0,79}$/u.test(options.model)) throw new TypeError('Invalid review model');
  if (candidate.urgency !== undefined && candidate.urgency !== null && !['now', 'high', 'normal'].includes(candidate.urgency)) throw new TypeError('Invalid review urgency');
  if (candidate.knowledge_id !== undefined && candidate.knowledge_id !== null && !boundedText(candidate.knowledge_id, 160)) throw new TypeError('Invalid review knowledge');
  if (options.verifiedAnswers && (options.verifiedAnswers.length > 8 || options.verifiedAnswers.some(entry => !boundedText(entry.id, 160) || !boundedText(entry.title, 160) || !boundedText(entry.answer, 4000) || !boundedText(entry.source?.title, 300) || !boundedText(entry.source?.version, 100)))) throw new TypeError('Invalid verified answers');
  if (context !== undefined && (!isRecord(context)
    || (context.parent_category !== undefined && !isCategory(context.parent_category))
    || (context.question !== undefined && !boundedText(context.question, MAX_ORIGINAL_LENGTH)))) throw new TypeError("Invalid review context");

  const compactCandidate: ReviewCandidate = {
    category: candidate.category,
    corrected_text: candidate.corrected_text ?? original,
    needs_clarification: candidate.needs_clarification,
    ...(candidate.follow_up !== undefined ? { follow_up: candidate.follow_up } : {}),
    ...(candidate.urgency !== undefined ? { urgency: candidate.urgency } : {}),
    ...(candidate.knowledge_id !== undefined ? { knowledge_id: candidate.knowledge_id } : {}),
  };
  const compactContext = context ? {
    ...(context.parent_category !== undefined ? { parent_category: context.parent_category } : {}),
    ...(context.question !== undefined ? { question: context.question } : {}),
  } : undefined;

  return {
    model: options.model ?? REVIEW_MODEL,
    store: false,
    reasoning: { effort: "none" },
    prompt_cache_options: { mode: "explicit", ttl: "30m" },
    // Leave room for a full Russian replacement, even when translation expands the original.
    max_output_tokens: Math.min(2000, Math.max(384, Math.ceil(original.length * 0.8) + 400)),
    input: [
      {
        role: "developer",
        content: [{ type: "input_text", text: AI_REVIEW_PROMPT, prompt_cache_breakpoint: { mode: "explicit" } }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify({ original, candidate: compactCandidate, ...(compactContext && Object.keys(compactContext).length ? { context: compactContext } : {}), ...(options.verifiedAnswers ? { verified_answers: options.verifiedAnswers.map(entry => ({ id: entry.id, title: entry.title, answer: entry.answer, source: { title: entry.source.title, version: entry.source.version, ...(entry.source.ref ? { ref: entry.source.ref.slice(0, 160) } : {}) }, questionKind: entry.questionKind ?? 'definition', requiredTerms: (entry.requiredTerms ?? []).slice(0, 80).map(term => term.slice(0, 300)), excludedTerms: (entry.excludedTerms ?? []).slice(0, 80).map(term => term.slice(0, 300)) })) } : {}) }) }],
      },
    ] as const,
    text: { format: { type: "json_schema", name: "support_candidate_review", strict: true, schema: REVIEW_SCHEMA } },
  };
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

type FailureCode = Extract<ReviewResult, { ok: false }>["code"];

/** Makes one bounded request. Failures intentionally exclude provider bodies, headers and exceptions. */
export async function requestReview({ original, candidate, context, apiKey, model, verifiedAnswers, fetcher = fetch, timeoutMs = 12_000 }: {
  original: string;
  candidate: ReviewCandidate;
  context?: ReviewContext;
  apiKey: string;
  model?: string;
  verifiedAnswers?: readonly ReviewVerifiedAnswer[];
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<ReviewResult> {
  const started = performance.now();
  const elapsedMs = () => Math.max(0, Math.round(performance.now() - started));
  const failure = (code: FailureCode): ReviewResult => ({ ok: false, code, elapsedMs: elapsedMs() });
  let request: ReturnType<typeof buildReviewRequest>;
  try {
    if (!boundedText(apiKey, 4096) || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) return failure("invalid");
    request = buildReviewRequest(original, candidate, context, { model, verifiedAnswers });
  } catch {
    return failure("invalid");
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReviewResult>(resolve => {
    timer = setTimeout(() => {
      resolve(failure("timeout"));
      controller.abort();
    }, timeoutMs);
  });

  const perform = async (): Promise<ReviewResult> => {
    let response: Response;
    try {
      response = await fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(request),
        signal: controller.signal,
        // Workers supports manual, not error. Never follow Location or forward the API key.
        redirect: "manual",
      });
    } catch {
      return failure("network");
    }
    if (!response.ok) return failure("http");
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return failure("invalid");
    }
    if (!isRecord(body) || !Array.isArray(body.output)) return failure("invalid");
    const messages = body.output.filter(isRecord);
    if (messages.some(item => Array.isArray(item.content) && item.content.some(part => isRecord(part) && part.type === "refusal"))) return failure("refusal");
    if (body.status !== "completed" || body.error != null || body.incomplete_details != null) return failure("invalid");
    const textParts: string[] = [];
    for (const item of body.output) {
      if (!isRecord(item)) return failure("invalid");
      if (item.type === "reasoning") continue;
      if (item.type !== "message" || item.role !== "assistant" || item.status !== "completed" || !Array.isArray(item.content)) return failure("invalid");
      for (const part of item.content) {
        if (!isRecord(part) || part.type !== "output_text" || typeof part.text !== "string") return failure("invalid");
        textParts.push(part.text);
      }
    }
    // A second answer or partial JSON must never silently override the first answer.
    if (textParts.length !== 1 || textParts[0].length > 50_000) return failure("invalid");
    let decision: unknown;
    try {
      decision = JSON.parse(textParts[0]);
    } catch {
      return failure("invalid");
    }
    if (!validateReviewDecision(decision)) return failure("invalid");
    const selectedKnowledgeId = decision.ok ? candidate.knowledge_id : decision.correction?.knowledge_id;
    if (selectedKnowledgeId && verifiedAnswers && !verifiedAnswers.some(entry => entry.id === selectedKnowledgeId)) return failure('invalid');
    if (decision.ok && !validateReviewDecision({
      ok: false,
      correction: {
        category: candidate.category,
        corrected_text: candidate.corrected_text ?? original,
        needs_clarification: candidate.needs_clarification,
        follow_up: candidate.follow_up ?? null,
      },
      reason: null,
    })) return failure("invalid");
    const usage = isRecord(body.usage) ? body.usage : {};
    const details = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
    const writeDetails = isRecord(details.cache_write_tokens_details) ? details.cache_write_tokens_details : {};
    return {
      ok: true,
      decision,
      model: boundedText(body.model, 100) ? body.model : model ?? REVIEW_MODEL,
      usage: {
        inputTokens: tokenCount(usage.input_tokens),
        outputTokens: tokenCount(usage.output_tokens),
        cachedTokens: tokenCount(details.cached_tokens),
        cacheWriteTokens: details.cache_write_tokens === undefined
          ? tokenCount(writeDetails.ttl_30m_tokens) + tokenCount(writeDetails.ttl_12h_tokens)
          : tokenCount(details.cache_write_tokens),
      },
      elapsedMs: elapsedMs(),
    };
  };

  try {
    return await Promise.race([perform(), timeout]);
  } catch {
    return failure("invalid");
  } finally {
    clearTimeout(timer);
  }
}
