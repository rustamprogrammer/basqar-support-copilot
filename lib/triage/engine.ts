import { processSupportMessage } from '../support-processing.ts';
import { understandMessage } from '../message-understanding.ts';
import { assessHelpUrgency } from '../help-urgency.ts';
import { detectLanguage, normalizeKazakh } from './language.ts';
import { makeDraft } from './drafts.ts';
import { retrieveRules, glossaryTerms } from './retrieval.ts';
import { parseTicket, type Category, type Corpus, type Priority, type Ticket, type TriageResult } from './types.ts';
import { KNOWLEDGE_ENTRIES, type KnowledgeEntry } from '../knowledge-base.ts';

export const TRIAGE_VERSION = 'triage-2';
export const EMPTY_CORPUS: Corpus = { version: 'missing', source: 'not configured', chunks: [] };
type SupportResult = ReturnType<typeof processSupportMessage>;
export type RecentTicket = { id: string; reporter: string; time: number; signature: string };
export function ticketText(ticket: Ticket) { return ticket.messages.filter(m => m.role === 'player').map(m => m.text).join('\n'); }
export function problemSignature(text: string) {
  // Keep numbers, negations and temporal words. No topic-only deduplication.
  return text.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/[‘’ʻʼ`]/gu, "'").replace(/[!?.,;:]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/** Use this for both insertion and lookup, including batch jobs. */
export function ticketSignature(ticket: Ticket) {
  return problemSignature(normalizeKazakh(ticketText(ticket), ticket.server_lang ?? ticket.lang));
}

// Match asserted incidents, not a topic explicitly denied in the same clause.
// Keep negative and positive clauses separate: "не читер, но другой читер".
function asserted(text: string, pattern: RegExp) {
  for (const match of text.matchAll(new RegExp(pattern.source, 'giu'))) {
    const before = text.slice(0, match.index).split(/[.!?;\n]|(?:\s(?:но|однако|but|pero|mas|бірақ|lekin)\s)/iu).at(-1)!.slice(-90);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 45).split(/[.!?;,\n]/u)[0];
    const deniedBefore = /(?:не|нет|никак\p{L}*|без|not|no|never|никаких)\s+(?:[\p{L}'-]+\s+){0,2}$/iu.test(before)
      || /не\s+(?:утверждаю|говорю|считаю|думаю).{0,55}$/iu.test(before);
    const deniedAfter = /^\p{L}*\s+(?:(?:вообще|там|здесь|точно)\s+)?(?:не\s+был\p{L}*|нет|не\s+использ\p{L}*|емес|emas|yo'q)(?=$|\s)/iu.test(after);
    if (!deniedBefore && !deniedAfter) return true;
  }
  return false;
}

function criticalIncident(text: string) {
  const t = text.toLowerCase().replaceAll('ё', 'е');
  const place = /реальн|вне игры|адрес|дома|домой|real life|irl|home|address|vida real|casa|endereço|мекенжай|үйім|uyim|manzil/iu;
  const violence = /угрож|убь[ею]|убить|найд[еу]|найти|kill|threat|matar|amenaz|ameaç|өлтір|o'ldir/iu;
  // Evaluate whole sentences so quoted future threats and inflected verbs count.
  const threat = t.split(/[.!?;\n]/u).some(sentence => place.test(sentence) && asserted(sentence, violence));
  const outage = asserted(t, /массов\p{L}*.{0,25}(?:баг|сбой)|(?:все|всех).{0,25}(?:вылет|не могут зайти)|mass.{0,15}bug|server.{0,20}(?:down|outage)|massive outage/iu)
    || t.split(/[.!?;\n]/u).some(sentence => /every(?:one| member| player)|all (?:players|users|groups)|widespread|server-wide/iu.test(sentence)
      && asserted(sentence, /disconnect\p{L}*|crash\p{L}*|failure|failing|unavailable|(?:cannot|can't|unable to).{0,20}(?:connect|join|log in|open)/iu));
  return threat || outage;
}

function rulesQuestion(text: string, support: SupportResult) {
  return support.processing.knowledge?.status === 'answered' || glossaryTerms(text).length > 0
    || /правил|разрешен|разрешён|запрещен|запрещён|можно ли|наказан|что такое.{0,20}(?:дм|дб|рп|нрп|тк|ск|мг|пг)|(?:дм|дб|рп|dm|db|rp|nonrp|mg|pg).{0,25}(?:деген|nima)|\brules?\b|reglas|regras|ереже|qoida/iu.test(text);
}

function categoryFor(ticket: Ticket, text: string, support: SupportResult): { category: Category; topic: string; appeal: boolean; uncertain: boolean; accessLost?: boolean } {
  const t = text.toLowerCase().replaceAll('ё', 'е').replace(/[‘’ʻʼ`]/gu, "'");
  const appeal = /обжал|пересмотр|разбан|снимите.{0,25}(?:бан|мут|наказ)|апелляц|ban.{0,25}(?:olib|ochib)|бан.{0,20}(?:алып|аш)|appeal|unban/iu.test(t);
  const payment = /оплат|платеж|донат|(?:гк|\bgc\b).{0,35}не.{0,20}(?:приш|начисл)|списал\p{L}*.{0,30}(?:деньг|карт)|деньг\p{L}*.{0,25}списал|to'lov|to'lad|tolov|pul.{0,20}tushma|төлем|төлед|ақша.{0,25}(?:түсп|келме)|толем|payment|paid|charged|pago|pagu[eé]|pagamento|paguei/iu.test(t);
  const paymentProblem = /(?:не|неправильно).{0,20}(?:приш|начисл|зачисл|прошел)|списал|оплатил|деньг\p{L}*.{0,15}пропал|paid.{0,50}(?:not|never|nothing)|charged|(?:pago|pagu[eé]).{0,45}no|(?:pagamento|paguei).{0,45}n[ãa]o|түспе|келме|tushma|kelma/iu.test(t);
  const accessLost = /взломал|аккаунт.{0,25}(?:взлом|укра|увели|угна)|(?:взлом|украли|угнали).{0,25}(?:акк|аккаунт)|(?:не могу|не получается).{0,15}(?:войти|зайти)|не.{0,5}(?:заходит|входит).{0,20}(?:акк|профиль)|доступ.{0,15}(?:нет|потер)|(?:нет|потерял).{0,15}доступ|akkaunt.{0,25}(?:buz|o'g'ir)|аккаунт.{0,25}(?:бұз|буз|ұрла|урла)|кіре алмай|kira olmay|kirolmay|кира олма|hacked|lost access|(?:cannot|can't|unable to).{0,20}(?:log in|login|sign in|access)|account.{0,25}(?:stolen|hacked)|cuenta.{0,20}(?:rob|hack)|(?:robaron|hackearon).{0,20}cuenta|no puedo.{0,20}(?:entrar|acceder)|sin acceso.{0,20}cuenta|conta.{0,20}(?:invad|roub)|n[ãa]o (?:consigo|posso).{0,20}(?:entrar|acessar|aceder)|sem acesso.{0,20}conta|(?:perdi|perdido).{0,15}acesso/iu.test(t);
  const propertyLost = /пропал[аио]?.{0,20}(?:машин|имущество|деньг)|(?:машин|имущество|деньг).{0,20}пропал|lost.{0,15}(?:car|property)|көлігім.{0,20}жоғал|(?:mashina|mulk|ombor|uyim).{0,65}yo'qol/iu.test(t);
  // A first-person pronoun is not evidence of an incident. Explicit failed
  // transactions/access override a question; instructions remain questions.
  const instructions = /(?:как|где|how|where|cómo|como|қалай|qanday).{0,70}(?:оплат|донат|защит|взлом|войти|зайти|pay|protect|login|log in|pagar|proteger|entrar|төле|to'la)/iu.test(t);
  const info = support.processing.route === 'question' || instructions;
  if (ticket.kind === 'report') {
    if (payment && (!info || paymentProblem)) return { category: 'report.payment', topic: 'payment', appeal, uncertain: false };
    if ((accessLost || propertyLost) && (!instructions || /(?:украли|угнали|взломали|не могу|не получается|cannot|can't|stolen|hacked)/iu.test(t))) return { category: 'report.account', topic: 'account', appeal, uncertain: false, accessLost };
  }
  const topic = asserted(t, /(?<!\p{L})(?:чит\p{L}*|аим\p{L}*|aimbot|cheat\p{L}*)|стен.{0,10}стрел|стрел\p{L}*.{0,20}через стен|сторонн.{0,20}по|devordan/iu) ? 'cheat'
    : asserted(t, /мошен\p{L}*|обман\p{L}*|скам\p{L}*|украл\p{L}*|вымога\p{L}*|aldadi|алда\p{L}*|scam\p{L}*/iu) ? 'scam'
      : asserted(t, /реклам\p{L}*|за реал|rmt|прода.{0,15}аккаунт|advertis\p{L}*/iu) ? 'rmt_ads'
        : asserted(t, /оскорб\p{L}*|оск(?:\s|$)|родн\p{L}*|расизм|haqorat|so'k\p{L}*|қорла\p{L}*|корла\p{L}*|insult\p{L}*/iu) ? 'insult'
          : asserted(t, /(?<!\p{L})(?:дм\p{L}*|дб\p{L}*|dm|db|тк|ск|нрп|nonrp)(?!\p{L})|убил\p{L}*|убива\p{L}*|бьют|стреля\p{L}*|өлтір\p{L}*|урып|o'ldir\p{L}*|otib/iu) ? 'dm' : 'other';
  if (ticket.kind === 'complaint') {
    if (appeal || /админ.{0,40}(?:выдал|наказ|забан|оскорб)|жалоб.{0,10}на админ/iu.test(t)) return { category: 'complaint.admin', topic: 'admin', appeal: true, uncertain: false };
    if (criticalIncident(t)) return { category: `complaint.${topic}` as Category, topic, appeal, uncertain: topic === 'other' };
    if (info || support.processing.route === 'trash' || !support.processing.route) return { category: 'complaint.invalid', topic, appeal, uncertain: true };
    return { category: `complaint.${topic}` as Category, topic, appeal, uncertain: topic === 'other' };
  }
  if (info && !appeal) return { category: 'report.question', topic, appeal, uncertain: false };
  if (criticalIncident(t)) return { category: 'report.help', topic, appeal, uncertain: false };
  if (/^\s*(?:помогите|помоги|ау|привет|help|hello)[.!?\s]*$/iu.test(ticketText(ticket))) return { category: 'report.offtopic', topic, appeal, uncertain: false };
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
  const realThreat = criticalIncident(text);
  let priority: Priority = decision.accessLost || category === 'report.payment' || realThreat ? 'p0'
    : ['cheat', 'rmt_ads'].includes(decision.topic) && !['report.question', 'complaint.invalid', 'report.offtopic'].includes(category) ? 'p1'
      : category.startsWith('complaint.') && category !== 'complaint.invalid' && hasEvidence ? 'p1'
        : category === 'report.question' ? rulesQuestion(text, support) ? 'p2' : 'p3'
          : category === 'report.offtopic' || category === 'complaint.invalid' || (ticket.kind === 'complaint' && !hasEvidence) ? 'p3' : 'p2';
  if (!realThreat && category === 'complaint.scam' && /крупн|миллион|\d+\s*(?:кк|млн)|бизнес|дом/iu.test(text)) priority = 'p1';
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
  const signature = ticketSignature(ticket);
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
