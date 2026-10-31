import test from "node:test";
import assert from "node:assert/strict";
import { tokenCost, summarize } from "./eval-metrics.mjs";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const usage = (input = 100, output = 0) => ({ input_tokens: input, output_tokens: output, cached_input_tokens: 0 });
const row = (expected, predicted, extra = {}) => ({
  expected_box: expected, predicted_box: predicted, source: "model", needs_human: false,
  latency_ms: 100, usage: usage(), ...extra,
});
const near = (actual, expected, epsilon = 1e-12) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

test("Luna and Sol price read/write/ordinary input disjointly", () => {
  near(tokenCost({ input_tokens: 1e6, output_tokens: 2e6, cached_input_tokens: 300000, cache_write_input_tokens: 200000 }, "gpt-6-luna"), 1.078);
  near(tokenCost(usage(1e6, 1e6), "gpt-6-luna"), 0.60);
  near(tokenCost({ input_tokens: 1e6, output_tokens: 2e6, cached_input_tokens: 300000, cache_write_input_tokens: 200000 }, "gpt-6-sol"), 21.56);
  near(tokenCost(usage(10000, 100)), 0.00105);
  assert.equal(summarize([]).model, "gpt-6-luna");
  assert.equal(tokenCost(null), null);
  assert.equal(tokenCost(usage(0, 0)), 0);
  assert.throws(() => tokenCost(null, "unknown-model"), /Unknown model/);
  assert.throws(() => summarize([], "unknown-model"), /Unknown model/);
  assert.throws(() => tokenCost({ ...usage(), cached_input_tokens: 90, cache_write_input_tokens: 20 }), /exceed/);
  for (const input of [-1, NaN, Infinity, 0.5]) assert.throws(() => tokenCost(usage(input)), /Invalid input_tokens/);
});

test("historical Qwen Singapore pricing requires an explicit model and rejects unpriced usage", () => {
  near(tokenCost(usage(10000, 100), "qwen3.7-flash"), 0.000313);
  const cached = { ...usage(10000, 100), cached_input_tokens: 8000 };
  near(tokenCost(cached, "qwen3.7-flash"), 0.000121);
  near(tokenCost(cached, "qwen3.7-plus"), 0.0016);
  assert.equal(summarize([], "qwen3.7-flash").cost.deployment_scope, "Singapore / International, implicit cache");
  assert.throws(() => tokenCost(usage(32001), "qwen3.7-flash"), /pricing band/);
  assert.throws(() => tokenCost(usage(256001), "qwen3.7-plus"), /pricing band/);
  assert.throws(() => tokenCost({ ...usage(), cache_write_input_tokens: 1 }, "qwen3.7-flash"), /Explicit cache/);
  near(tokenCost(usage(32000, 0), "qwen3.7-flash"), 0.00096);
});

test("fallback complaint is an error; unknown truth is excluded from accuracy and confusion", () => {
  const rows = [
    row("question", "question", { usage: usage(100, 20) }),
    row("question", "complaint", { usage: usage(100, 10) }),
    row("complaint", "complaint", { source: "cache", needs_human: true, usage: null }),
    row("complaint", "complaint", { source: "fallback", needs_human: true, attempted: true, usage: null }),
    row("violation", "violation"),
    row("violation", "question"),
    row(null, "complaint"),
    row("question", null, { source: "fallback", needs_human: true, attempted: false, usage: null }),
  ];
  const before = structuredClone(rows);
  const result = summarize(rows, "gpt-6-luna");
  assert.deepEqual(rows, before, "summarize must not mutate inputs");
  assert.equal(result.counts.total, 8);
  assert.equal(result.counts.labeled, 7);
  assert.equal(result.counts.unlabeled, 1);
  assert.equal(result.counts.correct, 3);
  assert.equal(result.counts.incorrect, 4);
  assert.equal(result.counts.errors, 2);
  assert.equal(result.counts.labeled_completion_errors, 2);
  near(result.accuracy, 3 / 7);
  near(result.accuracy_on_model_completions, 3 / 5);
  assert.deepEqual(result.confusion_matrix, {
    question: { question: 1, complaint: 1, violation: 0, unclassified: 1 },
    complaint: { question: 0, complaint: 1, violation: 0, unclassified: 1 },
    violation: { question: 1, complaint: 0, violation: 1, unclassified: 0 },
  });
  near(result.per_box.question.precision, 1 / 2);
  near(result.per_box.question.recall, 1 / 3);
  near(result.per_box.question.f1, 0.4);
  near(result.per_box.complaint.f1, 0.5);
  near(result.per_box.violation.f1, 2 / 3);
  near(result.macro_f1, 47 / 90);
  near(result.coverage, 6 / 8);
  near(result.labeled_coverage, 5 / 7);
  near(result.automatic_coverage, 5 / 8);
  assert.equal(result.cost.total_usd, null);
  assert.equal(result.cost.unknown_rows, 1);
  near(result.cost.known_usd, 0.000065);
  assert.equal(result.cost.mean_per_row_usd, null);
  assert.equal(result.cost.known_usage.input_tokens, 500);
});

test("unknown paid attempts never become free; local cache and explicit no-attempt fallback are free", () => {
  const report = summarize([
    row(null, null, { source: "fallback", attempted: false, usage: null }),
    row(null, "question", { source: "cache", usage: usage(1e6, 1e6) }),
    row(null, null, { source: "fallback", attempted: true, usage: usage(100, 10) }),
  ], "gpt-6-luna");
  near(report.cost.total_usd, 0.000015);
  near(report.cost.mean_per_row_usd, 0.000005);
  near(report.cost.per_1000_rows_usd, 0.005);
  assert.equal(report.cost.known_usage.input_tokens, 100);
  for (const extra of [
    { source: "model", usage: null },
    { source: "model", attempted: false, usage: null },
    { source: "fallback", attempted: true, usage: null },
    { source: "fallback", usage: null },
  ]) {
    const unknown = summarize([row("complaint", "complaint", extra)]);
    assert.equal(unknown.cost.total_usd, null);
    assert.equal(unknown.cost.unknown_rows, 1);
  }
});

