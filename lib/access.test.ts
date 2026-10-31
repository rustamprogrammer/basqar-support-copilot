import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookieValue, digest, constantEqual, isAdmin, publicDemoEnabled, adminCookie, clearAdminCookie, visitor, jsonMutation, discardRequestBody, rejectMutation, REJECTED_BODY_LIMIT } from './access.ts';

const secret = 'test-only-administrator-secret';
const request = (cookie?: string, url = 'https://support.example.test/') => new Request(url, cookie ? { headers: { cookie } } : undefined);
const cookiePair = (value: string) => value.split(';')[0];

test('Explicit public demo opens administrator access without a password or cookie', async () => {
  assert.equal(await isAdmin(request(), undefined, true), true);
  assert.equal(await isAdmin(request('support_admin=invalid'), secret, true), true);
  assert.equal(await isAdmin(request(), undefined, false), false);
  assert.equal(publicDemoEnabled('true'), true);
  assert.equal(publicDemoEnabled(' TRUE '), true);
  assert.equal(publicDemoEnabled('false'), false);
  assert.equal(publicDemoEnabled(undefined), false);
});

test('Administrator authorization fails closed without a configured password or cookie', async () => {
  assert.equal(await isAdmin(request(), secret), false);
  assert.equal(await isAdmin(request('support_admin=1.anything'), undefined), false);
  assert.equal(await isAdmin(request('support_admin=1.anything'), ''), false);
});

test('A signed administrator cookie authorizes only the configured secret', async () => {
  const cookie = await adminCookie(request(), secret), authenticated = request(cookiePair(cookie));
  assert.equal(await isAdmin(authenticated, secret), true);
  assert.equal(await isAdmin(authenticated, 'different-test-secret'), false);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=28800/);
});

test('Changing a signed expiry or signature does not grant administrator access', async () => {
  const pair = cookiePair(await adminCookie(request(), secret));
  const token = pair.slice('support_admin='.length), [expires, signature] = token.split('.');
  assert.equal(await isAdmin(request(`support_admin=${Number(expires) + 1}.${signature}`), secret), false);
  const changed = signature.slice(0, -1) + (signature.at(-1) === 'a' ? 'b' : 'a');
  assert.equal(await isAdmin(request(`support_admin=${expires}.${changed}`), secret), false);
});

test('Expired administrator sessions are rejected even with their original signature', async context => {
  const clock = 1_800_000_000_000;
  const date = context.mock.method(Date, 'now', () => clock);
  const cookie = cookiePair(await adminCookie(request(), secret));
  date.mock.mockImplementation(() => clock + 8 * 3600_000 + 1);
  assert.equal(await isAdmin(request(cookie), secret), false);
});

test('Cookie expiration is checked at the boundary', async context => {
  const clock = 1_800_000_000_000;
  const date = context.mock.method(Date, 'now', () => clock);
  const cookie = cookiePair(await adminCookie(request(), secret));
  date.mock.mockImplementation(() => clock + 8 * 3600_000 - 1);
  assert.equal(await isAdmin(request(cookie), secret), true);
  date.mock.mockImplementation(() => clock + 8 * 3600_000);
  assert.equal(await isAdmin(request(cookie), secret), false);
});

test('Malformed tokens and similarly named cookies cannot bypass administrator authentication', async () => {
  const valid = cookiePair(await adminCookie(request(), secret));
  for (const token of ['', 'true', 'admin', '9999999999999.' + '0'.repeat(64), '1.' + '0'.repeat(64), '1234567890123.' + 'G'.repeat(64)]) {
    assert.equal(await isAdmin(request(`support_admin=${token}`), secret), false);
  }
  assert.equal(await isAdmin(request(`not_${valid}`), secret), false);
});

