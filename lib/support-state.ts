import type { Message } from './message-types.ts';
export type QueueState = 'queued' | 'in_progress' | 'answered' | 'resolved';
export type ServiceEvent = { at: number; action: string; detail?: string };
export type SupportState = {
  revision: number; state: QueueState; caseId: string; firstReceivedAt: number; updatedAt: number;
  claimedAt?: number; manualUrgency?: 'now' | 'high' | 'normal'; manualReason?: string;
  escalatedAt?: number; escalationReason?: string;
  reply?: { text: string; author: 'knowledge' | 'admin'; at: number; entryId?: string; entryVersion?: string };
  history: ServiceEvent[];
};
export function createSupportState(id: string, at: number, answer?: { answer?: string; entryId?: string; entryVersion?: string }, parent?: Message): SupportState {
  const reply = answer?.answer ? { text: answer.answer, author: 'knowledge' as const, at, entryId: answer.entryId, entryVersion: answer.entryVersion } : undefined;
  return { revision: 0, state: reply ? 'answered' : 'queued', caseId: parent?.service?.caseId ?? parent?.id ?? id,
    firstReceivedAt: parent?.service?.firstReceivedAt ?? parent?.createdAt ?? at, updatedAt: at,
    ...(parent?.service?.manualUrgency ? { manualUrgency: parent.service.manualUrgency, manualReason: parent.service.manualReason } : {}),
    ...(parent?.service?.escalatedAt ? { escalatedAt: parent.service.escalatedAt, escalationReason: parent.service.escalationReason } : {}),
    ...(reply ? { reply } : {}), history: [...(parent?.service?.history ?? []), { at, action: reply ? 'knowledge_answer' : 'queued',
      ...(reply ? { detail: `${reply.text}\nКарточка ${reply.entryId}, версия ${reply.entryVersion}` } : parent ? { detail: `Уточнение обращения ${parent.id}` } : {}) }] };
}
export function effectiveState(row: Message): QueueState { return row.service?.state ?? (row.status === 'accepted' ? 'resolved' : 'queued'); }
export function effectiveUrgency(row: Message) { return row.service?.manualUrgency ?? row.processing?.urgency?.level ?? 'normal'; }
export function queueFlags(row: Message, now = Date.now()) {
  const elapsed = Math.max(0, now - (row.service?.firstReceivedAt ?? row.createdAt));
  // A location/ID clarification is not proof that an earlier incident is still happening.
  return { stale: row.processing?.urgency?.eventTime === 'ongoing' && elapsed > 5 * 60_000,
    overdue: ['queued', 'in_progress'].includes(effectiveState(row)) && elapsed > 15 * 60_000, minutes: Math.floor(elapsed / 60_000) };
}
// Clarifications form one queue item; the original records remain in the history.
export function latestCases(rows: readonly Message[]) {
  const byCase = new Map<string, Message>();
  for (const row of rows) { const key = row.status === 'trash' || row.status === 'violation' ? row.id : row.service?.caseId ?? row.id; const old = byCase.get(key);
    if (!old || row.createdAt > old.createdAt || (row.createdAt === old.createdAt && row.id > old.id)) byCase.set(key, row); }
  return [...byCase.values()];
}
export function sortHelpQueue(rows: readonly Message[], now = Date.now()) {
  const rank = { now: 0, high: 1, normal: 2 };
  return [...rows].sort((a, b) => {
    const ar = rank[effectiveUrgency(a)], br = rank[effectiveUrgency(b)];
    const aq = ar === 2 && queueFlags(a, now).overdue ? 1 : ar, bq = br === 2 && queueFlags(b, now).overdue ? 1 : br;
    return aq - bq || (a.service?.firstReceivedAt ?? a.createdAt) - (b.service?.firstReceivedAt ?? b.createdAt) || a.id.localeCompare(b.id);
  });
}
export type ServiceAction = 'claim' | 'release' | 'reply' | 'priority' | 'helped' | 'need_admin' | 'escalate';
export function updateSupportState(row: Message, action: ServiceAction, value: { text?: string; level?: 'now' | 'high' | 'normal'; reason?: string }, at: number, admin: boolean): SupportState {
  if (!admin && action !== 'helped' && action !== 'need_admin') throw new Error('Требуется вход администратора.');
  if (!admin && !row.service?.reply) throw new Error('У обращения пока нет ответа.');
  const previous = row.service ?? createSupportState(row.id, row.createdAt);
  const next: SupportState = { ...previous, revision: previous.revision + 1, updatedAt: at, history: [...previous.history] };
  let detail: string | undefined;
  if (action === 'claim') { next.state = 'in_progress'; next.claimedAt = at; }
  if (action === 'release') { next.state = 'queued'; delete next.claimedAt; }
  if (action === 'helped') next.state = 'resolved';
  if (action === 'need_admin') { next.state = 'queued'; delete next.claimedAt; detail = 'Ответ не помог. Требуется администратор.'; }
  if (action === 'escalate') {
    if (!value.reason?.trim() || value.reason.length > 300) throw new Error('Укажите причину передачи (до 300 символов).');
    next.state = 'queued'; delete next.claimedAt; next.escalatedAt = at; next.escalationReason = value.reason.trim(); detail = `Передано старшему администратору: ${value.reason.trim()}`;
  }
  if (action === 'reply') {
    const text = value.text?.trim();
    if (!text || text.length > 4000) throw new Error('Ответ должен содержать от 1 до 4000 символов.');
    next.reply = { text, author: 'admin', at }; next.state = 'answered'; detail = text;
  }
  if (action === 'priority') {
    if (row.processing?.route !== 'help') throw new Error('Приоритет задаётся для помощи.');
    if (!value.level || !['now', 'high', 'normal'].includes(value.level) || !value.reason?.trim() || value.reason.length > 300) throw new Error('Укажите приоритет и причину (до 300 символов).');
    next.manualUrgency = value.level; next.manualReason = value.reason.trim(); detail = `${value.level}: ${next.manualReason}`;
  }
  next.history.push({ at, action, ...(detail ? { detail } : {}) }); return next;
}
