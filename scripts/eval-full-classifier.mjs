// Full local evaluation of the current server request on a fixed, unlabeled sample.
// Prints aggregates only; raw player text remains in the private input file.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { buildClassifierRequest, validateClassification } from "../lib/classifier.ts";
import { tokenCost } from "./eval-metrics.mjs";

const args = process.argv.slice(2);
const arg = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const inputPath = resolve(arg("--input", ""));
const out = resolve(arg("--output", ""));
const promptPath = resolve(arg("--prompt", "classifier-prompt.md"));
if (!args.includes("--input") || !args.includes("--output")) throw new Error("Require --input and --output");
const sampleBytes = readFileSync(inputPath);
const sample = sampleBytes.toString("utf8").trim().split(/\r?\n/).map(JSON.parse);
if (sample.length !== 1299 || sample.some(r => typeof r.id !== "string" || typeof r.text !== "string" ||
  !r.text.trim() || r.text.length > 2000 || r.expected_box !== null))
  throw new Error("Expected all 1299 unlabeled tickets with valid player text");
const prompt = readFileSync(promptPath, "utf8");
const groups = new Map();
for (const row of sample) {
  const key = row.text.trim();
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
const unique = [...groups.entries()];
const hash = value => createHash("sha256").update(value).digest("hex");
const MAX_USD = 0.20;
const CONCURRENCY = 6;
const MAX_UNKNOWN = 5;
const key = process.env.OPENAI_API_KEY?.trim();
if (args.includes("--live") && !key) throw new Error("Missing OPENAI_API_KEY");
mkdirSync(out, { recursive: true });
const metadata = { input_sha256: hash(sampleBytes), prompt_sha256: hash(prompt), sample_rows: sample.length,
  unique_texts: unique.length, model: "gpt-6-luna", cache_mode: "explicit_static", service_tier: "default",
  concurrency: CONCURRENCY, max_known_plus_pending_reserve_usd: MAX_USD, no_gold_labels: true,
  no_retry: true, source: inputPath, started_at: new Date().toISOString() };
writeFileSync(join(out, "metadata.json"), JSON.stringify(metadata, null, 2), { flag: "wx" });
if (!args.includes("--live")) {
  console.log(JSON.stringify({ dry_run: true, rows: sample.length, unique_texts: unique.length, api_calls: 0, output: out }));
  process.exit(0);
}

const results = new Map();
let cursor = 0, attempts = 0, knownUsd = 0, unknownReserve = 0, pendingReserve = 0, stopReason = null;
const iso = () => new Date().toISOString();
function reservation(body) {
  const bound = Buffer.byteLength(body, "utf8") + 1024;
  return tokenCost({ input_tokens: bound, output_tokens: 200, cached_input_tokens: 0,
    cache_write_input_tokens: bound }, "gpt-6-luna");
}
function nextTask() {
  if (stopReason || cursor >= unique.length) return null;
  const [message, rows] = unique[cursor];
  const body = JSON.stringify(buildClassifierRequest(prompt, rows[0].text));
  const reserve = reservation(body);
  if (knownUsd + unknownReserve + pendingReserve + reserve > MAX_USD) {
    stopReason = "budget_cap";
    return null;
  }
  cursor++;
  pendingReserve += reserve;
  attempts++;
  return { message, body, reserve };
}
async function worker() {
  while (true) {
    const task = nextTask();
    if (!task) return;
    const start = performance.now();
    let result = { source: "fallback", predicted_box: null, needs_human: true,
      usage: null, latency_ms: 0, status: null, error: null };
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(4500),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: task.body,
      });
      result.status = response.status;
      const data = await response.json();
      if (data.usage) result.usage = {
        input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens,
        cached_input_tokens: data.usage.input_tokens_details?.cached_tokens || 0,
        cache_write_input_tokens: data.usage.input_tokens_details?.cache_write_tokens || 0,
      };
      if (!response.ok) {
        result.error = typeof data.error?.code === "string" ? data.error.code.slice(0, 80) : `HTTP_${response.status}`;
        if ([401, 403].includes(response.status) || (response.status === 429 && result.error !== "slow_down"))
          stopReason = `access_or_quota_${response.status}`;
      } else if (data.status !== "completed") result.error = "incomplete";
      else {
        const content = (data.output || []).filter(x => x.type === "message").flatMap(x => x.content || []);
        if (content.some(x => x.type === "refusal")) result.error = "refusal";
        else {
          const raw = content.filter(x => x.type === "output_text").map(x => x.text || "").join("");
          const classified = validateClassification(JSON.parse(raw));
          result = { ...result, source: "model", predicted_box: classified.box,
            needs_human: classified.needs_human };
        }
      }
    } catch (error) {
      result.error = ["TimeoutError", "AbortError", "TypeError", "SyntaxError"].includes(error?.name)
        ? error.name : "response_error";
    } finally {
      result.latency_ms = Math.round(performance.now() - start);
      pendingReserve -= task.reserve;
      if (result.usage) knownUsd += tokenCost(result.usage, "gpt-6-luna");
      else if (!result.status || result.status === 200) unknownReserve += task.reserve;
      results.set(task.message, result);
      if (unknownReserve > MAX_UNKNOWN * task.reserve) stopReason ||= "too_many_unknown_costs";
      if (results.size % 100 === 0 || results.size === unique.length || stopReason)
        console.log(JSON.stringify({ event: "progress", unique_completed: results.size,
          unique_total: unique.length, known_usd: Number(knownUsd.toFixed(6)), stop_reason: stopReason, at: iso() }));
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const counts = { question: 0, complaint: 0, violation: 0, fallback: 0 };
const byLanguage = {};
const byOrigin = {};
const errors = {};
const rows = sample.map(row => {
  const run = results.get(row.text.trim());
  if (!run) return { id: row.id, lang: row.lang, origin: row.origin, source: "not_evaluated", predicted_box: null };
  const category = run.predicted_box || "fallback";
  counts[category]++;
  const language = byLanguage[row.lang] ||= { question: 0, complaint: 0, violation: 0, fallback: 0 };
  language[category]++;
  const origin = byOrigin[row.origin] ||= { question: 0, complaint: 0, violation: 0, fallback: 0 };
  origin[category]++;
  if (run.error) errors[run.error] = (errors[run.error] || 0) + 1;
  return { id: row.id, lang: row.lang, origin: row.origin, source: run.source,
    predicted_box: run.predicted_box, needs_human: run.needs_human, error: run.error };
});
const calls = [...results.values()];
const latencies = calls.map(r => r.latency_ms).sort((a, b) => a - b);
const usage = calls.filter(r => r.usage).reduce((total, r) => {
  for (const key of Object.keys(total)) total[key] += r.usage[key];
  return total;
}, { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0 });
const summary = { completed_all: results.size === unique.length, stop_reason: stopReason,
  sample_rows: sample.length, unique_texts: unique.length, api_attempts: attempts,
  local_duplicate_rows: sample.length - unique.length, evaluated_rows: rows.filter(r => r.source !== "not_evaluated").length,
  counts, by_language: byLanguage, by_origin: byOrigin, errors,
  needs_human_rows: rows.filter(r => r.needs_human).length,
  response_usable_unique: calls.filter(r => r.source === "model").length,
  cost_known_usd: knownUsd, cost_upper_usd: knownUsd + unknownReserve,
  cost_mean_upper_per_ticket_usd: (knownUsd + unknownReserve) / rows.filter(r => r.source !== "not_evaluated").length,
  usage, cache_read_share_of_input: usage.input_tokens ? usage.cached_input_tokens / usage.input_tokens : null,
  latency_api_p95_ms: latencies[Math.max(0, Math.ceil(latencies.length * .95) - 1)] ?? null,
  accuracy: null, reason_accuracy_unavailable: "No human gold labels for question/complaint/violation" };
writeFileSync(join(out, "results.jsonl"), rows.map(r => JSON.stringify(r)).join("\n") + "\n", { flag: "wx" });
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2), { flag: "wx" });
console.log(JSON.stringify({ event: "complete", output: out, ...summary }));
