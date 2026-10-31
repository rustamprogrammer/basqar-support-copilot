import { PROCESSOR_VERSION, processMessageWithTrace } from "./message-processing.ts";

const MAX_BODY_BYTES = 80 * 1024;
const response = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

// This endpoint evaluates only the rules stage; it never calls paid AI,
// loads the database or saves a message. Read the stream with a hard
// bound: Content-Length alone is neither mandatory nor trustworthy.
export async function evaluateQualityRequest(request: Request): Promise<Response> {
  const length = request.headers.get("content-length");
  if (length !== null && /^\d+$/u.test(length) && Number(length) > MAX_BODY_BYTES) {
    return response({ error: "Размер запроса превышает 80 КБ." }, 413);
  }
  if (!request.body) return response({ error: "Передайте JSON со списком texts." }, 400);

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let json = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return response({ error: "Размер запроса превышает 80 КБ." }, 413);
      }
      json += decoder.decode(chunk.value, { stream: true });
    }
    json += decoder.decode();
  } catch {
    await reader.cancel().catch(() => undefined);
    return response({ error: "Не удалось прочитать JSON." }, 400);
  } finally {
    reader.releaseLock();
  }

  let body: unknown;
  try { body = JSON.parse(json); }
  catch { return response({ error: "Некорректный JSON." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || !("texts" in body)) {
    return response({ error: "Передайте список texts из 1–10 сообщений." }, 400);
  }
  const texts = body.texts;
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > 10 ||
      !texts.every((text): text is string => typeof text === "string" && text.trim().length > 0 && text.length <= 2000)) {
    return response({ error: "Нужно 1–10 текстов, каждый от 1 до 2000 символов." }, 400);
  }
  try {
    return response({ version: PROCESSOR_VERSION, results: texts.map(text => processMessageWithTrace(text)) });
  } catch {
    return response({ error: "Не удалось проверить сообщения." }, 503);
  }
}
