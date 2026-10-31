import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { jsonMutation, rejectMutation } from '@/lib/access';
import { isLocalSettingsOperator, publicAiSettings, readAiSettings, validSettingsSecret } from '@/lib/ai-settings';
import { managedReview } from '@/lib/ai-settings-review';
import { processSupportMessage } from '@/lib/support-processing';
import { loadKnowledge } from '@/lib/knowledge-store';
import { reviewKnowledgeCandidates } from '@/lib/server-review';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!isLocalSettingsOperator(request, true)) return rejectMutation(request, 'Проверять ключ можно только на ноутбуке через 127.0.0.1.', 403);
  if (!jsonMutation(request)) return rejectMutation(request, 'Ожидается JSON.', 415);
  const body = await request.json().catch(() => null) as { id?: unknown; text?: unknown } | null;
  if (typeof body?.id !== 'string' || !/^[\da-f-]{36}$/iu.test(body.id) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) return Response.json({ error: 'Введите сообщение до 2000 символов.' }, { status: 400 });
  try {
    const db = getDb().$client, entries = await loadKnowledge(), processed = processSupportMessage(body.text, undefined, entries), trace = processed.processing;
    const review = await managedReview({ db, secret: env.SUPPORT_SETTINGS_SECRET, requestId: `test:${body.id}`, manual: true, original: body.text,
      candidate: { category: trace.route ?? 'undetermined', corrected_text: processed.text, needs_clarification: !!trace.needsClarification, ...(trace.needsClarification ? { follow_up: trace.followUp ?? 'Опишите ситуацию подробнее.' } : {}), urgency: trace.urgency?.level ?? null, knowledge_id: trace.knowledge?.entryId ?? null }, verifiedAnswers: reviewKnowledgeCandidates(body.text, entries) });
    return Response.json({ review, settings: publicAiSettings(await readAiSettings(db), validSettingsSecret(env.SUPPORT_SETTINGS_SECRET)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Проверка не завершилась. Автоматического повтора не будет.' }, { status: 503 }); }
}
