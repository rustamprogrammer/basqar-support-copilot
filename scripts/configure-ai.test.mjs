import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureLocalAi, KEY_FILE_LIMIT, parseConfigureArgs, parseKeyFile, readKeyFile, requestLocalJson, RESPONSE_LIMIT } from './configure-ai.mjs';

const fakeKey = `sk-${'fixtureOnly'.repeat(4)}`;
const health = { ok: true, service: 'basqar', aiLimit: 100, build: { mode: 'build' } };
const settings = { configured: false, enabled: false, active: false, mode: 'all', model: 'gpt-old', used: 23, limit: 100, remaining: 77,
  canManage: true, encryptionReady: true, policyVersion: 'contest-rag-4' };
function fixture(before = {}, after = {}) {
  const calls = [];
  const reads = [];
  return { calls, reads, dependencies: {
    readKey: filename => { reads.push(filename); return fakeKey; },
    requestJson: async (port, pathname, options) => {
      calls.push({ port, pathname, options });
      if (pathname === '/api/health') return health;
      if (!options) return { ...settings, ...before };
      return { ...settings, configured: true, enabled: true, active: true, mode: 'uncertain', model: 'gpt-6-luna', ...before, ...after };
    },
  } };
}

test('key file accepts one unquoted or quoted assignment without evaluating unrelated environment', () => {
  for (const value of [fakeKey, `"${fakeKey}"`, `'${fakeKey}'`]) {
    assert.equal(parseKeyFile(`\uFEFF# local fixture\r\nOTHER=$(dangerous)\r\nexport OPENAI_API_KEY = ${value} # comment\r\n`), fakeKey);
  }
  for (const source of [`OPENAI_API_KEY=${fakeKey}\nOPENAI_API_KEY=${fakeKey}`, 'OPENAI_API_KEY=', 'OTHER=only',
    'OPENAI_API_KEY=$(cat private)', `OPENAI_API_KEY="${fakeKey}\nother"`, 'x'.repeat(KEY_FILE_LIMIT + 1)]) {
    assert.throws(() => parseKeyFile(source));
  }
});

test('file reader bounds data and rejects directory or missing files without exposing error contents', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'basqar-configure-test-'));
  try {
    const filename = path.join(directory, '.dev.vars');
    writeFileSync(filename, `OPENAI_API_KEY=${fakeKey}\n`);
    assert.equal(readKeyFile(filename), fakeKey);
    writeFileSync(filename, 'x'.repeat(KEY_FILE_LIMIT + 1));
    for (const invalid of [filename, directory, path.join(directory, fakeKey)]) {
      assert.throws(() => readKeyFile(invalid), error => !error.message.includes(fakeKey));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CLI accepts only a local numeric port and file options, with explicit rotation', () => {
  assert.deepEqual(parseConfigureArgs([]), { keyFile: '.dev.vars', port: 8787, replaceKey: false, help: false });
  assert.deepEqual(parseConfigureArgs(['--port', '9000', '--key-file', 'team.vars', '--replace-key']),
    { keyFile: 'team.vars', port: 9000, replaceKey: true, help: false });
  for (const args of [['--port', '0'], ['--port', '65536'], ['--port', 'https://remote'], ['--port'],
    ['--key-file'], ['--replace-key', '--replace-key'], ['--key', fakeKey], [fakeKey]]) {
    assert.throws(() => parseConfigureArgs(args), error => !error.message.includes(fakeKey));
  }
});

test('first import explicitly enables the default jury mode while preserving the paid counter', async () => {
  const state = fixture({}, { used: 24, remaining: 76 }); // Another client may reserve while configuring.
  const result = await configureLocalAi({ root: process.cwd() }, state.dependencies);
  assert.equal(state.reads.length, 1);
  assert.deepEqual(state.calls.map(call => [call.port, call.pathname]), [[8787, '/api/health'], [8787, '/api/settings'], [8787, '/api/settings']]);
  assert.deepEqual(state.calls[2].options, { method: 'POST', body: { enabled: true, mode: 'uncertain', model: 'gpt-6-luna', apiKey: fakeKey } });
  assert.deepEqual(result, { imported: true, active: true, used: 24, limit: 100, remaining: 76, mode: 'uncertain', model: 'gpt-6-luna' });
  assert.equal(JSON.stringify(result).includes(fakeKey), false);
});

