import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { buildClassifierRequest, createClassifier, DEFAULT_MODEL } from "../lib/classifier.ts";
import { summarize, tokenCost } from "./eval-metrics.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const VARIANTS = ["old", "new"];
const CACHE_MODES = ["legacy_implicit", "explicit_static"];
const LEGACY_MODES = { old: "legacy_implicit", new: "legacy_implicit" };
const MAX_COST = 0.15;
const COST_TARGET = 0.002;
const good = row => row && row.source !== "fallback" && row.predicted_box !== null;
const fraction = (a, b) => b ? a / b : null;
const safeErrorName = error => ["TimeoutError", "AbortError", "TypeError", "SyntaxError"].includes(error?.name) ? error.name : "RequestError";
const rowCost = row => row.source === "cache" || !row.attempted ? 0 : row.usage ? tokenCost(row.usage, row.model) : null;

// Fixed pseudorandom order balances which prompt benefits from a warm provider.
export function variantOrder(id) {
  return parseInt(hash(`grand-paired-order-v1:${id}`).slice(0, 2), 16) % 2 ? ["new", "old"] : ["old", "new"];
}

export function pairedSummary(rows, requestedPairs, includeOrigins = true) {
  const byVariant = Object.fromEntries(VARIANTS.map(variant => [variant, rows.filter(row => row.variant === variant)]));
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.id)) groups.set(row.id, {});
    if (groups.get(row.id)[row.variant]) throw new Error("Duplicate paired result ID/variant");
    groups.get(row.id)[row.variant] = row;
  }
  // A pair includes failed classifications, but must have evaluated both arms.
  const pairs = [...groups.values()].filter(pair => pair.old && pair.new);
  const labeled = pairs.filter(pair => pair.old.expected_box !== null);
  const correct = row => good(row) && row.predicted_box === row.expected_box;
  const variants = Object.fromEntries(VARIANTS.map(variant => {
    const selected = byVariant[variant];
    const metrics = summarize(selected, DEFAULT_MODEL);
    const unknownReserve = selected.filter(row => rowCost(row) === null).reduce((sum, row) => sum + row.reserved_upper_usd, 0);
    const upper = metrics.cost.known_usd + unknownReserve;
    const fresh = selected.filter(row => row.source === "model" && row.usage);
    const noCacheTotal = fresh.reduce((sum, row) => sum + (row.usage.input_tokens * 0.10 + row.usage.output_tokens * 0.50) / 1e6, 0);
    return [variant, {
      ...metrics,
      paired_only: summarize(pairs.map(pair => pair[variant]), DEFAULT_MODEL),
      no_provider_cache_estimate: {
        successful_fresh_calls: fresh.length, total_usd: noCacheTotal,
        mean_per_successful_fresh_call_usd: fraction(noCacheTotal, fresh.length),
        note: "Counterfactual at ordinary input prices using observed successful fresh-call token lengths; excludes local-cache hits and failed unknown usage. Not a new experiment or future price guarantee.",
      },
      cost_bounds: {
        known_lower_usd: metrics.cost.known_usd, conservative_upper_usd: upper,
        unknown_attempt_reservation_usd: unknownReserve,
        mean_lower_usd: fraction(metrics.cost.known_usd, selected.length),
        mean_upper_usd: fraction(upper, selected.length),
        target_per_message_usd: COST_TARGET,
        within_target_sample_upper_bound: selected.length ? upper / selected.length <= COST_TARGET : null,
      },
      request_errors: Object.fromEntries([...new Set(selected.map(row => row.error_name).filter(Boolean))].map(name => [name, selected.filter(row => row.error_name === name).length])),
    }];
  }));
  const bothCorrect = labeled.filter(pair => correct(pair.old) && correct(pair.new)).length;
  const oldOnly = labeled.filter(pair => correct(pair.old) && !correct(pair.new)).length;
  const newOnly = labeled.filter(pair => !correct(pair.old) && correct(pair.new)).length;
  const bothComplete = pairs.filter(pair => good(pair.old) && good(pair.new));
  const freshBoth = pairs.filter(pair => VARIANTS.every(variant => pair[variant].source === "model" && pair[variant].usage));
  const known = VARIANTS.reduce((sum, key) => sum + variants[key].cost_bounds.known_lower_usd, 0);
  const upper = VARIANTS.reduce((sum, key) => sum + variants[key].cost_bounds.conservative_upper_usd, 0);
  const unknown = rows.filter(row => rowCost(row) === null).length;
  return {
    measured_quantity: "Paired agreement with the same supplied labels; not human-verified accuracy unless separately established.",
    model: DEFAULT_MODEL, requested_pairs: requestedPairs, evaluated_pairs: pairs.length,
    incomplete_pairs: groups.size - pairs.length, remaining_pairs: requestedPairs - groups.size,
    pair_order_counts: { old_first: pairs.filter(pair => pair.old.position === 0).length, new_first: pairs.filter(pair => pair.new.position === 0).length },
    variants,
    ...(includeOrigins ? { by_origin: Object.fromEntries([...new Set(rows.map(row => row.origin || "unknown"))].map(origin => {
      const selected = rows.filter(row => (row.origin || "unknown") === origin);
      return [origin, pairedSummary(selected, new Set(selected.map(row => row.id)).size, false)];
    })) } : {}),
    paired: {
      labeled_pairs: labeled.length, both_correct: bothCorrect, old_only_correct: oldOnly,
      new_only_correct: newOnly, neither_correct: labeled.length - bothCorrect - oldOnly - newOnly,
      new_minus_old_agreement: fraction(newOnly - oldOnly, labeled.length),
      successful_both: bothComplete.length,
      same_box_on_successful_both: fraction(bothComplete.filter(pair => pair.old.predicted_box === pair.new.predicted_box).length, bothComplete.length),
      no_provider_cache_on_same_successful_fresh_pairs: {
        pairs: freshBoth.length,
        mean_per_call_usd: Object.fromEntries(VARIANTS.map(variant => [variant,
          fraction(freshBoth.reduce((sum, pair) => sum + (pair[variant].usage.input_tokens * .10 + pair[variant].usage.output_tokens * .50) / 1e6, 0), freshBoth.length),
        ])),
        note: "Identical paired subset, both variants successful and not local-cache hits; counterfactual only.",
      },
      note: "Fallbacks count as incorrect against supplied labels. Partial pairs are excluded here but all attempts remain in cost totals. Wilson intervals do not account for duplicate-message clusters or sample selection.",
    },
    budget: { limit_usd: MAX_COST, known_lower_usd: known, conservative_upper_usd: upper,
      unknown_attempts: unknown, total_usd: unknown ? null : known },
  };
}

