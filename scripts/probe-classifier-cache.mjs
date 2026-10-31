import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildClassifierRequest, DEFAULT_MODEL } from "../lib/classifier.ts";
import { tokenCost } from "./eval-metrics.mjs";

const ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_COST = .01;
const MESSAGES = [
  "Как устроиться на работу в игре?",
  "Ойында полицияға қалай кіруге болады?",
  "O‘yinda mashinani qayerdan sotib olaman?",
  "Где посмотреть игровые правила?",
];
const hash = value => createHash("sha256").update(value).digest("hex");
const safeError = error => ["TimeoutError", "AbortError", "TypeError", "SyntaxError"].includes(error?.name) ? error.name : "RequestError";

// Count endpoint accepts only its documented input/model/settings fields.
// Static/full totals include formatting/schema; the empty baseline provides
// a useful conservative text delta, not proof of cache eligibility by itself.
export function buildCountRequests(prompt, cacheMode) {
  const extract = body => Object.fromEntries(["model", "instructions", "input", "reasoning", "text"].filter(key => body[key] !== undefined).map(key => [key, body[key]]));
  const prefix = body => ({ ...body, input: body.input.filter(item => item.role !== "user") });
  const full = buildClassifierRequest(prompt, MESSAGES[0], cacheMode, DEFAULT_MODEL);
  // The count API requires at least one input item: legacy instructions plus
  // input:[] returned missing_required_parameter. Count only its static text
  // in a developer item, with the same representation for the empty baseline.
  // The full legacy count and every generation retain the production shape.
  const staticBody = cacheMode === "legacy_implicit" ? buildClassifierRequest(prompt, MESSAGES[0], "explicit_static", DEFAULT_MODEL) : full;
  const empty = buildClassifierRequest("", MESSAGES[0], "explicit_static", DEFAULT_MODEL);
  return { prefix: extract(prefix(staticBody)), full: extract(full), empty_baseline: extract(prefix(empty)) };
}