test('existing encrypted key is reused without reading a file; replacement requires its explicit flag', async () => {
  const state = fixture({ configured: true }, { mode: 'uncertain', model: 'gpt-6-luna' });
  const result = await configureLocalAi({}, state.dependencies);
  assert.equal(result.imported, false);
  assert.equal(state.reads.length, 0);
  assert.equal(Object.hasOwn(state.calls[2].options.body, 'apiKey'), false);
  const rotation = fixture({ configured: true }, { mode: 'uncertain', model: 'gpt-6-luna' });
  await configureLocalAi({ replaceKey: true }, rotation.dependencies);
  assert.equal(rotation.reads.length, 1);
  assert.equal(rotation.calls[2].options.body.apiKey, fakeKey);
});

test('wrong application or unhealthy build is rejected before settings/key access', async () => {
  for (const invalid of [{ ...health, service: 'other' }, { ...health, ok: false }, { ...health, build: { mode: 'unknown' } }]) {
    let calls = 0;
    await assert.rejects(configureLocalAi({}, { readKey: () => assert.fail('must not read key'), requestJson: async () => { calls++; return invalid; } }));
    assert.equal(calls, 1);
  }
});

test('untrusted settings, unavailable encryption and exhausted quota fail before importing the key', async () => {
  for (const override of [{ canManage: false }, { encryptionReady: false }, { used: 100, remaining: 0 },
    { limit: 1000 }, { remaining: 90 }, { policyVersion: 'other-service' }]) {
    const state = fixture(override);
    await assert.rejects(configureLocalAi({}, state.dependencies));
    assert.equal(state.reads.length, 0);
    assert.equal(state.calls.length, 2);
  }
});

test('ambiguous POST failure is not retried and cannot leak server error text', async () => {
  const state = fixture();
  const original = state.dependencies.requestJson;
  let mutations = 0;
  state.dependencies.requestJson = async (...args) => {
    if (args[2]) { mutations++; throw new Error(`server echoed ${fakeKey}`); }
    return original(...args);
  };
  await assert.rejects(configureLocalAi({}, state.dependencies), error => /перед повторным запуском/u.test(error.message) && !error.message.includes(fakeKey));
  assert.equal(mutations, 1);
});

test('unexpected mutation result or counter decrease is rejected rather than reported as success', async () => {
  for (const override of [{ used: 0, remaining: 100 }, { enabled: false }, { configured: false }, { mode: 'all' }, { model: 'gpt-other' }]) {
    const state = fixture({}, override);
    await assert.rejects(configureLocalAi({}, state.dependencies));
    assert.equal(state.calls.length, 3);
  }
});

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('real loopback transport sends JSON with matching Origin and does not rely on cookies', async () => {
  await withServer((request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/settings');
    assert.equal(request.headers.origin, `http://${request.headers.host}`);
    assert.equal(request.headers.cookie, undefined);
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      assert.deepEqual(JSON.parse(body), { apiKey: fakeKey });
      response.setHeader('Content-Type', 'application/json');
      response.end('{"ok":true}');
    });
  }, async port => assert.deepEqual(await requestLocalJson(port, '/api/settings', { method: 'POST', body: { apiKey: fakeKey } }), { ok: true }));
});

test('loopback transport does not follow redirects or include rejected server bodies in errors', async () => {
  let calls = 0;
  await withServer((_request, response) => {
    calls++;
    response.writeHead(302, { Location: '/redirected' });
    response.end(fakeKey);
  }, async port => await assert.rejects(requestLocalJson(port, '/api/settings'), error => !error.message.includes(fakeKey)));
  assert.equal(calls, 1);
});

test('loopback transport bounds streamed response size and total response time', async () => {
  await withServer((_request, response) => response.end('x'.repeat(RESPONSE_LIMIT + 1)),
    async port => await assert.rejects(requestLocalJson(port, '/api/settings'), /слишком большой/u));
  await withServer((_request, response) => { response.writeHead(200); response.write('{'); },
    async port => await assert.rejects(requestLocalJson(port, '/api/settings', { timeoutMs: 25 }), /не ответил/u));
});
