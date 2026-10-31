import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createClassifier, DEFAULT_MODEL } from "../lib/classifier.ts";
import { summarize, tokenCost } from "./eval-metrics.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = resolve(import.meta.dirname, "..");
const input = resolve(arg("--input", join(root, "private-data/validation-sample.jsonl")));
const sample = readFileSync(input, "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));
if (!sample.length || sample.length > 100) throw new Error("Evaluation requires 1–100 samples; no API calls made.");
if (sample.some(row => typeof row.id !== "string" || typeof row.text !== "string" || !row.text.trim() || row.text.length > 2000)) throw new Error("Invalid sample; no API calls made.");
const promptPath = resolve(arg("--prompt", join(root, "classifier-prompt.md")));
const prompt = readFileSync(promptPath, "utf8");
const variant = arg("--variant", "current");
if (!/^[a-zA-Z0-9_-]{1,40}$/.test(variant)) throw new Error("Variant must be a short alphanumeric label.");
const cacheMode = arg("--cache-mode", "explicit_static");
if (!["legacy_implicit", "explicit_static"].includes(cacheMode)) throw new Error("Unsupported cache mode; no API calls made.");
const model = process.env.OPENAI_TRIAGE_MODEL || DEFAULT_MODEL;
if (model !== "gpt-6-luna") throw new Error("This evaluation uses verified gpt-6-luna Standard pricing only.");
if (!args.includes("--live")) {
  console.log(JSON.stringify({ dry_run: true, model, variant, cache_mode: cacheMode, samples: sample.length, has_labels: sample.some(r => r.expected_box), api_calls: 0 }));
  process.exit(0);
}
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("Missing OPENAI_API_KEY; no API calls made.");
const out = resolve(arg("--output", join(tmpdir(), `grand-classifier-eval-${Date.now()}`)));
mkdirSync(out, { recursive: true });
const rowsPath = join(out, "classifier-results.jsonl");
// Exclusive files prevent accidental replacement of a previous paid run.
writeFileSync(rowsPath, "", { flag: "wx" });
const hash = s => createHash("sha256").update(s).digest("hex");
const metadata = { provider: "OpenAI", service_tier: "default", model, variant, cache_mode: cacheMode, prompt_path: promptPath, samples: sample.length, source: input, sample_sha256: hash(readFileSync(input)),
  prompt_sha256: hash(prompt), glossary_sha256: hash(readFileSync(join(root, "lib/game-glossary.ts"))),
  started_at: new Date().toISOString(), max_api_calls: 100, web_search: false,
  pricing: "Standard USD/1M: ordinary input .10, cache read .01, cache write .125, output .50",
  labels: "No supplied gold labels. Any later model annotations measure agreement only." };
writeFileSync(join(out, "run-metadata.json"), JSON.stringify(metadata, null, 2));
let attemptInfo = {}, attempts = 0, knownCostUsd = 0, budgetBlocked = false;
const classify = createClassifier({ prompt, model, cacheMode, enabled: true, apiKey, fetcher: async (url, init) => {
  if (url !== "https://api.openai.com/v1/responses") throw new Error("Unexpected evaluation endpoint.");
  // Conservative text-token bound: assume all input incurs the cache-write rate.
  const upperInput = Buffer.byteLength(String(init.body), "utf8") + 1024;
  const reservedUpperUsd = tokenCost({ input_tokens: upperInput, output_tokens: 200, cached_input_tokens: 0, cache_write_input_tokens: upperInput }, model);
  if (knownCostUsd + reservedUpperUsd >= 0.10) {
    budgetBlocked = true;
    throw new Error("Evaluation budget or verified pricing band exceeded before request.");
  }
  attempts++;
  attemptInfo = { attempted: true, reserved_upper_usd: reservedUpperUsd };
  try {
    const response = await fetch(url, init);
    attemptInfo.http_status = response.status;
    const payload = await response.clone().json();
    attemptInfo.response_status = payload.status === "completed" ? "completed" : "incomplete";
    attemptInfo.service_tier = payload.service_tier;
    attemptInfo.error_code = typeof payload.error?.code === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(payload.error.code) ? payload.error.code : undefined;
    return response;
  } catch (error) {
    attemptInfo.error_name = ["TimeoutError", "AbortError", "TypeError", "SyntaxError"].includes(error?.name) ? error.name : "RequestError";
    throw error;
  }
} });
console.log(JSON.stringify({ event: "started", output: out, samples: sample.length }));
const rows = [];
let consecutiveFailures = 0;
for (const item of sample) {
  const started = performance.now();
  attemptInfo = { attempted: false };
  const run = await classify(item.text);
  const row = { id: item.id, model, variant, cache_mode: cacheMode, lang: item.lang, kind: item.kind, expected_box: item.expected_box ?? null,
    predicted_box: run.source === "fallback" ? null : run.result.box,
    needs_human: run.result.needs_human, source: run.source, usage: run.usage,
    latency_ms: Math.round(performance.now() - started), ...attemptInfo };
  rows.push(row);
  appendFileSync(rowsPath, JSON.stringify(row) + "\n");
  const metrics = summarize(rows, model);
  knownCostUsd = metrics.cost.known_usd;
  const reservedUnknownUsd = rows.filter(r => r.attempted && !r.usage).reduce((sum, r) => sum + (r.reserved_upper_usd || 0), 0);
  writeFileSync(join(out, "classifier-summary.json"), JSON.stringify({ ...metrics, cache_mode: cacheMode, api_attempts: attempts,
    conservative_cost_upper_usd: knownCostUsd + reservedUnknownUsd, unknown_attempt_reservation_usd: reservedUnknownUsd,
    request_error_names: Object.fromEntries([...new Set(rows.map(r => r.error_name).filter(Boolean))].map(name => [name, rows.filter(r => r.error_name === name).length])),
  }, null, 2));
  consecutiveFailures = run.source === "fallback" ? consecutiveFailures + 1 : 0;
  if (rows.length % 10 === 0 || rows.length === sample.length || run.source === "fallback")
    console.log(JSON.stringify({ event: "progress", processed: rows.length, api_attempts: attempts, completions: metrics.counts.completions, errors: metrics.counts.errors, known_usd: metrics.cost.known_usd, unknown_cost_rows: metrics.cost.unknown_rows }));
  // No retries or silent expensive-model fallback; a failed pilot stops early.
  if (budgetBlocked || [401, 403, 429].includes(attemptInfo.http_status) || consecutiveFailures >= 3 || metrics.cost.unknown_rows || knownCostUsd >= 0.10) break;
  // Match the production 30/minute process limit without counting rate-limit fallbacks as model errors.
  await delay(Math.max(0, 2100 - (performance.now() - started)));
}
console.log(JSON.stringify({ event: "complete", output: out, processed: rows.length, api_attempts: attempts, summary: summarize(rows, model) }));