test("Wilson intervals and empty denominators stay honest", () => {
  const perfect = summarize(Array.from({ length: 10 }, () => row("question", "question")));
  near(perfect.accuracy_ci95.lower, 0.7224672001371107);
  near(perfect.accuracy_ci95.upper, 1);
  const failed = summarize([row("complaint", "complaint", { source: "fallback", usage: null, attempted: false })]);
  assert.equal(failed.accuracy, 0);
  assert.equal(failed.accuracy_on_model_completions, null);
  assert.equal(failed.macro_f1, 0);
  const unlabelled = summarize([row(null, "question")]);
  assert.equal(unlabelled.accuracy, null);
  assert.equal(unlabelled.accuracy_ci95, null);
  assert.equal(unlabelled.macro_f1, null);
  assert.equal(unlabelled.coverage, 1);
  const empty = summarize([]);
  assert.equal(empty.accuracy, null);
  assert.equal(empty.coverage, null);
  assert.equal(empty.cost.total_usd, 0);
  assert.equal(empty.cost.mean_per_row_usd, null);
  assert.equal(empty.latency_ms.p95, null);
});

test("null predictions are failures and obsolete fourth labels fail validation", () => {
  const result = summarize([row("question", null)]);
  assert.equal(result.accuracy, 0);
  assert.equal(result.counts.errors, 1);
  assert.equal(result.automatic_coverage, 0);
  assert.equal(result.confusion_matrix.question.unclassified, 1);
  assert.throws(() => summarize([row("request", "complaint")]), /expected_box/);
  assert.throws(() => summarize([row("question", "request")]), /predicted_box/);
  assert.throws(() => summarize([row("question", "question", { latency_ms: NaN })]), /latency_ms/);
});

test("OpenAI judge sends only synthetic original text and maps strict results by index", () => {
  const dir = mkdtempSync(join(tmpdir(), "grand-openai-judge-test-"));
  const input = join(dir, "sample.jsonl");
  writeFileSync(input, [
    { id: "a", text: "Как найти работу?", expected_box: "violation", admin_reply: "PRIVATE_TEST_REPLY" },
    { id: "b", text: "Верните аккаунт", candidate_output: "PRIVATE_CANDIDATE_OUTPUT" },
  ].map(JSON.stringify).join("\n"));
  const mock = `globalThis.fetch = async (url, init) => {
    if (url !== 'https://api.openai.com/v1/responses' || init.redirect !== 'error') throw Error('wrong host');
    const body = JSON.parse(init.body);
    if (body.model !== 'gpt-6-sol' || body.reasoning?.effort !== 'none' || body.store !== false || body.service_tier !== 'default' || body.max_output_tokens !== 2400 || body.tools || body.text?.format?.strict !== true) throw Error('wrong request');
    const rows = JSON.parse(body.input[0].content);
    if (rows.length !== 2 || rows.some(row => Object.keys(row).sort().join(',') !== 'index,text') || init.body.includes('PRIVATE_')) throw Error('private fields leaked');
    return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({labels:[{index:1,box:'complaint',needs_human:true,ambiguous:false},{index:0,box:'question',needs_human:false,ambiguous:false}]})}]}],usage:{input_tokens:100,output_tokens:120,input_tokens_details:{cached_tokens:20,cache_write_tokens:30}}}), {status:200});
  };`;
  const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(mock)}`,
    join(import.meta.dirname, "annotate-eval.mjs"), "--live", "--input", input, "--output", dir], {
    env: { SystemRoot: process.env.SystemRoot, OPENAI_API_KEY: "test-not-real" }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(!result.stdout.includes("PRIVATE_") && !result.stdout.includes("test-not-real"));
  const summary = JSON.parse(readFileSync(join(dir, "judge-summary.json"), "utf8"));
  assert.equal(summary.model, "gpt-6-sol");
  assert.equal(summary.completed_rows, 2);
  assert.equal(summary.model_agreement_not_ground_truth, true);
  near(summary.total_cost_usd, 0.001379);
  assert.equal(summary.usage.cache_write_input_tokens, 30);
  const labels = readFileSync(join(dir, "judge-labels.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(labels.map(label => [label.id, label.box]), [["a", "question"], ["b", "complaint"]]);
});

test("OpenAI judge stops after a failed paid response without retrying or claiming zero cost", () => {
  const dir = mkdtempSync(join(tmpdir(), "grand-openai-failure-test-"));
  const input = join(dir, "sample.jsonl");
  writeFileSync(input, Array.from({ length: 21 }, (_, i) => JSON.stringify({ id: String(i), text: "Как найти работу?" })).join("\n"));
  const mock = "globalThis.fetch = async () => new Response('{}', {status:429});";
  const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(mock)}`,
    join(import.meta.dirname, "annotate-eval.mjs"), "--live", "--input", input, "--output", dir], {
    env: { SystemRoot: process.env.SystemRoot, OPENAI_API_KEY: "test-not-real" }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  const summary = JSON.parse(readFileSync(join(dir, "judge-summary.json"), "utf8"));
  assert.equal(summary.calls, 1);
  assert.equal(summary.completed_rows, 0);
  assert.equal(summary.total_cost_usd, null);
  assert.equal(summary.stop_reason, "openai_http_429");
});
