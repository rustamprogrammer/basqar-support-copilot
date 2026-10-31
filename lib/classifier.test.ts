import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClassifier, buildClassifierRequest, validateClassification, type Classification } from "./classifier.ts";
import { classifiedMessage } from "./classifier-message.ts";
const prompt = readFileSync(new URL("../classifier-prompt.md", import.meta.url), "utf8");
const result: Classification = { meaning_ru: "Игрок сообщает о нападении в зелёной зоне.", box: "complaint", needs_human: false };
const response = (value: unknown = result, extra: object = {}) => Response.json({ status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  usage: { input_tokens: 2000, output_tokens: 60 }, ...extra });

test("sends actual Markdown and unmodified player text through OpenAI Responses", async () => {
  const classify = createClassifier({ prompt, apiKey: "secret-test", enabled: true, fetcher: async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer secret-test");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.instructions, undefined);
    assert.deepEqual(body.prompt_cache_options, { mode: "explicit", ttl: "30m" });
    assert.equal(body.input[0].role, "developer");
    assert.deepEqual(body.input[0].content, [{ type: "input_text", text: prompt, prompt_cache_breakpoint: { mode: "explicit" } }]);
    assert.equal(body.input[1].role, "user");
    const data = JSON.parse(body.input[1].content);
    assert.equal(data.original, "  Meni zz da dm qilyapti  ");
    assert.ok(data.glossary.length <= 6);
    assert.ok(data.glossary.every((entry: object) => !('kk' in entry) && !('uz' in entry) && !('source' in entry)));
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.name, "grand_classifier");
    assert.deepEqual(body.text.format.schema.properties.box.enum, ["question", "complaint", "violation"]);
    assert.equal(body.store, false);
    assert.equal(body.service_tier, "default");
    assert.equal(body.reasoning.effort, "none");
    for (const field of ["messages", "response_format", "enable_thinking", "enable_search", "max_completion_tokens"]) assert.equal(body[field], undefined);
    assert.ok(!String(init?.body).includes("secret-test"));
    assert.equal(body.tools, undefined);
    return response();
  } });
  assert.equal((await classify("  Meni zz da dm qilyapti  ")).result.box, "complaint");
});

test("only the stable instruction prefix is marked for caching across different players", () => {
  const first = buildClassifierRequest(prompt, "Один игрок: меня ДМят");
  const second = buildClassifierRequest(prompt, "Другой игрок: где автосалон?");
  assert.deepEqual(first.input[0], second.input[0]);
  assert.notDeepEqual(first.input[1], second.input[1]);
  assert.equal(JSON.stringify(first).split("prompt_cache_breakpoint").length - 1, 1);
  assert.equal(JSON.stringify(first.input[0]).includes("Один игрок"), false);
  assert.equal(JSON.stringify(first.input[1]).includes("prompt_cache_breakpoint"), false);
  assert.equal(first.prompt_cache_options?.ttl, "30m");
  assert.equal("prompt_cache_key" in first, false);
});

test("legacy mode reproduces the old API shape for controlled comparisons", () => {
  const body = buildClassifierRequest(prompt, "Сколько стоит машина?", "legacy_implicit");
  assert.equal(body.instructions, prompt);
  assert.equal(body.input.length, 1);
  assert.equal(body.input[0].role, "user");
  assert.equal(body.prompt_cache_options, undefined);
  assert.equal(JSON.stringify(body).includes("prompt_cache_breakpoint"), false);
  assert.throws(() => buildClassifierRequest(prompt, "test", "invalid" as never), /cache mode/);
});

test("web search cannot be enabled and API requests have no paid tools", async () => {
  const options = { prompt, apiKey: "test", enabled: true, webSearch: true,
    fetcher: async (_: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.tools, undefined);
      assert.equal(body.tool_choice, undefined);
      assert.equal(body.include, undefined);
      assert.equal(body.max_completion_tokens, undefined);
      assert.equal(body.max_tokens, undefined);
      assert.equal(body.max_output_tokens, 200);
      assert.equal(body.model, "gpt-6-luna");
      return response();
    },
  };
  const run = await createClassifier(options)("Менядмят в зз");
  assert.equal(run.web_search_calls, 0);
  assert.deepEqual(run.sources, []);
});

test("identical and concurrent messages share a request; cache expires", async () => {
  let calls = 0, time = 0;
  const classify = createClassifier({ prompt, apiKey: "test", enabled: true, now: () => time, fetcher: async () => { calls++; return response(); } });
  await Promise.all([classify("message"), classify("message")]);
  assert.equal(calls, 1);
  const cached = await classify("message");
  assert.equal(cached.source, "cache");
  assert.equal(cached.usage, null);
  assert.equal(cached.web_search_calls, 0);
  time = 600_001;
  await classify("message");
  assert.equal(calls, 2);
});

