import test from "node:test";
import assert from "node:assert/strict";
import { buildCountRequests, runCacheProbe } from "./probe-classifier-cache.mjs";

test("count-only uses three documented count bodies and never generates", async () => {
  let calls = 0;
  const report = await runCacheProbe({ prompt: "PRIVATE_STABLE_PROMPT", apiKey: "test-not-real", countOnly: true,
    fetcher: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses/input_tokens");
      assert.equal(init.redirect, "error");
      const body = JSON.parse(init.body);
      assert.equal(body.max_output_tokens, undefined);
      assert.equal(body.store, undefined);
      assert.equal(body.prompt_cache_options, undefined);
      assert.equal(body.model, "gpt-6-luna");
      return new Response(JSON.stringify({ input_tokens: [1200, 1250, 100][calls++] }));
    },
  });
  assert.equal(calls, 3);
  assert.equal(report.generation_attempts, 0);
  assert.equal(report.counts.visible_text_delta_estimate, 1100);
  assert.equal(report.budget, null);
  assert.ok(!JSON.stringify(report).includes("PRIVATE_STABLE_PROMPT"));
});

test("legacy static counts use a nonempty developer input while full and generations keep legacy shape", async () => {
  const bodies = buildCountRequests("Frozen legacy prompt", "legacy_implicit");
  assert.equal(bodies.prefix.instructions, undefined);
  assert.equal(bodies.prefix.input.length, 1);
  assert.equal(bodies.prefix.input[0].role, "developer");
  assert.equal(bodies.prefix.input[0].content[0].text, "Frozen legacy prompt");
  assert.equal(bodies.empty_baseline.input.length, 1);
  assert.equal(bodies.empty_baseline.input[0].content[0].text, "");
  assert.equal(bodies.full.instructions, "Frozen legacy prompt");
  assert.equal(bodies.full.input.length, 1);
  assert.equal(bodies.full.input[0].role, "user");
  let calls = 0;
  const report = await runCacheProbe({ prompt: "Frozen legacy prompt", cacheMode: "legacy_implicit", apiKey: "test-not-real",
    fetcher: async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      assert.equal(body.instructions, "Frozen legacy prompt");
      assert.equal(body.input[0].role, "user");
      assert.equal(body.prompt_cache_options, undefined);
      return new Response(JSON.stringify({ status: "completed", usage: { input_tokens: 100, output_tokens: 20 } }));
    },
  });
  assert.equal(calls, 4);
  assert.equal(report.status, "completed");
});

test("four distinct synthetic generations reuse only the static cache scope and expose no plaintext", async () => {
  const originals = [];
  const report = await runCacheProbe({ prompt: "PRIVATE_STABLE_PROMPT", apiKey: "test-not-real",
    fetcher: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(init.body);
      assert.deepEqual(body.prompt_cache_options, { mode: "explicit", ttl: "30m" });
      assert.equal(body.input[0].role, "developer");
      assert.deepEqual(body.input[0].content[0].prompt_cache_breakpoint, { mode: "explicit" });
      assert.equal(body.max_output_tokens, 200);
      assert.equal(body.tools, undefined);
      originals.push(JSON.parse(body.input[1].content).original);
      return new Response(JSON.stringify({ status: "completed", usage: { input_tokens: 1200, output_tokens: 20,
        input_tokens_details: { cached_tokens: originals.length === 1 ? 0 : 1100, cache_write_tokens: originals.length === 1 ? 1100 : 0 } } }));
    },
  });
  assert.equal(report.status, "completed");
  assert.equal(new Set(originals).size, 4);
  assert.equal(report.cache.calls_with_cache_read, 3);
  assert.equal(report.cache.cache_write_input_tokens, 1100);
  assert.ok(report.budget.total_usd < .01);
  assert.ok(!JSON.stringify(report).includes("PRIVATE_STABLE_PROMPT"));
  assert.ok(originals.every(text => !JSON.stringify(report).includes(text)));
});

test("unknown timeout stops without retry, preserving reserved cost", async () => {
  let calls = 0;
  const report = await runCacheProbe({ prompt: "Frozen prompt", apiKey: "test-not-real",
    fetcher: async () => { calls++; throw new DOMException("PRIVATE_FAILURE", "TimeoutError"); },
  });
  assert.equal(calls, 1);
  assert.equal(report.status, "stopped");
  assert.equal(report.rows[0].error_name, "TimeoutError");
  assert.equal(report.budget.total_usd, null);
  assert.ok(report.budget.conservative_upper_usd > 0);
  assert.ok(!JSON.stringify(report).includes("PRIVATE_FAILURE"));
});

test("probe rejects an oversized reservation before network and stops once on quota", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 }); };
  const oversized = await runCacheProbe({ prompt: "x".repeat(100000), apiKey: "test-not-real", fetcher });
  assert.equal(oversized.stop_reason, "budget_limit");
  assert.equal(calls, 0);
  const quota = await runCacheProbe({ prompt: "Frozen prompt", apiKey: "test-not-real", fetcher });
  assert.equal(calls, 1);
  assert.equal(quota.stop_reason, "quota_or_access_error");
  assert.equal(quota.rows[0].error_code, "insufficient_quota");
  assert.equal(quota.budget.total_usd, null);
});