export async function runPairedEvaluation({ sample, prompts, apiKey, output, labels = null, cacheModes = LEGACY_MODES, fetcher = fetch, pause = delay, onProgress = () => {} }) {
  if (!Array.isArray(sample) || !sample.length || sample.length > 100
    || sample.some(row => typeof row.id !== "string" || !row.id || typeof row.text !== "string" || !row.text.trim() || row.text.length > 2000
      || (row.expected_box != null && !["question", "complaint", "violation"].includes(row.expected_box)))
    || new Set(sample.map(row => row.id)).size !== sample.length) throw new Error("Expected 1–100 unique-ID samples; no API calls made");
  if (VARIANTS.some(variant => !CACHE_MODES.includes(cacheModes[variant]))) throw new Error("Unsupported cache mode");
  if (VARIANTS.some(variant => typeof prompts[variant] !== "string" || !prompts[variant].trim())
    || (prompts.old === prompts.new && cacheModes.old === cacheModes.new)) throw new Error("Provide two distinct nonempty frozen configurations");
  const configuration = { cache_modes: { ...cacheModes }, comparison_scope: cacheModes.old === cacheModes.new ? "prompt_with_same_cache_mode" : "prompt_and_cache_configuration" };
  const reference = labels ? new Map(labels.map(label => [label.id, label.box])) : null;
  if (labels && (reference.size !== labels.length || labels.some(label => typeof label.id !== "string" || !["question", "complaint", "violation"].includes(label.box)))) throw new Error("Invalid reference labels");
  mkdirSync(output, { recursive: true });
  const paths = Object.fromEntries(VARIANTS.map(variant => [variant, join(output, `${variant}-results.jsonl`)]));
  for (const path of [...Object.values(paths), join(output, "paired-rows.jsonl"), join(output, "paired-summary.json")]) writeFileSync(path, "", { flag: "wx" });
  const rows = [];
  let diagnostics = {}, knownUsd = 0, unknownReservedUsd = 0, attempts = 0, consecutiveFailures = 0, stopped = null;
  const classifiers = Object.fromEntries(VARIANTS.map(variant => [variant, createClassifier({ prompt: prompts[variant], model: DEFAULT_MODEL, cacheMode: cacheModes[variant], apiKey, enabled: true,
    fetcher: async (url, init) => {
      const body = JSON.parse(String(init.body));
      if (url !== "https://api.openai.com/v1/responses" || body.model !== DEFAULT_MODEL || body.service_tier !== "default"
        || body.store !== false || body.reasoning?.effort !== "none" || body.max_output_tokens !== 200 || body.tools || init.redirect !== "error") {
        stopped = "frozen_configuration_changed"; throw new Error("Frozen request configuration changed");
      }
      const player = body.input?.find(item => item.role === "user");
      const original = typeof player?.content === "string" ? JSON.parse(player.content).original : null;
      if (typeof original !== "string" || JSON.stringify(body) !== JSON.stringify(buildClassifierRequest(prompts[variant], original, cacheModes[variant], DEFAULT_MODEL))) {
        stopped = "frozen_configuration_changed"; throw new Error("Frozen prompt or cache configuration changed");
      }
      const inputBound = Buffer.byteLength(String(init.body), "utf8") + 1024;
      const reserved = tokenCost({ input_tokens: inputBound, output_tokens: 200, cached_input_tokens: 0, cache_write_input_tokens: inputBound }, DEFAULT_MODEL);
      if (knownUsd + unknownReservedUsd + reserved > MAX_COST) { stopped = "budget_limit"; throw new Error("Budget reservation rejected before call"); }
      diagnostics = { attempted: true, reserved_upper_usd: reserved };
      attempts++;
      try {
        const response = await fetcher(url, init);
        diagnostics.http_status = response.status;
        const data = await response.clone().json();
        diagnostics.response_status = data.status === "completed" ? "completed" : "incomplete";
        diagnostics.service_tier = data.service_tier;
        if (typeof data.error?.code === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(data.error.code)) diagnostics.error_code = data.error.code;
        return response;
      } catch (error) { diagnostics.error_name = safeErrorName(error); throw error; }
    },
  })]));
  for (const item of sample) {
    const pairStart = performance.now();
    for (const [position, variant] of variantOrder(item.id).entries()) {
      diagnostics = { attempted: false, reserved_upper_usd: 0 };
      const start = performance.now();
      const run = await classifiers[variant](item.text);
      if (stopped && !diagnostics.attempted) break;
      const row = { id: item.id, model: DEFAULT_MODEL, variant, cache_mode: cacheModes[variant], position, lang: item.lang || "und", origin: item.origin || "unknown", expected_box: reference ? reference.get(item.id) ?? null : item.expected_box ?? null,
        predicted_box: run.source === "fallback" ? null : run.result.box, needs_human: run.result.needs_human,
        source: run.source, usage: run.usage, latency_ms: Math.round(performance.now() - start), ...diagnostics };
      let cost;
      try { cost = rowCost(row); } catch {
        row.usage = null; row.error_name = "InvalidUsage";
        cost = null; stopped = "invalid_usage";
      }
      if (cost === null) unknownReservedUsd += row.reserved_upper_usd;
      else knownUsd += cost;
      rows.push(row);
      appendFileSync(paths[variant], JSON.stringify(row) + "\n");
      consecutiveFailures = run.source === "fallback" ? consecutiveFailures + 1 : 0;
      if ([401, 403, 429].includes(diagnostics.http_status)) stopped = "quota_or_access_error";
      else if (consecutiveFailures >= 3) stopped = "three_consecutive_failures";
      else if (cost !== null && cost > row.reserved_upper_usd && row.attempted) stopped = "cost_bound_exceeded";
      if (stopped) break;
    }
    const pairRows = rows.filter(row => row.id === item.id);
    if (pairRows.length) appendFileSync(join(output, "paired-rows.jsonl"), JSON.stringify({ id: item.id,
      complete_pair: pairRows.length === 2,
      origin: item.origin || "unknown", expected_box: pairRows[0].expected_box,
      variants: Object.fromEntries(pairRows.map(row => [row.variant, { box: row.predicted_box, source: row.source, needs_human: row.needs_human,
        matches_reference: row.expected_box === null ? null : good(row) && row.predicted_box === row.expected_box,
        usage: row.usage, cost_usd: rowCost(row), conservative_unknown_reservation_usd: rowCost(row) === null ? row.reserved_upper_usd : 0,
        no_provider_cache_estimate_usd: row.source === "model" && row.usage ? (row.usage.input_tokens * .10 + row.usage.output_tokens * .50) / 1e6 : null,
      }])),
      same_box: pairRows.length === 2 && pairRows.every(good) ? pairRows[0].predicted_box === pairRows[1].predicted_box : null,
    }) + "\n");
    const summary = { ...pairedSummary(rows, sample.length), ...configuration, api_attempts: attempts, status: stopped ? "stopped" : rows.length === sample.length * 2 ? "completed" : "running", stop_reason: stopped };
    writeFileSync(join(output, "paired-summary.json"), JSON.stringify(summary, null, 2));
    onProgress({ evaluated_pairs: summary.evaluated_pairs, api_attempts: attempts, known_lower_usd: knownUsd,
      conservative_upper_usd: knownUsd + unknownReservedUsd, unknown_attempts: summary.budget.unknown_attempts, status: summary.status });
    if (stopped) return summary;
    if (rows.length < sample.length * 2) await pause(Math.max(0, 2100 - (performance.now() - pairStart)));
  }
  return { ...pairedSummary(rows, sample.length), ...configuration, api_attempts: attempts, status: "completed", stop_reason: null };
}

