import { processSupportMessage } from '../support-processing.ts';
import { assessHelpUrgency, type HelpUrgency } from '../help-urgency.ts';
import type { ProcessingTrace, ClarificationContext, MessageRoute } from '../message-types.ts';
import type { TriageResult } from './types.ts';
import { chooseContestReview } from './review-policy.ts';

type Processed = ReturnType<typeof processSupportMessage>;
export function applyContestToSupport(original: string, processed: Processed, result: TriageResult, review: NonNullable<ProcessingTrace['aiReview']>, context?: ClarificationContext): Processed {
  const before = processed.processing;
  const explicitModeration = before.route === 'violation' || before.route === 'trash';
  const algorithm = { text: processed.text, route: before.route ?? null, needsClarification: !!before.needsClarification, followUp: before.followUp, version: before.version, ruleId: before.ruleId };
  // Moderation is retained as evidence, not a veto on recovering a real case.
  const recorded = { ...result, meta: { ...result.meta, moderation_flag: result.meta.moderation_flag || before.route === 'violation' } };
  if (result.meta.mode !== 'rules+ai' || !['confirmed', 'replaced'].includes(review.outcome)) {
    if (before.knowledge?.status === 'answered' && result.needs_human) {
      // An approved card is not permission to auto-send when this particular
      // result requires a human, including a failed all-mode model review.
      const reason = 'Это обращение требует проверки человека; автоматический ответ FAQ не отправлен.';
      return { ...processed, status: 'pending', processing: { ...before, algorithm, triage: recorded, aiReview: review,
        knowledge: { status: 'needs_admin', reason }, answerReadiness: 'needs_admin',
        steps: [...before.steps.filter(step => step.id !== 'answer').map(step => step.id === 'knowledge' || step.id === 'routed'
          ? { ...step, value: 'На проверку администратору', detail: reason } : step),
          { id: 'ai-review', title: 'Проверка ИИ', value: review.reason ?? reason }],
      } };
    }
    const requiresReview = chooseContestReview({ kind: 'report', messages: [{ role: 'player', text: original }] }, result, 'uncertain').review;
    if (explicitModeration && requiresReview && ['unavailable', 'limited'].includes(review.outcome)) {
      // A failed paid check must not silently discard substantive text. This is
      // a manual queue decision; preserve local category, mode and failure data.
      const reason = 'ИИ не завершил проверку содержательного сообщения; локальная модерация сохранена, обращение передано человеку.';
      return { ...processed, status: 'pending', processing: { ...before, route: null, classification: 'clarify', decisionSource: 'rules',
        algorithm, triage: { ...recorded, needs_human: true, reasons: [...recorded.reasons, reason] }, aiReview: review,
        topic: 'Ручная проверка', needsClarification: false, missingDetails: [], followUp: undefined,
        knowledge: { status: 'not_applicable', reason }, urgency: undefined, answerReadiness: 'not_applicable',
        steps: [...before.steps.filter(step => !['classified', 'routed', 'knowledge', 'answer', 'details', 'urgency'].includes(step.id)),
          { id: 'classified', title: 'Итоговая категория', value: 'Нужна ручная проверка' },
          { id: 'ai-review', title: 'Проверка ИИ', value: reason },
          { id: 'routed', title: 'Куда отправлено', value: 'В очередь проверки администратором' }],
      } };
    }
    return { ...processed, processing: { ...before, triage: recorded, aiReview: review,
      steps: [...before.steps, { id: 'ai-review', title: 'Черновик ИИ', value: review.reason ?? 'Сохранено решение алгоритма.' }] } };
  }
  const route: MessageRoute | null = result.category === 'report.question' ? 'question' : result.category === 'report.offtopic' ? 'trash'
    : result.category === 'complaint.invalid' ? null : 'help';
  const knowledge = route === 'question' ? { status: 'needs_admin' as const, reason: 'Черновик ИИ должен проверить и отправить администратор.' }
    : { status: 'not_applicable' as const, reason: 'Готовые FAQ не применяются к этому обращению.' };
  const labels = { question: 'Вопрос', help: 'Помощь', trash: 'Корзина', violation: 'Нарушение' };
  const localUrgency = route === 'help' ? before.urgency ?? assessHelpUrgency(original, processed.text, context) : undefined;
  const queueFloor = result.priority === 'p0' ? 'now' : result.priority === 'p1' ? 'high' : undefined;
  const urgencyRank = { normal: 0, high: 1, now: 2 };
  const urgency: HelpUrgency | undefined = localUrgency && queueFloor && urgencyRank[queueFloor] > urgencyRank[localUrgency.level]
    ? { ...localUrgency, level: queueFloor, uncertain: false, followUp: undefined,
      reason: `Очередь помощи повышена по принятому конкурсному приоритету ${result.priority.toUpperCase()}. ${localUrgency.reason}` }
    : localUrgency;
  // Raising queue urgency does not establish that an event is still ongoing or
  // needs live observation: retain the independently assessed temporal fields.
  // Generated drafts are never assigned to knowledge.answer or service.reply.
  // They only appear in the existing administrator draft editor.
  // A successful contest decision does not validate the old route's missing
  // fields or question. Keep those in the algorithm snapshot, never ask them
  // automatically alongside a new model category or an administrator-only draft.
  return { ...processed, status: route === 'trash' ? 'trash' : 'pending', processing: { ...before,
    route, classification: route === 'trash' ? 'trash' : route ? 'report' : 'clarify', decisionSource: 'ai',
    needsClarification: false, missingDetails: [], followUp: undefined,
    topic: route ? labels[route] : 'Не определено', knowledge, urgency, answerReadiness: route === 'question' ? 'needs_admin' : 'not_applicable',
    triage: recorded, aiReview: review, algorithm,
    steps: [...before.steps.filter(step => !['classified', 'routed', 'knowledge', 'answer', 'urgency', 'details'].includes(step.id)),
      { id: 'classified', title: 'Итоговая категория', value: route ? labels[route] : 'Не определено' },
      { id: 'ai-review', title: 'Черновик ИИ', value: review.reason ?? 'Черновик требует проверки администратора.' },
      ...(urgency ? [{ id: 'urgency' as const, title: 'Срочность помощи', value: { now: 'Сейчас', high: 'Высокий', normal: 'Обычный' }[urgency.level], detail: urgency.reason }] : []),
      { id: 'routed', title: 'Куда отправлено', value: route === 'trash' ? 'Корзина' : 'На проверку администратору' }],
  } };
}
