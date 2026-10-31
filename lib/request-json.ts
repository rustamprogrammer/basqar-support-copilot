export const MAX_JSON_BODY_BYTES = 80 * 1024;
export const MAX_KNOWLEDGE_BODY_BYTES = 320 * 1024;
export const MAX_DELETE_BODY_BYTES = 1024 * 1024;

type JsonBody = { data: unknown; response?: never } | { data?: never; response: Response };

// Validate the byte stream before JSON.parse: text-field limits do not bound
// padding or unrecognized fields, and Content-Length may be absent or wrong.
// Invalid JSON remains null so each route keeps its existing validation errors.
export async function readRequestJson(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<JsonBody> {
  if (!request.body) return { data: null };
  const tooLarge = () => ({ response: Response.json({ error: `Размер запроса превышает ${maxBytes / 1024} КБ.` }, { status: 413, headers: { 'Cache-Control': 'no-store' } }) });
  const length = request.headers.get('content-length');
  if (length !== null && /^\d+$/u.test(length) && Number(length) > maxBytes) {
    await request.body.cancel().catch(() => undefined);
    return tooLarge();
  }
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, raw = '', complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      bytes += value.byteLength;
      if (bytes > maxBytes) return tooLarge();
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return { data: JSON.parse(raw) as unknown };
  } catch { return { data: null }; }
  finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
