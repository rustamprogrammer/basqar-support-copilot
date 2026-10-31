import test from 'node:test';
import assert from 'node:assert/strict';
import { readRequestJson } from './request-json.ts';

function streamed(chunks: Uint8Array[], headers?: HeadersInit, cancelled?: () => void) {
  return new Request('http://localhost/api/messages', { method: 'POST', headers,
    body: new ReadableStream<Uint8Array>({
      pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close(); },
      cancel() { cancelled?.(); },
    }), duplex: 'half',
  } as RequestInit);
}
const encode = (value: string) => new TextEncoder().encode(value);

test('JSON reader handles UTF-8 split across chunks and the exact byte limit', async () => {
  const bytes = encode('{"text":"Привет"}');
  const result = await readRequestJson(streamed(Array.from(bytes, byte => Uint8Array.of(byte))), bytes.length);
  assert.deepEqual(result.data, { text: 'Привет' });
  assert.equal(result.response, undefined);
});

test('JSON reader bounds streamed bytes even when Content-Length lies or is absent', async () => {
  for (const headers of [undefined, { 'content-length': '2' }]) {
    let cancelled = false;
    const request = streamed([encode('{"text":"ok","padding":"'), encode('x'.repeat(64)), encode('"}')], headers, () => { cancelled = true; });
    const result = await readRequestJson(request, 32);
    assert.equal(result.response?.status, 413);
    assert.equal(cancelled, true);
    assert.equal(request.body?.locked, false);
  }
});

test('JSON reader rejects oversized Content-Length without parsing the body', async () => {
  let cancelled = false;
  const result = await readRequestJson(streamed([encode('{}')], { 'content-length': '100' }, () => { cancelled = true; }), 32);
  assert.equal(result.response?.status, 413);
  assert.equal(cancelled, true);
});

test('malformed JSON, invalid UTF-8 and empty bodies preserve route validation', async () => {
  for (const bytes of [encode('{'), Uint8Array.of(0xc3, 0x28), encode('')]) {
    assert.deepEqual(await readRequestJson(streamed([bytes])), { data: null });
  }
  assert.deepEqual(await readRequestJson(new Request('http://localhost', { method: 'POST' })), { data: null });
});

test('JSON reader cancels invalid UTF-8 before consuming the rest of a large body', async () => {
  let cancelled = false;
  const request = streamed([Uint8Array.of(0xff), encode('x'.repeat(1000))], undefined, () => { cancelled = true; });
  assert.deepEqual(await readRequestJson(request), { data: null });
  assert.equal(cancelled, true);
  assert.equal(request.body?.locked, false);
});

test('JSON reader turns interrupted uploads into the existing invalid-body result', async () => {
  const request = new Request('http://localhost', { method: 'POST', body: new ReadableStream({ start(controller) { controller.error(new Error('upload interrupted')); } }), duplex: 'half' } as RequestInit);
  assert.deepEqual(await readRequestJson(request), { data: null });
  assert.equal(request.body?.locked, false);
});
