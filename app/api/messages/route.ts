import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { env } from "cloudflare:workers";
import { createClassifier } from "@/lib/classifier";
import { classifiedMessage } from "@/lib/classifier-message";
import classifierPrompt from "@/classifier-prompt.md?raw";
import { normalizeMessageBox } from "@/lib/message-types";

let classifier: ReturnType<typeof createClassifier> | undefined;
function getClassifier() {
  classifier ??= createClassifier({ prompt: classifierPrompt, apiKey: env.OPENAI_API_KEY, model: env.OPENAI_TRIAGE_MODEL,
    enabled: env.TRIAGE_ENABLED === "true" });
  return classifier;
}

export const dynamic = "force-dynamic";
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  try {
    const rows = await getDb().select().from(messages).orderBy(desc(messages.createdAt));
    return Response.json(rows.map(normalizeMessageBox), { headers: { "Cache-Control": "no-store" } });
  } catch { return fail("Не удалось загрузить сообщения.", 503); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { text?: unknown; id?: unknown } | null;
  const originalText = typeof body?.text === "string" ? body.text : "";
  const text = originalText.trim();
  if (!text) return fail("Введите сообщение.");
  if (originalText.length > 2000) return fail("Максимум 2000 символов.");
  if (typeof body?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) return fail("Некорректное сообщение.");
  try {
    // A completed retry with the same ID must not incur another model call.
    const [existing] = await getDb().select().from(messages).where(eq(messages.id, body.id));
    if (existing) return Response.json(normalizeMessageBox(existing));
    const processed = classifiedMessage(originalText, await getClassifier()(originalText));
    const message = { id: body.id, text: processed.text, originalText, processing: processed.processing, status: processed.status, createdAt: Date.now() };
    await getDb().insert(messages).values(message).onConflictDoNothing();
    const [saved] = await getDb().select().from(messages).where(eq(messages.id, message.id));
    return Response.json(normalizeMessageBox(saved), { status: 201 });
  } catch { return fail("Не удалось отправить. Попробуйте ещё раз.", 503); }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as { id?: unknown; status?: unknown } | null;
  if (typeof body?.id !== "string" || (body?.status !== "accepted" && body?.status !== "trash")) return fail("Некорректное действие.");
  try {
    const [updated] = await getDb().update(messages).set({ status: body.status }).where(eq(messages.id, body.id)).returning();
    return updated ? Response.json(normalizeMessageBox(updated)) : fail("Сообщение не найдено.", 404);
  } catch { return fail("Не удалось сохранить решение.", 503); }
}
