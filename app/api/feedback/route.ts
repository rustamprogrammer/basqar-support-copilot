import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, messageFeedback } from "@/db/schema";
import { exportFeedback, parseFeedback } from "@/lib/feedback";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
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

export async function GET() {
  try {
    const rows = await getDb().select({ message: messages, feedback: messageFeedback }).from(messageFeedback)
      .innerJoin(messages, eq(messageFeedback.messageId, messages.id));
    const body = rows.map(({ message, feedback }) => JSON.stringify(exportFeedback(message, feedback))).join("\n");
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": 'attachment; filename="feedback.jsonl"', "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Не удалось выгрузить разметку." }, { status: 503 }); }
}
