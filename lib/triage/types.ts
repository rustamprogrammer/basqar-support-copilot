export const CATEGORIES = ['complaint.insult', 'complaint.cheat', 'complaint.dm', 'complaint.scam', 'complaint.rmt_ads', 'complaint.admin', 'complaint.other', 'complaint.invalid', 'report.question', 'report.help', 'report.complaint', 'report.account', 'report.payment', 'report.offtopic'] as const;
export type Category = typeof CATEGORIES[number];
export type Language = 'ru' | 'kk' | 'uz' | 'en' | 'es' | 'pt' | 'und';
export type Priority = 'p0' | 'p1' | 'p2' | 'p3';
export type Ticket = {
  ticket_id?: string; kind: 'complaint' | 'report'; created_at?: string;
  reporter_hash?: string; reported_nick?: string; server?: string; server_lang?: Language; lang?: Language;
  rule_refs_raw?: string; images_count?: number;
  messages: { role: 'player' | 'reported_player' | 'admin'; text: string; attachments?: number }[];
};
export type RuleChunk = { id: string; section: string; ref: string; text: string };
export type Corpus = { version: string; source: string; chunks: RuleChunk[] };
export type TriageResult = {
  lang: Language; category: Category; priority: Priority; is_spam_or_duplicate: boolean;
  extracted: { nickname: string | null; rule_refs: string[]; has_evidence: boolean; server: string | null };
  draft_reply: { lang: Language; text: string; cited: string[] };
  needs_human: boolean; confidence: number; reasons: string[];
  meta: {
    version: string; corpus_version: string; mode: 'local' | 'rules+ai'; confidence_kind: 'heuristic';
    input_normalized: boolean; evidence_claimed: boolean; moderation_flag: boolean;
    live_urgency: 'now' | 'high' | 'normal' | null; elapsed_ms: number; api_cost_usd: number | null;
    provider_usage?: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number };
    citations: RuleChunk[]; duplicate_of?: string;
  };
};

export function parseTicket(value: unknown): Ticket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a ticket object.');
  const v = value as Record<string, unknown>;
  if (v.kind !== 'complaint' && v.kind !== 'report') throw new Error('kind must be complaint or report.');
  if (!Array.isArray(v.messages) || !v.messages.length || v.messages.length > 32) throw new Error('messages must contain 1–32 messages.');
  let total = 0;
  const messages = v.messages.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid message.');
    const m = item as Record<string, unknown>;
    if (!['player', 'reported_player', 'admin'].includes(String(m.role)) || typeof m.text !== 'string' || m.text.length > 8000) throw new Error('Invalid message role or text.');
    total += m.text.length;
    if (m.attachments !== undefined && (!Number.isSafeInteger(m.attachments) || Number(m.attachments) < 0 || Number(m.attachments) > 100)) throw new Error('Invalid attachments count.');
    return { role: m.role as Ticket['messages'][number]['role'], text: m.text, ...(m.attachments !== undefined ? { attachments: Number(m.attachments) } : {}) };
  });
  if (total > 16000 || !messages.some(m => m.role === 'player' && m.text.trim())) throw new Error('A nonempty player message is required; maximum total is 16000 characters.');
  const result: Ticket = { kind: v.kind, messages };
  for (const key of ['ticket_id', 'created_at', 'reporter_hash', 'reported_nick', 'server', 'rule_refs_raw'] as const) {
    if (v[key] !== undefined) {
      if (typeof v[key] !== 'string' || v[key].length > 300) throw new Error(`Invalid ${key}.`);
      result[key] = v[key];
    }
  }
  if (result.created_at && !Number.isFinite(Date.parse(result.created_at))) throw new Error('Invalid created_at.');
  for (const key of ['lang', 'server_lang'] as const) if (v[key] !== undefined) {
    if (!['ru', 'kk', 'uz', 'en', 'es', 'pt', 'und', 'lat'].includes(String(v[key]))) throw new Error(`Invalid ${key}.`);
    result[key] = v[key] === 'lat' ? 'und' : v[key] as Language;
  }
  if (v.images_count !== undefined) {
    if (!Number.isSafeInteger(v.images_count) || Number(v.images_count) < 0 || Number(v.images_count) > 100) throw new Error('Invalid images_count.');
    result.images_count = Number(v.images_count);
  }
  // Deliberately exclude verdict, punishment, violation and other retrospective labels.
  return result;
}