async function main() {
  const args = process.argv.slice(2);
  const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  if (["--input", "--old-prompt", "--new-prompt", "--output"].some(name => !value(name))) throw new Error("Required: --input JSONL --old-prompt MD --new-prompt MD --output DIR [--old-cache-mode MODE] [--new-cache-mode MODE] [--labels JSONL] [--live]");
  const cacheModes = { old: value("--old-cache-mode") || "legacy_implicit", new: value("--new-cache-mode") || "legacy_implicit" };
  if (VARIANTS.some(variant => !CACHE_MODES.includes(cacheModes[variant]))) throw new Error("Unsupported cache mode");
  if ((process.env.OPENAI_TRIAGE_MODEL || DEFAULT_MODEL) !== DEFAULT_MODEL) throw new Error("Paired evaluation fixes gpt-6-luna");
  const readLines = path => readFileSync(resolve(path), "utf8").split(/\r?\n/).filter(line => line.trim()).map(JSON.parse);
  const sample = readLines(value("--input"));
  const prompts = { old: readFileSync(resolve(value("--old-prompt")), "utf8"), new: readFileSync(resolve(value("--new-prompt")), "utf8") };
  const labels = value("--labels") ? readLines(value("--labels")) : null;
  if (!args.includes("--live")) { console.log(JSON.stringify({ dry_run: true, samples: sample.length, model: DEFAULT_MODEL, cache_modes: cacheModes, max_cost_usd: MAX_COST, api_calls: 0 })); return; }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const output = resolve(value("--output"));
  mkdirSync(output, { recursive: true });
  const root = resolve(import.meta.dirname, "..");
  writeFileSync(join(output, "paired-metadata.json"), JSON.stringify({ model: DEFAULT_MODEL, service_tier: "default", store: false, reasoning: "none",
    cache_modes: cacheModes, comparison_scope: cacheModes.old === cacheModes.new ? "prompt_with_same_cache_mode" : "prompt_and_cache_configuration",
    timeout_ms: 4500, max_output_tokens: 200, web_search: false, retries: 0, rate_limit_per_variant: "30/minute", local_cache_per_variant: "separate, 10 minutes / 256 entries",
    budget_usd: MAX_COST, target_usd_per_message: COST_TARGET, order: "SHA256 grand-paired-order-v1:id parity", sample_sha256: hash(readFileSync(resolve(value("--input")))),
    prompt_sha256: Object.fromEntries(VARIANTS.map(variant => [variant, hash(prompts[variant])])),
    adapter_sha256: hash(readFileSync(join(root, "lib/classifier.ts"))), glossary_sha256: hash(readFileSync(join(root, "lib/game-glossary.ts"))),
    reference_sha256: value("--labels") ? hash(readFileSync(resolve(value("--labels")))) : null,
    reference_note: "Same externally supplied labels for both variants. Judge must use a frozen independent rubric and never see candidate outputs. New held-out sample required; this runner does not prove train/test disjointness.",
    started_at: new Date().toISOString(),
  }, null, 2), { flag: "wx" });
  const summary = await runPairedEvaluation({ sample, prompts, cacheModes, labels, apiKey, output, onProgress: progress => console.log(JSON.stringify(progress)) });
  console.log(JSON.stringify({ status: summary.status, evaluated_pairs: summary.evaluated_pairs, budget: summary.budget, output }));
  if (summary.status !== "completed") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  console.error(JSON.stringify({ status: "stopped", reason: "evaluation_setup_or_local_error" }));
  process.exitCode = 1;
});