test('Logout deletes the administrator cookie on the same path and security policy', () => {
  const cookie = clearAdminCookie(request());
  assert.match(cookie, /^support_admin=;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
});

test('Local HTTP cookies work locally while an HTTPS tunnel sets Secure', async () => {
  const local = await adminCookie(request(undefined, 'http://127.0.0.1:8787'), secret);
  assert.doesNotMatch(local, /; Secure/);
  const tunneled = new Request('http://127.0.0.1:8787', { headers: { 'x-forwarded-proto': 'https' } });
  assert.match(await adminCookie(tunneled, secret), /; Secure/);
});

test('Reading as an unknown visitor does not manufacture ownership', async () => {
  assert.deepEqual(await visitor(request()), { hash: null, cookie: undefined });
  assert.deepEqual(await visitor(request('support_visitor=forged')), { hash: null, cookie: undefined });
});

test('Two visitors receive unrelated tokens and persist only hashes as ownership identifiers', async () => {
  const first = await visitor(request(), true), second = await visitor(request(), true);
  assert.ok(first.cookie && second.cookie && first.hash && second.hash);
  const token = cookieValue(request(cookiePair(first.cookie)), 'support_visitor');
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(first.hash, await digest(token));
  assert.notEqual(first.hash, token);
  assert.notEqual(first.hash, second.hash);
  assert.match(first.cookie, /HttpOnly; SameSite=Strict/);
});

test('Returning visitors retain ownership and do not get a new cookie on every request', async () => {
  const first = await visitor(request(), true);
  const next = await visitor(request(cookiePair(first.cookie!)), true);
  assert.equal(next.hash, first.hash);
  assert.equal(next.cookie, undefined);
});

test('Malformed visitor identity is replaced only when explicitly creating a session', async () => {
  const invalid = request('support_visitor=bad; support_admin=bad');
  assert.equal((await visitor(invalid)).hash, null);
  const created = await visitor(invalid, true);
  assert.ok(created.hash);
  assert.ok(created.cookie);
});

test('Cookie parsing isolates the requested cookie name', () => {
  const value = request('other=1; support_visitor_extra=wrong; support_visitor=right; after=2');
  assert.equal(cookieValue(value, 'support_visitor'), 'right');
  assert.equal(cookieValue(value, 'support_admin'), '');
});

test('JSON mutations reject browser form content types and accept a charset suffix', () => {
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
    assert.equal(jsonMutation(new Request('https://support.example.test/', { method: 'POST', headers: { 'Content-Type': contentType } })), false);
  }
  assert.equal(jsonMutation(new Request('https://support.example.test/', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' } })), true);
});

test('Digest and equality distinguish altered credentials', async () => {
  assert.equal(await digest('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(constantEqual('same', 'same'), true);
  assert.equal(constantEqual('same', 'samo'), false);
  assert.equal(constantEqual('same', 'same-longer'), false);
});

test('An early authorization rejection consumes a normal JSON upload before returning', async () => {
  const upload = new Request('http://127.0.0.1/api/messages', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'synthetic', status: 'accepted' }) });
  const response = await rejectMutation(upload, 'Войдите как администратор.', 401);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Войдите как администратор.' });
  assert.equal(upload.bodyUsed, true);
  assert.deepEqual(await upload.body!.getReader().read(), { done: true, value: undefined });
});

test('Rejected chunked uploads are drained without accumulating their contents', async () => {
  let pulled = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { if (pulled === 3) controller.close(); else { pulled++; controller.enqueue(new Uint8Array(1024)); } }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const upload = new Request('http://127.0.0.1/api/admin', { method: 'DELETE', body, duplex: 'half' } as RequestInit & { duplex: 'half' });
  await discardRequestBody(upload);
  assert.equal(pulled, 3); assert.equal(cancelled, false);
  assert.deepEqual(await upload.body!.getReader().read(), { done: true, value: undefined });
});

test('An unlimited upload is cancelled at the 80 KiB rejection budget', async () => {
  let pulled = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { pulled++; controller.enqueue(new Uint8Array(4096)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const upload = new Request('http://127.0.0.1/api/messages', { method: 'PATCH', body, duplex: 'half' } as RequestInit & { duplex: 'half' });
  const response = await rejectMutation(upload, 'Ожидается JSON.', 415);
  assert.equal(response.status, 415); assert.equal(cancelled, true);
  assert.equal(pulled * 4096, REJECTED_BODY_LIMIT);
  assert.equal(upload.body!.locked, false);
});

test('A large incoming chunk is cancelled immediately instead of requesting the remainder', async () => {
  let pulled = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { pulled++; controller.enqueue(new Uint8Array(REJECTED_BODY_LIMIT + 1)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const upload = new Request('http://127.0.0.1/api/messages', { method: 'PATCH', body, duplex: 'half' } as RequestInit & { duplex: 'half' });
  await discardRequestBody(upload);
  assert.equal(pulled, 1); assert.equal(cancelled, true);
});

test('An aborted rejected upload still returns its original error status', async () => {
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error('synthetic upload disconnected')); } }, { highWaterMark: 0 });
  const upload = new Request('http://127.0.0.1/api/admin', { method: 'POST', body, duplex: 'half' } as RequestInit & { duplex: 'half' });
  const response = await rejectMutation(upload, 'Слишком много попыток.', 429);
  assert.equal(response.status, 429); assert.deepEqual(await response.json(), { error: 'Слишком много попыток.' });
});

test('Discarding absent or already consumed bodies is safe', async () => {
  await discardRequestBody(new Request('http://127.0.0.1/api/admin', { method: 'DELETE' }));
  const upload = new Request('http://127.0.0.1/api/admin', { method: 'POST', body: '{}' });
  await upload.json(); await discardRequestBody(upload);
  assert.equal(upload.bodyUsed, true);
});
