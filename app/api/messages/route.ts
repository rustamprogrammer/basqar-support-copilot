import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";

export const dynamic = "force-dynamic";
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const helpWord = new RegExp("(^|[^\\p{L}\\p{N}_])помощь(?=$|[^\\p{L}\\p{N}_])", "iu");

export async function GET() {
  try {
    const rows = await getDb().select().from(messages).orderBy(desc(messages.createdAt));
    return Response.json(rows, { headers: { "Cache-Control": "no-store" } });
  } catch { return fail("Не удалось загрузить сообщения.", 503); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { text?: unknown; id?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return fail("Введите сообщение.");
  if (text.length > 2000) return fail("Максимум 2000 символов.");
  if (typeof body?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) return fail("Некорректное сообщение.");
  try {
    const message = { id: body.id, text, status: helpWord.test(text.normalize("NFKC")) ? "pending" as const : "trash" as const, createdAt: Date.now() };
    await getDb().insert(messages).values(message).onConflictDoNothing();
    const [saved] = await getDb().select().from(messages).where(eq(messages.id, message.id));
    return Response.json(saved, { status: 201 });
  } catch { return fail("Не удалось отправить. Попробуйте ещё раз.", 503); }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as { id?: unknown; status?: unknown } | null;
  if (typeof body?.id !== "string" || (body?.status !== "accepted" && body?.status !== "trash")) return fail("Некорректное действие.");
  try {
    const [updated] = await getDb().update(messages).set({ status: body.status }).where(eq(messages.id, body.id)).returning();
    return updated ? Response.json(updated) : fail("Сообщение не найдено.", 404);
  } catch { return fail("Не удалось сохранить решение.", 503); }
}
