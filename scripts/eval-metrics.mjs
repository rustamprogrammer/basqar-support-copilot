// Standard (non-Batch) prices in USD per 1M tokens, checked 2026-10-31.
// https://developers.openai.com/api/docs/models/gpt-6-luna
// Qwen: Singapore / International, implicit caching only, no explicit writes.
// https://www.alibabacloud.com/help/en/model-studio/qwen3-7-flash
// https://www.alibabacloud.com/help/en/model-studio/qwen3-7-plus
const PRICES = Object.freeze({
  "gpt-6-luna": Object.freeze({ input: 0.10, cached: 0.01, cache_write: 0.125, output: 0.50 }),
  "gpt-6-sol": Object.freeze({ input: 2.00, cached: 0.20, cache_write: 2.50, output: 10.00 }),
  "qwen3.7-flash": Object.freeze({ input: 0.030, cached: 0.006, cache_write: null, output: 0.130, max_input: 32000 }),
  "qwen3.7-plus": Object.freeze({ input: 0.40, cached: 0.08, cache_write: null, output: 1.60, max_input: 256000 }),
});
const BOXES = ["question", "complaint", "violation"];
const SOURCES = ["model", "cache", "fallback"];

function priceFor(model) {
  if (!Object.hasOwn(PRICES, model)) throw new RangeError(`Unknown model pricing: ${model}`);
  return PRICES[model];
}

function tokenCounts(usage) {
  if (usage === null || usage === undefined) return null;
  if (typeof usage !== "object") throw new TypeError("usage must be an object or null");
  const counts = {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cached_input_tokens: usage.cached_input_tokens,
    cache_write_input_tokens: usage.cache_write_input_tokens ?? 0,
  };
  for (const [name, value] of Object.entries(counts)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  }
  if (counts.cached_input_tokens + counts.cache_write_input_tokens > counts.input_tokens) {
    throw new RangeError("Cached and cache-write tokens exceed total input tokens");
  }
  return counts;
}

/** Actual token cost in USD; null means usage is unavailable, never a free request. */
export function tokenCost(usage, model = "gpt-6-luna") {
  const price = priceFor(model);
  const counts = tokenCounts(usage);
  if (!counts) return null;
  if (price.max_input && counts.input_tokens > price.max_input) throw new RangeError("Input exceeds verified pricing band");
  if (price.cache_write === null && counts.cache_write_input_tokens > 0) throw new RangeError("Explicit cache writes are not priced for this evaluation");
  const ordinary = counts.input_tokens - counts.cached_input_tokens - counts.cache_write_input_tokens;
  return (ordinary * price.input + counts.cached_input_tokens * price.cached
    + counts.cache_write_input_tokens * price.cache_write + counts.output_tokens * price.output) / 1e6;
}

const fraction = (numerator, denominator) => denominator ? numerator / denominator : null;