export async function runCacheProbe({ prompt, cacheMode = "explicit_static", apiKey, countOnly = false, fetcher = fetch, onProgress = () => {} }) {
  if (typeof prompt !== "string" || !prompt.trim() || !["legacy_implicit", "explicit_static"].includes(cacheMode)) throw new Error("Invalid frozen probe configuration");
  if (!apiKey?.trim()) throw new Error("API key required for an explicitly requested probe");
  const rows = [];
  let stopped = null, known = 0, unknownReserve = 0;
  const requests = countOnly ? Object.entries(buildCountRequests(prompt, cacheMode))
    : MESSAGES.map((message, index) => [`synthetic_${index + 1}`, buildClassifierRequest(prompt, message, cacheMode, DEFAULT_MODEL)]);
  for (const [scope, body] of requests) {
    const encoded = JSON.stringify(body);
    const inputBound = Buffer.byteLength(encoded, "utf8") + 1024;
    const reserve = countOnly ? null : tokenCost({ input_tokens: inputBound, output_tokens: 200, cached_input_tokens: 0, cache_write_input_tokens: inputBound }, DEFAULT_MODEL);
    if (!countOnly && known + unknownReserve + reserve > MAX_COST) { stopped = "budget_limit"; break; }
    const row = { scope, attempted: true, usage: null, cost_usd: null, reserved_upper_usd: reserve };
    const start = performance.now();
    try {
      const response = await fetcher(countOnly ? `${ENDPOINT}/input_tokens` : ENDPOINT, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(4500),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: encoded,
      });
      row.http_status = response.status;
      const data = await response.json();
      if (!response.ok) {
        if (typeof data.error?.code === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(data.error.code)) row.error_code = data.error.code;
        stopped = [401, 403, 429].includes(response.status) ? "quota_or_access_error" : "http_error";
      } else if (countOnly) {
        if (!Number.isSafeInteger(data.input_tokens) || data.input_tokens < 0) throw new Error("Invalid token count");
        row.input_tokens = data.input_tokens;
      } else {
        row.response_status = data.status === "completed" ? "completed" : "incomplete";
        if (data.usage) {
          row.usage = { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens,
            cached_input_tokens: data.usage.input_tokens_details?.cached_tokens ?? 0,
            cache_write_input_tokens: data.usage.input_tokens_details?.cache_write_tokens ?? 0 };
          try { row.cost_usd = tokenCost(row.usage, DEFAULT_MODEL); }
          catch { row.usage = null; row.error_name = "InvalidUsage"; stopped = "invalid_usage"; }
        }
        if (row.cost_usd === null) stopped ||= "unknown_usage";
        else if (row.cost_usd > reserve) stopped = "cost_bound_exceeded";
        else if (data.status !== "completed") stopped = "incomplete_response";
      }
    } catch (error) { row.error_name = safeError(error); stopped = "request_error"; }
    row.latency_ms = Math.round(performance.now() - start);
    if (!countOnly) {
      if (row.cost_usd === null) unknownReserve += reserve;
      else known += row.cost_usd;
    }
    rows.push(row);
    onProgress({ scope, http_status: row.http_status ?? null, status: stopped ? "stopped" : "ok" });
    if (stopped) break;
  }
  const byScope = Object.fromEntries(rows.map(row => [row.scope, row.input_tokens ?? null]));
  const observed = rows.filter(row => row.usage);
  const input = observed.reduce((sum, row) => sum + row.usage.input_tokens, 0);
  const cached = observed.reduce((sum, row) => sum + row.usage.cached_input_tokens, 0);
  return {
    status: stopped ? "stopped" : "completed", stop_reason: stopped,
    mode: countOnly ? "input_token_count_only" : "synthetic_generation_probe",
    model: DEFAULT_MODEL, cache_mode: cacheMode, prompt_sha256: hash(prompt),
    configuration: { service_tier: "default", reasoning: "none", max_output_tokens: 200, store: false, web_search: false, retries: 0,
      local_cache: "bypassed; four distinct synthetic messages through shared request builder", ttl: cacheMode === "explicit_static" ? "30m" : "provider_default" },
    api_attempts: rows.length, generation_attempts: countOnly ? 0 : rows.length,
    counts: countOnly ? { ...byScope,
      representations: {
        prefix: cacheMode === "legacy_implicit" ? "legacy_text_represented_as_developer_item_for_count_only" : "production_developer_prefix",
        full: cacheMode === "legacy_implicit" ? "production_legacy_instructions_and_user_item" : "production_developer_and_user_items",
        empty_baseline: "empty_developer_item_with_same_schema",
      },
      visible_text_delta_estimate: byScope.prefix != null && byScope.empty_baseline != null ? Math.max(0, byScope.prefix - byScope.empty_baseline) : null,
      minimum_visible_cache_prefix: 1024,
      note: "Count endpoint generates no completion. Legacy prefix/empty baseline use a developer-item diagnostic representation; full retains production legacy shape. This does not change generation or measure the exact legacy serialized prefix. Totals include formatting/schema; neither total alone proves eligible visible prefix. Endpoint billing is not asserted to be free.",
    } : null,
    cache: countOnly ? null : { calls_with_cache_read: observed.filter(row => row.usage.cached_input_tokens > 0).length,
      calls_with_cache_write: observed.filter(row => row.usage.cache_write_input_tokens > 0).length,
      input_tokens: input, cached_input_tokens: cached, cached_share: input ? cached / input : null,
      cache_write_input_tokens: observed.reduce((sum, row) => sum + row.usage.cache_write_input_tokens, 0),
      output_tokens: observed.reduce((sum, row) => sum + row.usage.output_tokens, 0) },
    budget: countOnly ? null : { limit_usd: MAX_COST, known_lower_usd: known, conservative_upper_usd: known + unknownReserve,
      unknown_attempts: rows.filter(row => row.cost_usd === null).length, total_usd: unknownReserve ? null : known },
    rows,
    interpretation: "Synthetic cache diagnostics only; does not measure classification accuracy or guarantee production cache hit rates.",
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  if (!value("--prompt") || !value("--output")) throw new Error("Required --prompt MD --output DIR [--cache-mode MODE] [--count-only | --live]");
  if (args.includes("--count-only") && args.includes("--live")) throw new Error("Choose one probe mode");
  const cacheMode = value("--cache-mode") || "explicit_static";
  const prompt = readFileSync(resolve(value("--prompt")), "utf8");
  if (!["legacy_implicit", "explicit_static"].includes(cacheMode)) throw new Error("Unsupported cache mode");
  if (!args.includes("--live") && !args.includes("--count-only")) {
    console.log(JSON.stringify({ dry_run: true, api_calls: 0, model: DEFAULT_MODEL, cache_mode: cacheMode, prompt_sha256: hash(prompt), max_generation_calls: 4, max_cost_usd: MAX_COST })); return;
  }
  const output = resolve(value("--output"));
  mkdirSync(output, { recursive: true });
  const path = join(output, "cache-probe.json");
  writeFileSync(path, "", { flag: "wx" });
  const summary = await runCacheProbe({ prompt, cacheMode, apiKey: process.env.OPENAI_API_KEY, countOnly: args.includes("--count-only"),
    onProgress: progress => console.log(JSON.stringify(progress)) });
  writeFileSync(path, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ status: summary.status, api_attempts: summary.api_attempts, counts: summary.counts, cache: summary.cache, budget: summary.budget, output: path }));
  if (summary.status !== "completed") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  console.error(JSON.stringify({ status: "stopped", reason: "probe_setup_or_local_error" })); process.exitCode = 1;
});
