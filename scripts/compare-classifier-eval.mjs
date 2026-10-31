import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarize } from "./eval-metrics.mjs";

const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
if (["--results", "--labels", "--output"].some(name => !args.includes(name))) {
  throw new Error("Usage: node scripts/compare-classifier-eval.mjs --results JSONL --labels JSONL --output JSON [--model MODEL]");
}
const readLines = path => readFileSync(resolve(path), "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const rows = readLines(value("--results"));
const labels = readLines(value("--labels"));
const recordedModels = [...new Set(rows.map(row => row.model).filter(Boolean))];
const model = args.includes("--model") ? value("--model") : recordedModels.length === 1 ? recordedModels[0] : null;
if (!model) throw new Error("Pass --model explicitly for historical results without model metadata.");
if (recordedModels.some(recorded => recorded !== model)) throw new Error("Mixed or conflicting candidate model pricing.");
const byId = new Map(labels.map(label => [label.id, label]));
if (byId.size !== labels.length || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Duplicate IDs");
const joined = rows.map(row => ({ ...row, expected_box: byId.get(row.id)?.box ?? null }));
const comparable = joined.filter(row => byId.has(row.id));
const clear = comparable.filter(row => byId.get(row.id).ambiguous === false);
const summary = summarize(joined, model);
const supports = Object.values(summary.per_box).map(box => box.support);
const languages = [...new Set(joined.map(row => row.lang || "und"))];
const result = {
  label_source: "provisional_model", measured_quantity: "Agreement with model-generated labels; not human-verified accuracy",
  candidate_rows: rows.length, reference_rows: labels.length,
  missing_labels: joined.length - comparable.length,
  unmatched_reference_rows: labels.filter(label => !rows.some(row => row.id === label.id)).length,
  summary, unambiguous_reference_subset: summarize(clear, model),
  majority_class_baseline: summary.counts.labeled ? Math.max(...supports) / summary.counts.labeled : null,
  needs_human_agreement: comparable.length ? comparable.filter(row => row.needs_human === byId.get(row.id).needs_human).length / comparable.length : null,
  by_language: Object.fromEntries(languages.map(lang => [lang, summarize(joined.filter(row => (row.lang || "und") === lang), model)])),
  note: "The sample is small, contains duplicates and is complaint-heavy. Wilson intervals assume independent observations. Zero-support categories cannot establish quality.",
};
writeFileSync(resolve(value("--output")), JSON.stringify(result, null, 2), { flag: "wx" });
// Aggregate only: never print player text or row-level labels to logs.
console.log(JSON.stringify({ model_agreement: summary.accuracy, completed: summary.counts.completions,
  compared: summary.counts.labeled, majority_baseline: result.majority_class_baseline,
  cost_usd: summary.cost.total_usd, output: resolve(value("--output")) }));
