import type { Ticket, TriageResult } from './types.ts';
import type { AiMode } from '../ai-settings.ts';

export const CONTEST_REVIEW_POLICY_VERSION = 'contest-review-1';
export type ContestReviewChoice = { review: boolean; code: string; reason: string };

/** A production gate based only on the input and observable local output.
 * Human-review requirements and heuristic confidence are not accuracy estimates.
 * The conservative default is review: only narrow, whole-input cases skip AI.
 */
export function chooseContestReview(ticket: Ticket, baseline: TriageResult, mode: AiMode): ContestReviewChoice {
  if (mode === 'all') return { review: true, code: 'all_messages', reason: 'Выбран режим проверки всех обращений, включая готовые FAQ.' };
  const player = ticket.messages.filter(message => message.role === 'player');
  const text = player.map(message => message.text).join('\n').normalize('NFKC').trim();
  const evidence = (ticket.images_count ?? 0) > 0 || player.some(message => (message.attachments ?? 0) > 0);
  const single = player.length === 1 && !evidence;
  const complex = /[\n;:«»“”"'`]|\b(?:not|never|but|however|no|pero|mas|lekin)\b|(?<!\p{L})(?:не|нет|ни|но|или|если|потом|также|ещ[её]|почему|жоқ|емес)(?!\p{L})/iu.test(text)
    || /(?<!\p{L})и(?!\p{L})/iu.test(text) || (text.match(/\?/gu) ?? []).length > 1;
  const trustedFaq = ticket.kind === 'report' && single && text.length <= 120 && !complex
    && baseline.category === 'report.question' && baseline.lang === 'ru'
    && baseline.needs_human === false && baseline.draft_reply.lang === 'ru'
    && baseline.draft_reply.text.trim().length > 0 && !baseline.meta.moderation_flag;
  if (trustedFaq) return { review: false, code: 'trusted_local_faq', reason: 'Короткий вопрос целиком распознан как один проверенный FAQ без дополнительных условий.' };
  // Anchored greetings only: a greeting followed by a problem is substantive.
  const greeting = /^(?:привет|здравствуйте|здравствуй|добрый день|ау|hello|hi|hey|hola|ol[aá]|salom|assalomu alaykum|сәлем|сәлеметсіз бе)[\s!.?,…]*$/iu.test(text);
  if (single && greeting && baseline.category === (ticket.kind === 'complaint' ? 'complaint.invalid' : 'report.offtopic')) {
    return { review: false, code: 'trivial_greeting', reason: 'Весь текст — отдельное приветствие без описания проблемы или вложений.' };
  }
  if (baseline.priority === 'p0' || ['report.account', 'report.payment', 'complaint.admin'].includes(baseline.category)) return { review: true, code: 'sensitive_case', reason: 'Доступ, платежи, обжалования и критические события требуют дополнительной проверки смысла.' };
  if (baseline.meta.moderation_flag || ['report.offtopic', 'complaint.invalid'].includes(baseline.category)) return { review: true, code: 'terminal_route_review', reason: 'Содержательный текст нельзя окончательно отклонять только по локальной модерации или нераспознанной категории.' };
  if (baseline.lang !== 'ru') return { review: true, code: 'language_review', reason: 'Иноязычное или неустановленное обращение требует проверки смысла.' };
  if (complex) return { review: true, code: 'complex_context', reason: 'Условия, отрицания, цитаты или несколько частей обращения требуют проверки контекста.' };
  return { review: true, code: 'substantive_review', reason: 'Для этого содержательного обращения нет проверенного полного локального ответа.' };
}
