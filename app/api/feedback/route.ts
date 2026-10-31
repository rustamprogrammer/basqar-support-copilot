import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, messageFeedback } from "@/db/schema";
import { exportFeedback, parseFeedback } from "@/lib/feedback";
import { env } from 'cloudflare:workers';
import { isAdmin, publicDemoEnabled, jsonMutation, rejectMutation } from '@/lib/access';

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!await isAdmin(request, env.SUPPORT_ADMIN_PASSWORD, publicDemoEnabled(env.SUPPORT_DEMO_MODE))) return rejectMutation(request, 'Войдите как администратор.', 401);
  if (!jsonMutation(request)) return rejectMutation(request, 'Ожидается JSON.', 415);
  const input = parseFeedback(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "Проверьте категорию и длину текста." }, { status: 400 });
  try {
    const db = getDb();
    const [message] = await db.select().from(messages).where(eq(messages.id, input.messageId));
    if (!message) return Response.json({ error: "Сообщение не найдено." }, { status: 404 });
    const row = { ...input, updatedAt: Date.now() };
    await db.insert(messageFeedback).values(row).onConflictDoUpdate({ target: messageFeedback.messageId, set: row });
    return Response.json(row);
  } catch { return Response.json({ error: "Не удалось сохранить разметку." }, { status: 503 }); }
}

export async function GET(request: Request) {
  if (!await isAdmin(request, env.SUPPORT_ADMIN_PASSWORD, publicDemoEnabled(env.SUPPORT_DEMO_MODE))) return Response.json({ error: 'Войдите как администратор.' }, { status: 401 });
  try {
    const rows = await getDb().select({ message: messages, feedback: messageFeedback }).from(messageFeedback)
      .innerJoin(messages, eq(messageFeedback.messageId, messages.id));
    const body = rows.map(({ message, feedback }) => JSON.stringify(exportFeedback(message, feedback))).join("\n");
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": 'attachment; filename="feedback.jsonl"', "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Не удалось выгрузить разметку." }, { status: 503 }); }
}