test("missing key never calls API; original message remains pending", async () => {
  let calls = 0;
  const classify = createClassifier({ prompt, enabled: true, fetcher: async () => { calls++; throw new Error("must not call"); } });
  const run = await classify("e,bqcndj");
  assert.equal(run.source, "fallback");
  const message = classifiedMessage("e,bqcndj", run);
  assert.equal(message.text, "e,bqcndj");
  assert.equal(message.status, "pending");
  assert.equal(message.processing.box, "complaint");
  assert.equal(calls, 0);
});

test("failure, refusal, invalid and truncated output cannot silently discard messages", async () => {
  const providers: (() => Promise<Response>)[] = [
    async () => { throw new Error("Timeout"); }, async () => new Response("No", { status: 401 }),
    async () => new Response("No", { status: 429 }), async () => response({ ...result, box: "trash" }),
    async () => response(result, { status: "incomplete" }),
    async () => response(result, { output: [{ type: "message", content: [{ type: "refusal", refusal: "Refused" }] }] }),
    async () => response(result, { output: [{ type: "web_search_call", content: [{ type: "output_text", text: JSON.stringify(result) }] }] }),
    async () => response(result, { output: [{ type: "message", content: [] }] }),
  ];
  for (const provider of providers) {
    let calls = 0;
    const classify = createClassifier({ prompt, apiKey: "test", enabled: true, fetcher: async () => { calls++; return provider(); } });
    const run = await classify("запрос игрока");
    assert.equal(run.source, "fallback");
    assert.equal(classifiedMessage("запрос игрока", run).status, "pending");
    assert.equal(calls, 1);
  }
});

test("questions go to admin until FAQ exists; violations are a separate box, not trash", async () => {
  for (const box of ["question", "violation"] as const) {
    const classify = createClassifier({ prompt, apiKey: "test", enabled: true, fetcher: async () => response({ ...result, box }) });
    const message = classifiedMessage("message", await classify("message"));
    assert.equal(message.processing.box, box);
    assert.equal(message.status, "pending");
    if (box === "question") assert.match(message.processing.steps[3].detail!, /База готовых ответов пока не подключена/);
  }
});

test("input validation precedes API call; output booleans and boxes are checked", async () => {
  const classify = createClassifier({ prompt });
  await assert.rejects(classify(" "));
  await assert.rejects(classify("x".repeat(2001)));
  assert.throws(() => validateClassification({ ...result, needs_human: "false" }));
  assert.throws(() => validateClassification({ ...result, box: "request" }));
});

test("limits fresh requests per process and preserves token usage on incomplete results", async () => {
  let calls = 0;
  const classify = createClassifier({ prompt, apiKey: "test", enabled: true, now: () => 0, fetcher: async () => { calls++; return response(result, { status: "incomplete" }); } });
  const run = await classify("first");
  assert.equal(run.usage?.input_tokens, 2000);
  for (let i = 1; i < 31; i++) await classify(String(i));
  assert.equal(calls, 30);
});

test("preserves OpenAI cache read and cache write tokens for cost measurement", async () => {
  const classify = createClassifier({ prompt, apiKey: "test", enabled: true, fetcher: async () => response(result, {
    usage: { input_tokens: 1600, output_tokens: 80, input_tokens_details: { cached_tokens: 1024, cache_write_tokens: 128 } },
  }) });
  assert.deepEqual((await classify("Стоимость обработки")).usage, {
    input_tokens: 1600, output_tokens: 80, cached_input_tokens: 1024, cache_write_input_tokens: 128,
  });
});

test("an extra baseUrl option cannot redirect the OpenAI key to another host", async () => {
  let calls = 0;
  const options = {
    prompt, apiKey: "secret-test", enabled: true, baseUrl: "https://untrusted.example/v1",
    fetcher: async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer secret-test");
      return response();
    },
  };
  assert.equal((await createClassifier(options)("message")).source, "model");
  assert.equal(calls, 1);
});

test("rejects alternate models before requests and accepts the configured OpenAI model", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return response(); };
  for (const model of ["qwen3.7-flash", "gpt-6-astra", "gpt-6-luna-2099-01-01"]) {
    assert.throws(() => createClassifier({ prompt, apiKey: "test", enabled: true, model, fetcher }));
  }
  assert.equal(calls, 0);
  const configured = createClassifier({ prompt, apiKey: "test", enabled: true, model: "gpt-6-luna", fetcher });
  assert.equal((await configured("message")).source, "model");
  assert.equal(calls, 1);
});
