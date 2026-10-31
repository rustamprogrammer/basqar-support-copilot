import { processSupportMessage } from '../support-processing.ts';
import { understandMessage } from '../message-understanding.ts';
import { assessHelpUrgency } from '../help-urgency.ts';
import { detectLanguage, normalizeKazakh } from './language.ts';
import { makeDraft } from './drafts.ts';
import { retrieveRules } from './retrieval.ts';
import { parseTicket, type Category, type Corpus, type Priority, type Ticket, type TriageResult } from './types.ts';
import { KNOWLEDGE_ENTRIES, type KnowledgeEntry } from '../knowledge-base.ts';

export const TRIAGE_VERSION = 'triage-1';
export const EMPTY_CORPUS: Corpus = { version: 'missing', source: 'not configured', chunks: [] };
type SupportResult = ReturnType<typeof processSupportMessage>;
export type RecentTicket = { id: string; reporter: string; time: number; signature: string };
export function ticketText(ticket: Ticket) { return ticket.messages.filter(m => m.role === 'player').map(m => m.text).join('\n'); }
export function problemSignature(text: string) {
  // Keep numbers, negations and temporal words. No topic-only deduplication.
  return text.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/[‘’ʻʼ`]/gu, "'").replace(/[!?.,;:]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function categoryFor(ticket: Ticket, text: string, support: SupportResult): { category: Category; topic: string; appeal: boolean; uncertain: boolean } {
  const t = text.toLowerCase();
  const appeal = /обжал|пересмотр|разбан|снимите.{0,25}(?:бан|мут|наказ)|апелляц|ban.{0,25}(?:olib|ochib)|бан.{0,20}(?:алып|аш)|appeal|unban/iu.test(t);
  const payment = /оплат|плат[её]ж|донат|гк.{0,30}не.{0,15}приш|to'lov|tolov|pul.{0,20}tushma|төлем|толем|донат|payment|paid|pago|pagamento/iu.test(t);
  const access = /взлом|украли.{0,15}акк|аккаунт.{0,25}(?:укра|увели)|(?:не могу|не получается).{0,15}(?:войти|зайти)|доступ.{0,15}(?:нет|потер)|пропал[аио]?.{0,15}(?:машин|имущество|деньг)|akkaunt.{0,25}(?:buz|kir|o'g'ir)|аккаунт.{0,25}(?:бұз|буз|кір|кир)|кіре алмай|kira olmay|hacked|lost access|cuenta.{0,15}rob|conta.{0,15}invad/iu.test(t);
  // General instructions stay questions; personal losses take precedence over an insult.
  const info = support.processing.route === 'question';
  const personal = /меня|мне|мой|мо[яию]|у меня|не приш|не зачис|пропал|взлом|маған|мені|менің|алмай|meni|menga|mening|olmay|my |hacked|оплатил|төлед|to'lad/iu.test(t);
  if (ticket.kind === 'report') {
    if (payment && (!info || personal)) return { category: 'report.payment', topic: 'payment', appeal, uncertain: false };
    if (access && (!info || personal)) return { category: 'report.account', topic: 'account', appeal, uncertain: false };
  }
  const topic = /чит|аим|aimbot|cheat|стен.{0,10}стрел|сторонн.{0,20}по|devordan/iu.test(t) ? 'cheat'
    : /мошен|обман|скам|украл|вымога|aldadi|алда|scam/iu.test(t) ? 'scam'
      : /реклам|за реал|rmt|прода.{0,15}аккаунт|advertis/iu.test(t) ? 'rmt_ads'
        : /оскорб|оск(?:\s|$)|родн|расизм|haqorat|so'k|қорла|корла|insult/iu.test(t) ? 'insult'
          : /(?:^|[^\p{L}])(?:дм\p{L}*|дб\p{L}*|dm|db|тк|ск|нрп|nonrp)(?:$|[^\p{L}])|убил|убива|бьют|стреля|өлтір|урып|o'ldir|otib/iu.test(t) ? 'dm' : 'other';
  if (ticket.kind === 'complaint') {
    if (appeal || /админ.{0,40}(?:выдал|наказ|забан|оскорб)|жалоб.{0,10}на админ/iu.test(t)) return { category: 'complaint.admin', topic: 'admin', appeal: true, uncertain: false };
    if (info || support.processing.route === 'trash' || !support.processing.route) return { category: 'complaint.invalid', topic, appeal, uncertain: true };
    return { category: `complaint.${topic}` as Category, topic, appeal, uncertain: topic === 'other' };
  }
  if (info && !appeal) return { category: 'report.question', topic, appeal, uncertain: false };
  if (support.processing.route === 'trash') return { category: 'report.offtopic', topic, appeal, uncertain: false };
  if (topic !== 'other' && !appeal) return { category: 'report.complaint', topic, appeal, uncertain: false };
  return { category: 'report.help', topic, appeal, uncertain: support.processing.route !== 'help' };
}

export function triage(value: unknown, options: { corpus?: Corpus; support?: SupportResult; entries?: readonly KnowledgeEntry[]; recent?: readonly RecentTicket[]; now?: number } = {}): TriageResult {
  const started = performance.now(), ticket = parseTicket(value), corpus = options.corpus ?? EMPTY_CORPUS;
  const original = ticketText(ticket), normalized = normalizeKazakh(original, ticket.server_lang ?? ticket.lang);
  const lang = detectLanguage(normalized, ticket.lang !== 'und' ? ticket.lang ?? ticket.server_lang : ticket.server_lang);
  const support = options.support ?? processSupportMessage(normalized, undefined, options.entries);
  const understood = understandMessage(normalized).text;
  const text = normalized + '\n' + understood + (options.support?.processing.decisionSource === 'ai' ? '\n' + support.text : '');
  const decision = categoryFor(ticket, text, support), category = decision.category;
  const hasEvidence = (ticket.images_count ?? 0) > 0 || ticket.messages.some(m => m.role === 'player' && (m.attachments ?? 0) > 0);
  const realThreat = /(?:угрож|убью|найду).{0,50}(?:реал|адрес|дома)|(?:реал|адрес).{0,50}угрож|mass.{0,15}bug|массов.{0,20}(?:баг|сбой)/iu.test(text);
  let priority: Priority = category === 'report.account' || category === 'report.payment' || realThreat ? 'p0'
    : ['cheat', 'rmt_ads'].includes(decision.topic) && !['report.question', 'complaint.invalid', 'report.offtopic'].includes(category) ? 'p1'
      : category.startsWith('complaint.') && category !== 'complaint.invalid' && hasEvidence ? 'p1'
        : category === 'report.question' || category === 'report.offtopic' || category === 'complaint.invalid' || (ticket.kind === 'complaint' && !hasEvidence) ? 'p3' : 'p2';
  if (category === 'complaint.scam' && /крупн|миллион|\d+\s*(?:кк|млн)|бизнес|дом/iu.test(text)) priority = 'p1';
  const queryCategory: Category = category === 'report.complaint' ? `complaint.${decision.topic}` as Category : category;
  const rules = retrieveRules(text, queryCategory, corpus);
  let draft = makeDraft(category, lang, rules, hasEvidence, decision.appeal);
  let needsHuman = true;
  // Only reviewed Russian FAQ text can be sent automatically. Other-language
  // drafts remain reviewable templates until a native speaker approves them.
  const knowledge = support.processing.knowledge;
  const entry = knowledge?.status === 'answered' ? (options.entries ?? KNOWLEDGE_ENTRIES).find(e => e.id === knowledge.entryId && e.version === knowledge.entryVersion && e.status === 'published') : undefined;
  if (category === 'report.question' && lang === 'ru' && entry && !decision.appeal) {
    draft = { lang: 'ru', text: entry.answer, cited: [] };
    needsHuman = false;
  }
  const reasons = [decision.uncertain ? 'Категория предварительная: недостаточно контекста.' : 'Категория определена по цели обращения и входному каналу.', 'Приоритет по taxonomy.json; игровая срочность хранится отдельно.'];
  if (!corpus.chunks.length) reasons.push('Корпус правил не загружен; ответы по правилам требуют проверки.');
  else if (!rules.length && category !== 'report.question' && category !== 'report.payment' && category !== 'report.offtopic') reasons.push('Релевантные пункты правил не найдены; не добавлять ссылки из памяти.');
  if (rules.length) reasons.push('Пункты найдены в локальном корпусе; релевантность должен подтвердить администратор.');
  if (lang === 'kk' || lang === 'uz') reasons.push('Многоязычный шаблон требует проверки носителем перед автоматической отправкой.');
  if (category === 'report.account' || category === 'report.payment' || decision.appeal) reasons.push('Доступ, платежи и обжалования обязательно проверяет человек.');
  const time = ticket.created_at ? Date.parse(ticket.created_at) : options.now ?? Date.now();
  const signature = problemSignature(normalized);
  const duplicate = ticket.reporter_hash ? options.recent?.find(row => row.reporter === ticket.reporter_hash && row.signature === signature && row.id !== ticket.ticket_id && row.time <= time && time - row.time <= 3600000) : undefined;
  if (duplicate) reasons.push('Повтор той же формулировки от того же заявителя в пределах часа; исходное обращение сохраняется.');
  const refs = [...new Set(((ticket.rule_refs_raw ?? '') + ' ' + original).match(/(?:ЖБ\s*)?\d{1,2}\.\d{1,2}(?:\.\d{1,2})?|\bGZ\b/giu) ?? [])].slice(0, 20);
  const nickname = ticket.reported_nick ?? original.match(/(?<![\p{L}\p{N}_])[\p{L}]{2,}_[\p{L}\p{N}_]{2,}(?![\p{L}\p{N}_])/u)?.[0] ?? null;
  const urgency = category === 'report.offtopic' || category === 'report.question' ? null : assessHelpUrgency(normalized, understood).level;
  return {
    lang, category, priority, is_spam_or_duplicate: !!duplicate,
    extracted: { nickname, rule_refs: refs, has_evidence: hasEvidence, server: ticket.server ?? original.match(/(?:сервер|server|сервері)\s*[:#№]?\s*([\p{L}\p{N}-]{1,40})/iu)?.[1] ?? null },
    draft_reply: draft, needs_human: needsHuman, confidence: decision.uncertain || lang === 'und' ? 0.35 : 0.7, reasons,
    meta: { version: TRIAGE_VERSION, corpus_version: corpus.version, mode: support.processing.aiReview?.outcome === 'confirmed' || support.processing.aiReview?.outcome === 'replaced' ? 'rules+ai' : 'local', confidence_kind: 'heuristic', input_normalized: normalized !== original,
      evidence_claimed: /скрин|фрапс|доказатель|dalil|дәлел|screenshot|video/iu.test(original), moderation_flag: support.processing.route === 'violation', live_urgency: urgency,
      elapsed_ms: Math.round((performance.now() - started) * 100) / 100,
      api_cost_usd: support.processing.aiReview?.cached ? 0 : support.processing.aiReview?.usage || support.processing.aiReview?.outcome === 'unavailable' ? null : 0,
      ...(support.processing.aiReview?.usage ? { provider_usage: support.processing.aiReview.usage } : {}), citations: rules, ...(duplicate ? { duplicate_of: duplicate.id } : {}) },
  };
}
