import { processMessageWithTrace } from './message-processing.ts';
import { assessHelpUrgency } from './help-urgency.ts';
import { getKnowledgeDecision, mayAskForDefinition } from './knowledge-matching.ts';
import type { KnowledgeEntry } from './knowledge-base.ts';
import type { ClarificationContext, ProcessingTrace } from './message-types.ts';
import { understandMessage } from './message-understanding.ts';
export const SUPPORT_VERSION = 'rules-assistance-2-glossary';
// No reviewer or network access: deterministic assistance remains independent of AI.
export function processSupportMessage(original: string, context?: ClarificationContext, entries?: readonly KnowledgeEntry[]) {
  const processed = processMessageWithTrace(original, context);
  let trace = processed.processing;
  // A complete approved glossary intent can disambiguate a verb that the
  // incident classifier read as an action ("ДМить — это что?"). Terminal
  // moderation and an existing case context always retain their precedence.
  const canDisambiguate = !context && trace.route !== 'violation' && trace.route !== 'trash' && mayAskForDefinition(original + ' ' + processed.text);
  const candidate = getKnowledgeDecision(original, trace.route === 'question' || canDisambiguate ? 'question' : trace.route ?? null, entries);
  if (!context && candidate.status === 'answered' && (trace.route !== 'question' || trace.needsClarification)) {
    trace = { ...trace, route: 'question', classification: 'report', topic: 'Вопрос по игре', ruleId: 'route.complete-glossary-question', needsClarification: false, missingDetails: [], followUp: undefined,
      steps: trace.steps.map(step => step.id === 'rules' ? { ...step, value: 'Вопрос', detail: 'Весь текст распознан как вопрос о значении одного игрового термина; описания личного происшествия нет.' }
        : step.id === 'classified' ? { ...step, value: 'Вопрос' }
          : step.id === 'details' ? { ...step, title: 'Подробности', value: 'Уточнение не требуется' } : step) };
  }
  const urgency = trace.route === 'help' ? assessHelpUrgency(original, understandMessage(processed.text).text, context) : undefined;
  const knowledge = trace.route === 'question' && trace.needsClarification
    ? { status: 'needs_admin' as const, reason: 'Сначала нужно уточнить вопрос; готовый ответ не отправлен.' }
    : trace.route === 'question' ? candidate : getKnowledgeDecision(original, trace.route ?? null, entries);
  const steps = trace.steps.filter(step => step.id !== 'routed');
  if (urgency?.followUp && !trace.followUp) {
    const details = { id: 'details' as const, title: 'Что уточнить', value: urgency.followUp };
    const index = steps.findIndex(step => step.id === 'details');
    if (index >= 0) steps[index] = details; else steps.push(details);
  }
  if (urgency) steps.push({ id: 'urgency', title: 'Срочность помощи', value: { now: 'Сейчас', high: 'Высокий', normal: 'Обычный' }[urgency.level], detail: urgency.reason + (urgency.uncertain ? ' Срочность нужно уточнить.' : '') });
  if (trace.route === 'question') steps.push({ id: 'knowledge', title: 'Проверка базы ответов', value: knowledge.status === 'answered' ? 'Найден готовый ответ' : 'Нужен администратор', detail: knowledge.reason });
  if (knowledge.status === 'answered') steps.push({ id: 'answer', title: 'Ответ по базе знаний', value: knowledge.answer!, detail: `${knowledge.source?.title ?? ''}${knowledge.source?.ref ? `, ${knowledge.source.ref}` : ''}; версия ${knowledge.entryVersion}` });
  steps.push({ id: 'routed', title: 'Куда отправлено', value: knowledge.status === 'answered' ? 'Игрок получил готовый ответ; можно обратиться к администратору' : trace.route === 'help' ? 'В очередь помощи администратору' : trace.route === 'question' ? 'Вопрос передан администратору' : trace.steps.find(step => step.id === 'routed')?.value ?? 'На проверку' });
  const processing: ProcessingTrace = { ...trace, version: SUPPORT_VERSION, steps, ...(urgency ? { urgency } : {}), ...(urgency?.followUp && !trace.followUp ? { followUp: urgency.followUp, needsClarification: true } : {}), knowledge,
    answerReadiness: knowledge.status === 'answered' ? 'ready' : trace.route === 'question' ? 'needs_admin' : 'not_applicable', aiReview: { outcome: 'disabled', promptVersion: SUPPORT_VERSION } };
  return { ...processed, processing };
}
