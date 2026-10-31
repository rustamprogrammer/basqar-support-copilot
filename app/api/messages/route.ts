import { and, desc, eq, gte } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { messages, messageFeedback } from '@/db/schema';
import { processServerMessage } from '@/lib/server-review';
import { prepareClarification } from '@/lib/message-context';
import { messageClearStatements, parseMessageClearRequest } from '@/lib/message-clearing';
import { isAdmin, publicDemoEnabled, visitor, jsonMutation, rejectMutation } from '@/lib/access';
import { loadKnowledge } from '@/lib/knowledge-store';
import { createSupportState } from '@/lib/support-state';
import { caseMutationGuard, latestCaseId } from '@/lib/server-cases';
import { caseSnapshotGuard } from '@/lib/case-guard';
import { triage } from '@/lib/triage/engine';
import { ruleCorpus } from '@/lib/triage/runtime';
import { selectorStatement } from '@/lib/inbox-query';
import { readRequestJson, MAX_DELETE_BODY_BYTES } from '@/lib/request-json';
import { managedContestModel, ContestInProgressError } from '@/lib/triage/managed-model';
import { applyContestToSupport } from '@/lib/triage/support-adapter';
import { refreshTriageAfterKnowledgeChange } from '@/lib/triage/knowledge-refresh';
import type { Ticket } from '@/lib/triage/types';
export const dynamic = 'force-dynamic';
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const publicRow = <T extends { ownerHash: string | null }>(row: T) => {
  const safe = { ...row };
  Reflect.deleteProperty(safe, 'ownerHash');
  return safe as Omit<T, 'ownerHash'>;
};
export async function GET(request: Request) {
  try {
    const admin = await isAdmin(request, env.SUPPORT_ADMIN_PASSWORD, publicDemoEnabled(env.SUPPORT_DEMO_MODE)), owner = await visitor(request), params = new URL(request.url).searchParams;
    if ((params.get('scope') === 'admin' || params.get('idsOnly') === 'true') && !admin) return fail('Войдите как администратор.', 401);
    if (params.get('idsOnly') === 'true') {
      const result = await getDb().$client.prepare('SELECT id FROM messages ORDER BY created_at DESC, id DESC').all<{ id: string }>();
      return Response.json({ ids: result.results.map(row => row.id) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (!admin && !owner.hash) return Response.json([], { headers: { 'Cache-Control': 'no-store' } });
    const id = params.get('id');
    if (params.get('view') === 'selector' && !id) {
      const statement = selectorStatement(params, admin ? null : owner.hash!);
      const result = await getDb().$client.prepare(statement.sql).bind(...statement.params).all<{ id: string; text: string; originalText: string | null; createdAt: number; processing: string }>();
      return Response.json(result.results.map(row => ({ ...row, processing: JSON.parse(row.processing) })), { headers: { 'Cache-Control': 'no-store' } });
    }
    const conditions = [!admin ? eq(messages.ownerHash, owner.hash!) : undefined, id ? eq(messages.id, id) : undefined].filter(Boolean);
    const rows = await getDb().select({ message: messages, feedback: messageFeedback }).from(messages)
      .leftJoin(messageFeedback, eq(messages.id, messageFeedback.messageId)).where(and(...conditions)).orderBy(desc(messages.createdAt));
    return Response.json(rows.map(row => ({ ...publicRow(row.message), feedback: admin ? row.feedback : null })), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return fail('Не удалось загрузить сообщения.', 503); }
}
export async function POST(request: Request) {
  if (!jsonMutation(request)) return rejectMutation(request, 'Ожидается JSON.', 415);
  const parsed = await readRequestJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.data as { text?: unknown; id?: unknown; parentId?: unknown } | null;
  let originalText = typeof body?.text === 'string' ? body.text : '';
  if (!originalText.trim()) return fail('Введите сообщение.');
  if (originalText.length > 2000) return fail('Максимум 2000 символов.');
  if (typeof body?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return fail('Некорректное сообщение.');
  if (body.parentId !== undefined && (typeof body.parentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.parentId))) return fail('Некорректное исходное обращение.');
  try {
    const db = getDb(), owner = await visitor(request, true), admin = await isAdmin(request, env.SUPPORT_ADMIN_PASSWORD, publicDemoEnabled(env.SUPPORT_DEMO_MODE));
    // Establish ownership before writing. A lost first response must never orphan an inserted message.
    if (owner.cookie) return Response.json({ code: 'session_required', error: 'Сессия создана. Повторите отправку.' }, { status: 409, headers: { 'Set-Cookie': owner.cookie, 'Cache-Control': 'no-store' } });
    const response = (row: typeof messages.$inferSelect) => Response.json(publicRow(row), { status: 201, headers: owner.cookie ? { 'Set-Cookie': owner.cookie } : undefined });
    const [existing] = await db.select().from(messages).where(eq(messages.id, body.id));
    if (existing) return existing.ownerHash === owner.hash || admin ? response(existing) : fail('Сообщение недоступно.', 404);
    let context, parent;
    if (typeof body.parentId === 'string') {
      [parent] = await db.select().from(messages).where(eq(messages.id, body.parentId));
      if (!parent || (!admin && parent.ownerHash !== owner.hash)) return fail('Исходное сообщение недоступно.', 404);
      const latestId = await latestCaseId(parent);
      if (latestId !== parent.id) return Response.json({ error: 'У обращения уже есть более новое уточнение. Обновите страницу.', latestId }, { status: 409 });
      const prepared = prepareClarification(parent, originalText);
      if (prepared.error !== undefined) return fail(prepared.error, prepared.status);
      originalText = prepared.originalText; context = prepared.context;
    } else {
      const recent = await db.select().from(messages).where(and(eq(messages.ownerHash, owner.hash!), eq(messages.originalText, originalText), eq(messages.status, 'pending'), gte(messages.createdAt, Date.now() - 120_000))).orderBy(desc(messages.createdAt));
      const duplicate = recent.find(row => row.processing?.route === 'help' && (!row.service || ['queued', 'in_progress'].includes(row.service.state)));
      if (duplicate) return response(duplicate);
    }
    const entries = await loadKnowledge();
    let local = processServerMessage(originalText, context, entries);
    const ticket: Ticket = { kind: 'report', ticket_id: body.id, messages: [{ role: 'player', text: originalText }] };
    const baseline = triage(ticket, { corpus: ruleCorpus, support: local, entries });
    const reviewed = await managedContestModel({ ticket, baseline, corpus: ruleCorpus, db: db.$client, secret: env.SUPPORT_SETTINGS_SECRET, clientHash: owner.hash! });
    // A published FAQ can change while the async review/cache lookup is running.
    // Re-evaluate a stale card before creating an automatic knowledge reply.
    const priorAnswer = local.processing.knowledge;
    if (priorAnswer?.status === 'answered') {
      const currentEntries = await loadKnowledge();
      if (!currentEntries.some(entry => entry.id === priorAnswer.entryId && entry.version === priorAnswer.entryVersion && entry.status === 'published')) {
        local = processServerMessage(originalText, context, currentEntries);
        if (reviewed.triage.meta.mode === 'local') reviewed.triage = refreshTriageAfterKnowledgeChange(
          reviewed.triage, triage(ticket, { corpus: ruleCorpus, support: local, entries: currentEntries }), reviewed.review);
      }
    }
    const processed = applyContestToSupport(originalText, local, reviewed.triage, reviewed.review, context);
    const triageResult = processed.processing.triage ?? reviewed.triage;
    const processing = { ...processed.processing, triage: triageResult };
    const at = Math.max(Date.now(), parent ? parent.createdAt + 1 : 0);
    const message = { id: body.id, text: processed.text, originalText, processing, status: processed.status, createdAt: at,
      ownerHash: parent?.ownerHash ?? owner.hash, service: createSupportState(body.id, at, processed.processing.knowledge?.status === 'answered' ? processed.processing.knowledge : undefined, processed.status === 'pending' ? parent : undefined) };
    if (parent) {
      const guard = caseSnapshotGuard(parent);
      await db.$client.prepare(`INSERT INTO messages (id, text, original_text, processing, status, created_at, owner_hash, service) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql} ON CONFLICT DO NOTHING`)
        .bind(message.id, message.text, message.originalText, JSON.stringify(message.processing), message.status, message.createdAt, message.ownerHash, JSON.stringify(message.service), ...guard.params).run();
    } else await db.insert(messages).values(message).onConflictDoNothing();
    const [saved] = await db.select().from(messages).where(eq(messages.id, message.id));
    if (!saved && parent) return Response.json({ error: 'Обращение изменилось. Обновите страницу и отправьте уточнение ещё раз.', latestId: await latestCaseId(parent) }, { status: 409 });
    if (!saved || (!admin && saved.ownerHash !== owner.hash)) return fail('Сообщение недоступно.', 404);
    return response(saved);
  } catch (cause) { return cause instanceof ContestInProgressError ? fail(cause.message, 409) : fail('Не удалось отправить. Попробуйте ещё раз.', 503); }
}
export async function PATCH(request: Request) {
  if (!await isAdmin(request, env.SUPPORT_ADMIN_PASSWORD, publicDemoEnabled(env.SUPPORT_DEMO_MODE))) return rejectMutation(request, 'Войдите как администратор.', 401);
  if (!jsonMutation(request)) return rejectMutation(request, 'Ожидается JSON.', 415);
  const parsed = await readRequestJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.data as { id?: unknown; status?: unknown; revision?: unknown } | null;
  if (typeof body?.id !== 'string' || !['accepted', 'trash', 'violation', 'pending'].includes(String(body.status))) return fail('Некорректное действие.');
  try {
    const db = getDb(), [row] = await db.select().from(messages).where(eq(messages.id, body.id));
    if (!row) return fail('Сообщение не найдено.', 404);
    const latestId = await latestCaseId(row);
    if (latestId !== row.id) return Response.json({ error: 'У обращения появилось уточнение. Обновите список.', latestId }, { status: 409 });
    if (body.revision !== undefined && body.revision !== (row.service?.revision ?? 0)) return fail('Обращение изменилось. Обновите список.', 409);
    const at = Date.now(), before = row.service ?? createSupportState(row.id, row.createdAt);
    const statusLabels = { accepted: 'Решено', pending: 'Возвращено в очередь', trash: 'Отправлено в корзину', violation: 'Отмечено нарушение' };
    const service = { ...before, revision: before.revision + 1, state: body.status === 'accepted' ? 'resolved' as const : body.status === 'pending' ? 'queued' as const : before.state, updatedAt: at, history: [...before.history, { at, action: 'status', detail: statusLabels[body.status as keyof typeof statusLabels] }] };
    const [updated] = await db.update(messages).set({ status: body.status as typeof row.status, service }).where(and(eq(messages.id, row.id), caseMutationGuard(row))).returning();
    return updated ? Response.json(publicRow(updated)) : Response.json({ error: 'Обращение изменилось. Обновите список.', latestId: await latestCaseId(row) }, { status: 409 });
  } catch { return fail('Не удалось сохранить решение.', 503); }
}
export async function DELETE(request: Request) {
  if (!await isAdmin(request, env.SUPPORT_ADMIN_PASSWORD, publicDemoEnabled(env.SUPPORT_DEMO_MODE))) return rejectMutation(request, 'Войдите как администратор.', 401);
  if (!jsonMutation(request)) return rejectMutation(request, 'Ожидается JSON.', 415);
  const parsed = await readRequestJson(request, MAX_DELETE_BODY_BYTES);
  if (parsed.response) return parsed.response;
  const ids = parseMessageClearRequest(parsed.data);
  if (!ids) return fail('Подтвердите список сообщений для удаления.');
  try {
    const client = getDb().$client;
    const [feedbackResult, messagesResult] = await client.batch(messageClearStatements(ids).map(statement => client.prepare(statement.sql).bind(statement.snapshot)));
    return Response.json({ deletedCount: messagesResult.meta.changes, deletedFeedbackCount: feedbackResult.meta.changes });
  } catch { return fail('Не удалось очистить сообщения. Попробуйте ещё раз.', 503); }
}
