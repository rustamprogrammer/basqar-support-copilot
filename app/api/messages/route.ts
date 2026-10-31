import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, messageFeedback } from "@/db/schema";
import { processServerMessage } from "@/lib/server-review";
import { prepareClarification } from "@/lib/message-context";
import { messageClearStatements, parseMessageClearRequest } from "@/lib/message-clearing";

export const dynamic = "force-dynamic";
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  try {
    const rows = await getDb().select({ message: messages, feedback: messageFeedback }).from(messages)
      .leftJoin(messageFeedback, eq(messages.id, messageFeedback.messageId)).orderBy(desc(messages.createdAt));
    return Response.json(rows.map(row => ({ ...row.message, feedback: row.feedback })), { headers: { "Cache-Control": "no-store" } });
  } catch { return fail("Не удалось загрузить сообщения.", 503); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { text?: unknown; id?: unknown; parentId?: unknown } | null;
  let originalText = typeof body?.text === "string" ? body.text : "";
  const text = originalText.trim();
  if (!text) return fail("Введите сообщение.");
  if (originalText.length > 2000) return fail("Максимум 2000 символов.");
  if (typeof body?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) return fail("Некорректное сообщение.");
  if (body.parentId !== undefined && (typeof body.parentId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.parentId))) return fail("Некорректное исходное обращение.");
  try {
    const db = getDb();
    const [existing] = await db.select().from(messages).where(eq(messages.id, body.id));
    if (existing) return Response.json(existing, { status: 201 });
    let context;
    if (typeof body.parentId === "string") {
      const [parent] = await db.select().from(messages).where(eq(messages.id, body.parentId));
      const prepared = prepareClarification(parent, originalText);
      if (prepared.error !== undefined) return fail(prepared.error, prepared.status);
      originalText = prepared.originalText;
      context = prepared.context;
    }
    const processed = await processServerMessage(originalText, context);
    const message = { id: body.id, text: processed.text, originalText, processing: processed.processing, status: processed.status, createdAt: Date.now() };
    await db.insert(messages).values(message).onConflictDoNothing();
    const [saved] = await db.select().from(messages).where(eq(messages.id, message.id));
    return Response.json(saved, { status: 201 });
  } catch { return fail("Не удалось отправить. Попробуйте ещё раз.", 503); }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as { id?: unknown; status?: unknown } | null;
  if (typeof body?.id !== "string" || (body?.status !== "accepted" && body?.status !== "trash" && body?.status !== "violation" && body?.status !== "pending")) return fail("Некорректное действие.");
  try {
    const [updated] = await getDb().update(messages).set({ status: body.status }).where(eq(messages.id, body.id)).returning();
    return updated ? Response.json(updated) : fail("Сообщение не найдено.", 404);
  } catch { return fail("Не удалось сохранить решение.", 503); }
}

export async function DELETE(request: Request) {
  const ids = parseMessageClearRequest(await request.json().catch(() => null));
  if (!ids) return fail("Подтвердите список сообщений для удаления.");
  try {
    const client = getDb().$client;
    const [feedbackResult, messagesResult] = await client.batch(
      messageClearStatements(ids).map(statement => client.prepare(statement.sql).bind(statement.snapshot)),
    );
    return Response.json({ deletedCount: messagesResult.meta.changes, deletedFeedbackCount: feedbackResult.meta.changes });
  } catch { return fail("Не удалось очистить сообщения. Попробуйте ещё раз.", 503); }
}
