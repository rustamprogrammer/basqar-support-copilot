const encoder = new TextEncoder();
export function cookieValue(request: Request, name: string) {
  return request.headers.get('cookie')?.split(';').map(p => p.trim()).find(p => p.startsWith(name + '='))?.slice(name.length + 1) ?? '';
}
export async function digest(value: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
function cookie(request: Request, name: string, value: string, age: number) {
  const secure = new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
}
async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function constantEqual(a: string, b: string) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
export function publicDemoEnabled(value?: string) { return value?.trim().toLowerCase() === 'true'; }
export async function isAdmin(request: Request, secret?: string, publicDemo = false) {
  if (publicDemo) return true;
  if (!secret) return false;
  const value = cookieValue(request, 'support_admin');
  if (!/^\d{13}\.[a-f0-9]{64}$/.test(value)) return false;
  const [expires, signed] = value.split('.');
  return Number(expires) > Date.now() && Number(expires) <= Date.now() + 8 * 3600_000 && constantEqual(signed, await signature(expires, secret));
}
export async function adminCookie(request: Request, secret: string) {
  const expires = String(Date.now() + 8 * 3600_000);
  return cookie(request, 'support_admin', `${expires}.${await signature(expires, secret)}`, 8 * 3600);
}
export function clearAdminCookie(request: Request) { return cookie(request, 'support_admin', '', 0); }
export async function visitor(request: Request, create = false) {
  const existing = cookieValue(request, 'support_visitor');
  const token = /^[a-f0-9]{64}$/.test(existing) ? existing : create ? crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '') : '';
  return { hash: token ? await digest(token) : null, cookie: token && token !== existing ? cookie(request, 'support_visitor', token, 30 * 86400) : undefined };
}
export function jsonMutation(request: Request) {
  return request.headers.get('content-type')?.split(';')[0].trim() === 'application/json';
}

export const REJECTED_BODY_LIMIT = 80 * 1024;
// Drain small rejected requests before responding: the local proxy reuses its connection.
// Never accumulate the body; stop and cancel the reader at the byte budget.
export async function discardRequestBody(request: Request): Promise<void> {
  if (!request.body || request.bodyUsed) return;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = request.body.getReader(); } catch { return; }
  let consumed = 0, complete = false;
  try {
    while (consumed < REJECTED_BODY_LIMIT) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      consumed += value.byteLength;
    }
  } catch { /* Preserve the intended rejection even if the upload was aborted. */ }
  finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function rejectMutation(request: Request, error: string, status = 400) {
  await discardRequestBody(request);
  return Response.json({ error }, { status });
}