function wilson95(correct, count) {
  if (!count) return null;
  const z = 1.959963984540054;
  const p = correct / count;
  const denominator = 1 + z * z / count;
  const center = (p + z * z / (2 * count)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

function validateRow(row, index) {
  if (!row || typeof row !== "object") throw new TypeError(`Invalid row ${index}`);
  for (const key of ["expected_box", "predicted_box"]) {
    if (row[key] !== null && !BOXES.includes(row[key])) throw new RangeError(`Invalid ${key} at row ${index}`);
  }
  if (!SOURCES.includes(row.source)) throw new RangeError(`Invalid source at row ${index}`);
  if (typeof row.needs_human !== "boolean") throw new TypeError(`Invalid needs_human at row ${index}`);
  if (!Number.isFinite(row.latency_ms) || row.latency_ms < 0) throw new RangeError(`Invalid latency_ms at row ${index}`);
  if (row.attempted !== undefined && typeof row.attempted !== "boolean") throw new TypeError(`Invalid attempted at row ${index}`);
}

/**
 * Accuracy uses labeled rows only; fallback is an error even if its queue matches.
 * Completion accuracy/coverage include cached successful model classifications.
 * Confusion rows = truth, columns = prediction; fallback/null -> unclassified.
 * Per-box undefined precision/recall/F1 use 0; macro-F1 averages all three boxes.
 * All proportions are 0..1. Wilson intervals assume independent observations.
 * Missing usage on fallback is conservatively unknown unless attempted === false.
 * Costs include unlabeled/failed paid attempts but exclude local cache hits.
 */
export function summarize(rows, model = "gpt-6-luna") {
  priceFor(model);
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  const confusion = Object.fromEntries(BOXES.map(box => [box,
    Object.fromEntries([...BOXES, "unclassified"].map(prediction => [prediction, 0])),
  ]));
  const counts = {
    total: rows.length, labeled: 0, unlabeled: 0, correct: 0, incorrect: 0,
    completions: 0, labeled_completions: 0, labeled_completion_errors: 0,
    errors: 0, labeled_errors: 0, needs_human: 0, automatic: 0,
    sources: { model: 0, cache: 0, fallback: 0 },
  };
  const usageTotals = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0 };
  let knownUsd = 0;
  let unknownCostRows = 0;
  const latencies = [];
  rows.forEach((row, index) => {
    validateRow(row, index);
    counts.sources[row.source]++;
    latencies.push(row.latency_ms);
    const completed = row.source !== "fallback" && row.predicted_box !== null;
    const prediction = completed ? row.predicted_box : "unclassified";
    if (completed) counts.completions++;
    else counts.errors++;
    if (row.needs_human || !completed) counts.needs_human++;
    else counts.automatic++;
    if (row.expected_box === null) counts.unlabeled++;
    else {
      counts.labeled++;
      confusion[row.expected_box][prediction]++;
      if (completed) counts.labeled_completions++;
      else counts.labeled_errors++;
      if (prediction === row.expected_box) counts.correct++;
      else {
        counts.incorrect++;
        if (completed) counts.labeled_completion_errors++;
      }
    }
    // A cache row may repeat the original response's usage; it was not billed again.
    if (row.source === "cache") return;
    const usage = tokenCounts(row.usage);
    if (usage) {
      knownUsd += tokenCost(usage, model);
      for (const key of Object.keys(usageTotals)) usageTotals[key] += usage[key];
    } else if (row.source === "model" || row.attempted !== false) unknownCostRows++;
  });
  const perBox = Object.fromEntries(BOXES.map(box => {
    const tp = confusion[box][box];
    const support = Object.values(confusion[box]).reduce((sum, count) => sum + count, 0);
    const predicted = BOXES.reduce((sum, expected) => sum + confusion[expected][box], 0);
    const fp = predicted - tp;
    const fn = support - tp;
    return [box, {
      support, predicted, tp, fp, fn,
      precision: predicted ? tp / predicted : 0,
      recall: support ? tp / support : 0,
      f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0,
    }];
  }));
  latencies.sort((a, b) => a - b);
  const percentile = p => latencies.length ? latencies[Math.max(0, Math.ceil(p * latencies.length) - 1)] : null;
  const totalUsd = unknownCostRows ? null : knownUsd;
  const meanCost = totalUsd === null ? null : fraction(totalUsd, counts.total);
  return {
    model,
    counts,
    accuracy: fraction(counts.correct, counts.labeled),
    accuracy_ci95: wilson95(counts.correct, counts.labeled),
    accuracy_on_model_completions: fraction(counts.correct, counts.labeled_completions),
    accuracy_on_model_completions_ci95: wilson95(counts.correct, counts.labeled_completions),
    confusion_matrix: confusion,
    per_box: perBox,
    macro_f1: counts.labeled ? BOXES.reduce((sum, box) => sum + perBox[box].f1, 0) / BOXES.length : null,
    coverage: fraction(counts.completions, counts.total),
    labeled_coverage: fraction(counts.labeled_completions, counts.labeled),
    automatic_coverage: fraction(counts.automatic, counts.total),
    latency_ms: {
      mean: counts.total ? latencies.reduce((sum, value) => sum + value, 0) / counts.total : null,
      p50: percentile(0.5), p95: percentile(0.95), max: latencies.at(-1) ?? null,
    },
    cost: {
      currency: "USD", pricing: "standard", deployment_scope: model.startsWith("qwen") ? "Singapore / International, implicit cache" : null, known_usd: knownUsd,
      known_rows: counts.total - unknownCostRows, unknown_rows: unknownCostRows,
      total_usd: totalUsd, mean_per_row_usd: meanCost,
      per_1000_rows_usd: meanCost === null ? null : meanCost * 1000,
      known_usage: usageTotals,
    },
  };
}
