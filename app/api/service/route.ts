import { and, eq } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { messages } from '@/db/schema';
import { isAdmin, publicDemoEnabled, visitor, jsonMutation, rejectMutation } from '@/lib/access';
import { updateSupportState, type ServiceAction } from '@/lib/support-state';
import { caseMutationGuard, latestCaseId } from '@/lib/server-cases';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!jsonMutation(request)) return rejectMutation(request, 'Ожидается JSON.', 415);
  const body = await request.json().catch(() => null) as { id?: unknown; revision?: unknown; action?: unknown; text?: unknown; level?: unknown; reason?: unknown } | null;
  if (typeof body?.id !== 'string' || !Number.isSafeInteger(body.revision) || typeof body.action !== 'string' || !['claim', 'release', 'reply', 'priority', 'helped', 'need_admin', 'escalate'].includes(body.action)) return Response.json({ error: 'Некорректное действие.' }, { status: 400 });
  const admin = await isAdmin(request, env.SUPPORT_ADMIN_PASSWORD, publicDemoEnabled(env.SUPPORT_DEMO_MODE)), owner = await visitor(request);
  const db = getDb(), [row] = await db.select().from(messages).where(eq(messages.id, body.id));
  if (!row || (!admin && (!owner.hash || row.ownerHash !== owner.hash))) return Response.json({ error: 'Обращение недоступно.' }, { status: 404 });
  const latestId = await latestCaseId(row);
  if (latestId !== row.id) return Response.json({ error: 'Появилось уточнение. Обновите обращение.', latestId }, { status: 409 });
  if ((row.service?.revision ?? 0) !== body.revision) return Response.json({ error: 'Обращение изменилось. Обновите страницу.' }, { status: 409 });
  if (row.status === 'trash' || row.status === 'violation') return Response.json({ error: 'Сначала верните обращение на проверку.' }, { status: 400 });
  try {
    const service = updateSupportState(row, body.action as ServiceAction, { text: typeof body.text === 'string' ? body.text : undefined, level: body.level === 'now' || body.level === 'high' || body.level === 'normal' ? body.level : undefined, reason: typeof body.reason === 'string' ? body.reason : undefined }, Date.now(), admin);
    const status = body.action === 'helped' ? 'accepted' : body.action === 'need_admin' || body.action === 'release' || body.action === 'claim' || body.action === 'escalate' ? 'pending' : row.status;
    const [saved] = await db.update(messages).set({ service, status }).where(and(eq(messages.id, row.id), caseMutationGuard(row))).returning();
    if (!saved) return Response.json({ error: 'Обращение изменилось. Обновите страницу.', latestId: await latestCaseId(row) }, { status: 409 });
    const { ownerHash: _, ...safe } = saved;
    return Response.json(safe);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Не удалось сохранить действие.' }, { status: 400 }); }
}
