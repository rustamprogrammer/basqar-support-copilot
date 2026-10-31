// Server-only API adapter. Linguistic decisions come from classifier-prompt.md.
import { selectGlossaryHints } from "./glossary-hints.ts";
export const BOXES = ["question", "complaint", "violation"] as const;
export type Box = typeof BOXES[number];
export type Classification = { meaning_ru: string; box: Box; needs_human: boolean };
export type ClassificationRun = {
  result: Classification;
  source: "model" | "cache" | "fallback";
  model: string;
  note: string;
  sources: { url: string; title: string }[];
  web_search_calls: number;
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens: number; cache_write_input_tokens?: number } | null;
};
export const DEFAULT_MODEL = "gpt-6-luna";
export type CacheMode = "legacy_implicit" | "explicit_static";
const schema = {
  type: "object", additionalProperties: false,
  properties: { meaning_ru: { type: "string" }, box: { type: "string", enum: [...BOXES] }, needs_human: { type: "boolean" } },
  required: ["meaning_ru", "box", "needs_human"],
};
export function validateClassification(value: unknown): Classification {
  if (!value || typeof value !== "object") throw new Error("Invalid classification");
  const r = value as Classification;
  if (!BOXES.includes(r.box) || typeof r.needs_human !== "boolean" || typeof r.meaning_ru !== "string"
    || !r.meaning_ru.trim() || r.meaning_ru.length > 1000) throw new Error("Invalid classification");
  return { meaning_ru: r.meaning_ru, box: r.box, needs_human: r.needs_human };
}
// The only cached prefix is the shared instruction/schema. Player text and
// selected glossary hints follow it and never receive a cache-write marker.
export function buildClassifierRequest(prompt: string, original: string, cacheMode: CacheMode = "explicit_static", model: string = DEFAULT_MODEL) {
  if (model !== DEFAULT_MODEL) throw new Error("Expected gpt-6-luna; other models require separate evaluation");
  if (cacheMode !== "legacy_implicit" && cacheMode !== "explicit_static") throw new Error("Unsupported cache mode");
  const player = { role: "user", content: JSON.stringify({ original, glossary: selectGlossaryHints(original) }) };
  return {
    model, store: false, service_tier: "default",
    ...(cacheMode === "legacy_implicit" ? { instructions: prompt, input: [player] } : {
      prompt_cache_options: { mode: "explicit", ttl: "30m" },
      input: [{ role: "developer", content: [{ type: "input_text", text: prompt,
        prompt_cache_breakpoint: { mode: "explicit" } }] }, player],
    }),
    reasoning: { effort: "none" }, max_output_tokens: 200,
    text: { format: { type: "json_schema", name: "grand_classifier", strict: true, schema } },
  };
}
type Options = { prompt: string; apiKey?: string; model?: string; cacheMode?: CacheMode; enabled?: boolean; fetcher?: typeof fetch; now?: () => number };
export function createClassifier(options: Options) {
  if (!options.prompt.trim()) throw new Error("Classifier prompt is required");
  const model = options.model || DEFAULT_MODEL;
  if (model !== DEFAULT_MODEL) throw new Error("Expected gpt-6-luna; other models require separate evaluation");
  const cacheMode = options.cacheMode || "explicit_static";
  if (cacheMode !== "legacy_implicit" && cacheMode !== "explicit_static") throw new Error("Unsupported cache mode");
  const now = options.now || Date.now;
  const cache = new Map<string, { until: number; run: ClassificationRun }>();
  const pending = new Map<string, Promise<ClassificationRun>>();
  let windowStart = now(), calls = 0;
  const fallback = (note: string, usage: ClassificationRun["usage"] = null): ClassificationRun => ({
    result: { meaning_ru: "Нужна ручная проверка исходного сообщения.", box: "complaint", needs_human: true },
    source: "fallback", model, note, sources: [], web_search_calls: 0, usage,
  });
  return async (original: string): Promise<ClassificationRun> => {
    if (!original.trim() || original.length > 2000) throw new Error("Expected 1–2000 characters");
    if (!options.enabled || !options.apiKey?.trim()) return fallback("ИИ не подключён: обращение сохранено для ручной проверки.");
    const key = original.trim();
    const hit = cache.get(key);
    if (hit && hit.until > now()) return { ...structuredClone(hit.run), source: "cache", usage: null, web_search_calls: 0 };
    const active = pending.get(key);
    if (active) { const run = await active; return run.source === "model" ? { ...structuredClone(run), source: "cache", usage: null, web_search_calls: 0 } : structuredClone(run); }
    if (now() - windowStart >= 60_000) { windowStart = now(); calls = 0; }
    if (calls >= 30) return fallback("Лимит запросов достигнут: нужна ручная проверка.");
    calls++;
    const request = (async (): Promise<ClassificationRun> => {
      let usage: ClassificationRun["usage"] = null;
      try {
        const response = await (options.fetcher || fetch)("https://api.openai.com/v1/responses", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(4500),
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(buildClassifierRequest(options.prompt, original, cacheMode, model)),
        });
        if (!response.ok) return fallback(response.status === 401 ? "OpenAI отклонил ключ. Проверьте OPENAI_API_KEY."
          : response.status === 403 ? "Нет доступа к модели OpenAI: проверьте права проекта и ключа."
          : response.status === 429 ? "OpenAI: превышен лимит или исчерпан баланс."
          : "OpenAI недоступен; нужна ручная проверка.");
        const data = await response.json() as {
          status?: string;
          output?: { type: string; content?: { type: string; text?: string }[] }[];
          usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } };
        };
        if (data.usage) usage = { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens,
          cached_input_tokens: data.usage.input_tokens_details?.cached_tokens || 0,
          cache_write_input_tokens: data.usage.input_tokens_details?.cache_write_tokens || 0 };
        if (data.status !== "completed") throw new Error("Incomplete response");
        const content = (data.output || []).filter(o => o.type === "message").flatMap(o => o.content || []);
        if (content.some(c => c.type === "refusal")) throw new Error("Refusal");
        const result = validateClassification(JSON.parse(content.filter(c => c.type === "output_text").map(c => c.text || "").join("")));
        const run: ClassificationRun = { result, source: "model", model, sources: [], web_search_calls: 0, usage,
          note: "Обработано по инструкции Grand Mobile и локальному словарю, без веб-поиска." };
        if (cache.size >= 256) cache.delete(cache.keys().next().value!);
        cache.set(key, { until: now() + 600_000, run: structuredClone(run) });
        return run;
      } catch { return fallback("Автоматическая обработка не завершилась; нужна ручная проверка.", usage); }
    })();
    pending.set(key, request);
    try { return await request; } finally { pending.delete(key); }
  };
}
