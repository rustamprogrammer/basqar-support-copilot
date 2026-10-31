import { processSupportMessage } from './support-processing.ts';
import type { KnowledgeEntry } from './knowledge-base.ts';
import type { ClarificationContext } from "./message-types.ts";
import type { Status } from './message-types.ts';
import { KNOWLEDGE_ENTRIES } from './knowledge-base.ts';
import { assessHelpUrgency } from './help-urgency.ts';
import { getKnowledgeDecision, type KnowledgeDecision } from './knowledge-matching.ts';
import { definitionAliasForms } from './knowledge-language.ts';
import { normalizeInputScripts } from './input-script-normalization.ts';
import { normalizeGameText } from './game-language.ts';
import { managedReview, type ManagedReview } from './ai-settings-review.ts';
import type { AiSettingsDatabase } from './ai-settings.ts';
import type { ReviewCandidate, ReviewDecision } from './ai-review-client.ts';
import { AI_REVIEW_POLICY_VERSION } from './ai-review-prompt.ts';

export function processServerMessage(original: string, context?: ClarificationContext, entries?: readonly KnowledgeEntry[]) {
  return processSupportMessage(original, context, entries);
}

const fold = (text: string) => normalizeGameText(normalizeInputScripts(text).text).toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const hasPhrase = (text: string, phrase: string) => ` ${text} `.includes(` ${fold(phrase)} `);
export function reviewKnowledgeCandidates(original: string, entries: readonly KnowledgeEntry[]) {
  const normalized = fold(original), words = new Set(normalized.split(' ').filter(word => word.length >= 4));
  return entries.filter(entry => entry.status === 'published' && entry.source.title && entry.source.version && entry.answer.length <= 4000 && entry.title.length <= 160
    && !(entry.excludedTerms ?? []).some(term => definitionAliasForms(term).some(form => hasPhrase(normalized, form)))
    && (entry.requiredTerms ?? []).every(term => definitionAliasForms(term).some(form => hasPhrase(normalized, form))))
    .map(entry => ({ entry, score: entry.aliases.some(alias => definitionAliasForms(alias).some(form => hasPhrase(normalized, form))) ? 100 : fold(entry.title + ' ' + entry.aliases.join(' ')).split(' ').filter(word => words.has(word)).length }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, 8).map(item => item.entry);
}
const routeLabels = { question: 'Вопрос', help: 'Помощь', violation: 'Нарушение', trash: 'Корзина', undetermined: 'Не определено' };
type Processed = ReturnType<typeof processSupportMessage>;

export function applyReviewDecision(original: string, processed: Processed, decision: ReviewDecision, entries: readonly KnowledgeEntry[], supplied: readonly KnowledgeEntry[], context?: ClarificationContext): Processed {
  if (decision.ok || !decision.correction) return processed;
  const correction = decision.correction;
  const route = correction.category === 'undetermined' ? null : correction.category;
  const needsClarification = correction.needs_clarification;
  const status: Status = route === 'trash' ? 'trash' : route === 'violation' ? 'violation' : 'pending';
  const baselineUrgency = route === 'help' ? processed.processing.urgency ?? assessHelpUrgency(original, original, context) : undefined;
  const rank = { normal: 0, high: 1, now: 2 };
  const urgency = baselineUrgency && correction.urgency && rank[correction.urgency] > rank[baselineUrgency.level]
    ? { ...baselineUrgency, level: correction.urgency, uncertain: false, reason: decision.reason ?? 'ИИ повысил срочность по исходному обращению.', needsLiveObservation: correction.urgency === 'now' || baselineUrgency.needsLiveObservation }
    : baselineUrgency;
  let knowledge: KnowledgeDecision = route === 'question' ? { status: 'needs_admin', reason: 'ИИ не выбрал подходящий утверждённый ответ; нужен администратор.' } : { status: 'not_applicable', reason: 'Готовые ответы применяются к справочным вопросам.' };
  const selected = correction.knowledge_id && supplied.find(entry => entry.id === correction.knowledge_id);
  const current = selected && entries.find(entry => entry.id === selected.id && entry.version === selected.version && entry.status === 'published');
  // Only published text from the exact supplied version can become an answer.
  // The model cannot turn a permission request or personal complaint into a
  // definition. Whole-question applicability must still pass on the original.
  if (route === 'question' && !needsClarification && current && !context) {
    const guarded = getKnowledgeDecision(original, 'question', [current]);
    if (guarded.status === 'answered') knowledge = { status: 'answered', reason: 'ИИ сопоставил вопрос с утверждённой карточкой; условия применения проверены.', entryId: current.id, entryVersion: current.version, answer: current.answer, source: current.source };
  }
  const typedKnowledge = knowledge;
  const steps = processed.processing.steps.filter(step => !['classified', 'routed', 'urgency', 'knowledge', 'answer', 'details'].includes(step.id));
  steps.push({ id: 'ai-text', title: 'Текст после проверки ИИ', value: correction.corrected_text });
  steps.push({ id: 'classified', title: 'Итоговая категория', value: routeLabels[correction.category] });
  if (needsClarification && correction.follow_up) steps.push({ id: 'details', title: 'Что уточнить', value: correction.follow_up });
  if (urgency) steps.push({ id: 'urgency', title: 'Срочность помощи', value: { now: 'Сейчас', high: 'Высокий', normal: 'Обычный' }[urgency.level], detail: urgency.reason });
  if (route === 'question') steps.push({ id: 'knowledge', title: 'Проверка базы ответов', value: typedKnowledge.status === 'answered' ? 'Найден готовый ответ' : 'Нужен администратор', detail: typedKnowledge.reason });
  if (typedKnowledge.status === 'answered') steps.push({ id: 'answer', title: 'Ответ по базе знаний', value: typedKnowledge.answer!, detail: typedKnowledge.source?.title });
  steps.push({ id: 'routed', title: 'Куда отправлено', value: typedKnowledge.status === 'answered' ? 'Игрок получил готовый ответ' : route === 'help' ? 'В очередь помощи администратору' : route === 'question' || !route ? 'На проверку администратору' : routeLabels[route] });
  return { ...processed, text: correction.corrected_text, status, processing: { ...processed.processing, route, classification: route === 'trash' ? 'trash' : route === 'violation' ? 'violation' : !route ? 'clarify' : 'report', decisionSource: 'ai', needsClarification, missingDetails: needsClarification ? ['Уточнение ИИ'] : [], followUp: correction.follow_up ?? undefined, urgency, knowledge: typedKnowledge, answerReadiness: typedKnowledge.status === 'answered' ? 'ready' : route === 'question' ? 'needs_admin' : 'not_applicable', topic: routeLabels[correction.category], steps } };
}
export class ReviewInProgressError extends Error {}
export async function processServerMessageWithReview(original: string, context: ClarificationContext | undefined, entries: readonly KnowledgeEntry[] = KNOWLEDGE_ENTRIES, options: { db: AiSettingsDatabase; secret?: string; requestId: string; fetcher?: typeof fetch; refreshEntries?: () => Promise<readonly KnowledgeEntry[]> }): Promise<Processed> {
  const processed = processSupportMessage(original, context, entries);
  // Explicit direct violations retain their deterministic fast path.
  if (processed.processing.route === 'violation') return { ...processed, processing: { ...processed.processing, aiReview: { outcome: 'disabled', promptVersion: AI_REVIEW_POLICY_VERSION, reason: 'Нарушение определено правилами; повторная проверка ИИ не требуется.' } } };
  const trace = processed.processing;
  const supplied = reviewKnowledgeCandidates(original, entries);
  const candidate: ReviewCandidate = { category: trace.route ?? 'undetermined', corrected_text: processed.text, needs_clarification: !!trace.needsClarification, ...(trace.needsClarification && trace.followUp ? { follow_up: trace.followUp } : {}), urgency: trace.urgency?.level ?? null, knowledge_id: trace.knowledge?.status === 'answered' ? trace.knowledge.entryId ?? null : null };
  const review = await managedReview({ ...options, original, candidate, context: context ? { ...(context.parentRoute ? { parent_category: context.parentRoute } : {}), ...(context.question ? { question: context.question } : {}) } : undefined,
    verifiedAnswers: supplied, uncertain: !trace.route || !!trace.needsClarification || !!trace.urgency?.uncertain || trace.knowledge?.status === 'needs_admin' });
  if ('skipped' in review && review.skipped === 'in_progress') throw new ReviewInProgressError('Сообщение уже проверяется. Повторите отправку через несколько секунд.');
  let currentEntries: readonly KnowledgeEntry[];
  try { currentEntries = options.refreshEntries ? await options.refreshEntries() : entries; }
  catch { currentEntries = []; }
  // A card may be retired while the provider is working. Never deliver an old
  // answer merely because the model confirmed the earlier candidate.
  const priorAnswer = processed.processing.knowledge;
  const stillPublished = priorAnswer?.status !== 'answered' || currentEntries.some(entry => entry.id === priorAnswer.entryId && entry.version === priorAnswer.entryVersion && entry.status === 'published');
  const safeProcessed: Processed = stillPublished ? processed : { ...processed, processing: { ...processed.processing, knowledge: { status: 'needs_admin', reason: 'Карточка ответа изменилась во время обработки. Нужен администратор.' }, answerReadiness: 'needs_admin', steps: processed.processing.steps.filter(step => step.id !== 'answer').map(step => step.id === 'knowledge' || step.id === 'routed' ? { ...step, value: 'Ответ передан администратору', detail: 'Карточка базы изменилась во время обработки.' } : step) } };
  return annotateReview(original, safeProcessed, review, currentEntries, supplied, context);
}
export function annotateReview(original: string, processed: Processed, review: ManagedReview, entries: readonly KnowledgeEntry[], supplied: readonly KnowledgeEntry[], context?: ClarificationContext): Processed {
  if ('skipped' in review) {
    const reason = review.skipped === 'limited' ? 'Лимит 100 запросов исчерпан или настройки изменились. Сохранено решение алгоритма.' : review.skipped === 'disabled' ? review.code === 'confident_rules' ? 'Уверенное решение алгоритма; режим ИИ — только сложные случаи.' : 'ИИ выключен или ключ не настроен.' : 'ИИ недоступен. Сохранено решение алгоритма.';
    return { ...processed, processing: { ...processed.processing, aiReview: { outcome: review.skipped === 'in_progress' ? 'unavailable' : review.skipped, promptVersion: AI_REVIEW_POLICY_VERSION, reason, errorCode: review.code }, steps: [...processed.processing.steps, { id: 'ai-review', title: 'Проверка ИИ', value: reason }] } };
  }
  const result = review.result;
  if (!result.ok) return { ...processed, processing: { ...processed.processing, aiReview: { outcome: 'unavailable', promptVersion: AI_REVIEW_POLICY_VERSION, errorCode: result.code, elapsedMs: result.elapsedMs, cached: review.cached, reason: 'Проверка ИИ не завершилась; сохранено решение алгоритма.' }, steps: [...processed.processing.steps, { id: 'ai-review', title: 'Проверка ИИ', value: 'ИИ недоступен. Сохранено решение алгоритма.' }] } };
  const updated = applyReviewDecision(original, processed, result.decision, entries, supplied, context);
  const reason = result.decision.ok ? 'ИИ подтвердил решение алгоритма.' : result.decision.reason ?? 'ИИ уточнил решение по исходному сообщению.';
  return { ...updated, processing: { ...updated.processing, algorithm: { text: processed.text, route: processed.processing.route ?? null, needsClarification: !!processed.processing.needsClarification, followUp: processed.processing.followUp, version: processed.processing.version, ruleId: processed.processing.ruleId }, aiReview: { outcome: result.decision.ok ? 'confirmed' : 'replaced', promptVersion: AI_REVIEW_POLICY_VERSION, model: result.model, usage: result.usage, elapsedMs: result.elapsedMs, cached: review.cached, reason }, steps: [...updated.processing.steps, { id: 'ai-review', title: 'Проверка ИИ', value: reason }] } };
}
