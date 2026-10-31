import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { knowledgeEntries } from '@/db/schema';
import { isAdmin, publicDemoEnabled, jsonMutation, rejectMutation } from '@/lib/access';
import { loadKnowledge, validateKnowledge } from '@/lib/knowledge-store';
import { KNOWLEDGE_ENTRIES } from '@/lib/knowledge-base';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!await isAdmin(request, env.SUPPORT_ADMIN_PASSWORD, publicDemoEnabled(env.SUPPORT_DEMO_MODE))) return Response.json({ error: 'Войдите как администратор.' }, { status: 401 });
  return Response.json(await loadKnowledge(), { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  if (!await isAdmin(request, env.SUPPORT_ADMIN_PASSWORD, publicDemoEnabled(env.SUPPORT_DEMO_MODE))) return rejectMutation(request, 'Войдите как администратор.', 401);
  if (!jsonMutation(request)) return rejectMutation(request, 'Ожидается JSON.', 415);
  const body = await request.json().catch(() => null) as { entry?: unknown; confirmed?: unknown; expectedVersion?: unknown } | null;
  const entry = validateKnowledge(body?.entry);
  if (!entry || (entry.status === 'published' && body?.confirmed !== true)) return Response.json({ error: 'Проверьте поля карточки и подтвердите источник перед публикацией.' }, { status: 400 });
  const db = getDb(), [stored] = await db.select().from(knowledgeEntries).where(eq(knowledgeEntries.id, entry.id));
  const currentVersion = stored?.entry.version ?? KNOWLEDGE_ENTRIES.find(item => item.id === entry.id)?.version ?? null;
  const conflict = () => Response.json({ error: 'Карточку уже изменили. Обновите базу и сравните изменения.' }, { status: 409 });
  if (body?.expectedVersion !== currentVersion) return conflict();
  const saved = stored
    ? await db.update(knowledgeEntries).set({ entry, updatedAt: Date.now() }).where(and(eq(knowledgeEntries.id, entry.id), eq(knowledgeEntries.entry, stored.entry))).returning()
    : await db.insert(knowledgeEntries).values({ id: entry.id, entry, updatedAt: Date.now() }).onConflictDoNothing().returning();
  if (!saved.length) return conflict();
  return Response.json(entry);
}
