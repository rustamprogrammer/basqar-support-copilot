import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPairedEvaluation, variantOrder } from "./eval-paired-classifier.mjs";

const prompts = { old: "OLD frozen rubric", new: "NEW frozen rubric" };
const output = () => mkdtempSync(join(tmpdir(), "grand-paired-test-"));
const sample = count => Array.from({ length: count }, (_, i) => ({ id: `id-${i}`, text: `PRIVATE_SYNTHETIC_${i}`, expected_box: "question", origin: "validation" }));
const reply = box => new Response(JSON.stringify({ status: "completed", service_tier: "default",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ meaning_ru: "Синтетический тест", box, needs_human: false }) }] }],
  usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 10, cache_write_tokens: 30 } },
}), { status: 200 });

test("same input per arm, deterministic order, separate caches and per-origin paired metrics", async () => {
  const dir = output();
  const rows = sample(3);
  rows[1].expected_box = "complaint";
  rows[2].text = rows[0].text;
  rows[2].origin = "train";
  const calls = [];
  const report = await runPairedEvaluation({ sample: rows, prompts, apiKey: "test-not-real", output: dir, pause: async () => {},
    fetcher: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "gpt-6-luna");
      assert.equal(body.reasoning.effort, "none");
      assert.equal(body.max_output_tokens, 200);
      assert.equal(body.store, false);
      assert.equal(body.service_tier, "default");
      assert.equal(body.tools, undefined);
      const original = JSON.parse(body.input.find(item => item.role === "user").content).original;
      calls.push({ variant: body.instructions === prompts.old ? "old" : "new", original });
      return reply(body.instructions === prompts.new && original === rows[0].text ? "question" : "complaint");
    },
  });
  assert.equal(report.status, "completed");
  assert.deepEqual(report.cache_modes, { old: "legacy_implicit", new: "legacy_implicit" });
  assert.equal(report.evaluated_pairs, 3);
  assert.equal(report.api_attempts, 4);
  assert.equal(report.variants.old.counts.sources.cache, 1);
  assert.equal(report.variants.new.counts.sources.cache, 1);
  assert.deepEqual(calls.slice(0, 2).map(call => call.variant), variantOrder(rows[0].id));
  assert.ok(calls.slice(0, 2).every(call => call.original === rows[0].text));
  assert.equal(report.paired.old_only_correct, 0);
  assert.equal(report.paired.new_only_correct, 2);
  assert.equal(report.paired.new_minus_old_agreement, 2 / 3);
  assert.equal(report.by_origin.train.evaluated_pairs, 1);
  assert.equal(report.by_origin.validation.evaluated_pairs, 2);
  assert.equal(report.paired.no_provider_cache_on_same_successful_fresh_pairs.pairs, 2);
  assert.ok(report.variants.old.cost_bounds.within_target_sample_upper_bound);
  assert.ok(!readFileSync(join(dir, "paired-rows.jsonl"), "utf8").includes("PRIVATE_SYNTHETIC"));
});

test("one timeout remains unknown, consumes reservation and continues without retry", async () => {
  const rows = sample(3);
  let calls = 0;
  const report = await runPairedEvaluation({ sample: rows, prompts, apiKey: "test-not-real", output: output(), pause: async () => {},
    fetcher: async () => { if (++calls === 1) throw new DOMException("Synthetic timeout", "TimeoutError"); return reply("question"); },
  });
  assert.equal(calls, 6);
  assert.equal(report.status, "completed");
  assert.equal(report.evaluated_pairs, 3);
  assert.equal(report.budget.unknown_attempts, 1);
  assert.equal(report.budget.total_usd, null);
  assert.ok(report.budget.conservative_upper_usd > report.budget.known_lower_usd);
  assert.ok(report.budget.conservative_upper_usd < 0.15);
  const first = variantOrder(rows[0].id)[0];
  assert.equal(report.variants[first].request_errors.TimeoutError, 1);
  assert.equal(report.variants[first].paired_only.counts.incorrect, 1);
  assert.equal(report.paired.both_correct, 2);
  assert.equal(report.paired.no_provider_cache_on_same_successful_fresh_pairs.pairs, 2);
});

test("quota errors stop immediately, retaining incomplete-pair costs", async () => {
  let calls = 0;
  const report = await runPairedEvaluation({ sample: sample(3), prompts, apiKey: "test-not-real", output: output(), pause: async () => {},
    fetcher: async () => { calls++; return new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 }); },
  });
  assert.equal(calls, 1);
  assert.equal(report.stop_reason, "quota_or_access_error");
  assert.equal(report.evaluated_pairs, 0);
  assert.equal(report.incomplete_pairs, 1);
  assert.equal(report.budget.total_usd, null);
  assert.ok(report.budget.conservative_upper_usd > 0);
});

test("three consecutive failures stop and preserve all unknown reservations", async () => {
  let calls = 0;
  const report = await runPairedEvaluation({ sample: sample(3), prompts, apiKey: "test-not-real", output: output(), pause: async () => {},
    fetcher: async () => { calls++; throw new DOMException("Synthetic timeout", "TimeoutError"); },
  });
  assert.equal(calls, 3);
  assert.equal(report.stop_reason, "three_consecutive_failures");
  assert.equal(report.evaluated_pairs, 1);
  assert.equal(report.incomplete_pairs, 1);
  assert.equal(report.paired.neither_correct, 1);
  assert.equal(report.budget.unknown_attempts, 3);
});

test("oversized prompt budget is rejected before any network attempt", async () => {
  let calls = 0;
  const report = await runPairedEvaluation({ sample: sample(1), prompts: { old: "A".repeat(1500000), new: "B".repeat(1500000) },
    apiKey: "test-not-real", output: output(), pause: async () => {}, fetcher: async () => { calls++; return reply("question"); },
  });
  assert.equal(calls, 0);
  assert.equal(report.api_attempts, 0);
  assert.equal(report.stop_reason, "budget_limit");
  assert.equal(report.budget.total_usd, 0);
});

test("cache-only comparison permits identical prompts and records exact explicit scope", async () => {
  const seen = [];
  const report = await runPairedEvaluation({ sample: sample(1), prompts: { old: "same rubric", new: "same rubric" },
    cacheModes: { old: "legacy_implicit", new: "explicit_static" }, apiKey: "test-not-real", output: output(), pause: async () => {},
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      const player = body.input.find(item => item.role === "user");
      assert.equal(JSON.parse(player.content).original, sample(1)[0].text);
      if (body.prompt_cache_options) {
        assert.deepEqual(body.prompt_cache_options, { mode: "explicit", ttl: "30m" });
        assert.equal(body.instructions, undefined);
        assert.deepEqual(body.input[0].content[0].prompt_cache_breakpoint, { mode: "explicit" });
        assert.equal(player.prompt_cache_breakpoint, undefined);
        seen.push("explicit_static");
      } else { assert.equal(body.instructions, "same rubric"); seen.push("legacy_implicit"); }
      return reply("question");
    },
  });
  assert.equal(report.status, "completed");
  assert.equal(report.comparison_scope, "prompt_and_cache_configuration");
  assert.deepEqual(seen.sort(), ["explicit_static", "legacy_implicit"]);
});
