import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { inputHash } from '../ai-settings.ts';
import { processServerMessageWithReview } from '../server-review.ts';
import { loadKnowledge } from '../knowledge-store.ts';
import { triage, ticketText, problemSignature } from './engine.ts';
import { normalizeKazakh } from './language.ts';
import { ruleCorpus } from './runtime.ts';
import type { Ticket } from './types.ts';

export async function runServerTriage(ticket: Ticket) {
  const db = getDb().$client, entries = await loadKnowledge();
  const original = ticketText(ticket), normalized = normalizeKazakh(original, ticket.server_lang ?? ticket.lang);
  const signature = await inputHash(problemSignature(normalized));
  // The existing teammate integration owns model calls, its key and the lifetime
  // 100-attempt counter. No second provider client or hidden retries are added.
  const support = normalized.length <= 2000 ? await processServerMessageWithReview(normalized, undefined, entries, {
    db, secret: env.SUPPORT_SETTINGS_SECRET,
    requestId: `triage:${await inputHash(JSON.stringify([ticket.ticket_id ?? null, normalized]))}`,
    refreshEntries: loadKnowledge,
  }) : undefined;
  const result = triage(ticket, { corpus: ruleCorpus, support, entries });
  if (normalized.length > 2000) result.reasons.push('Длинное обращение обработано локально без обрезки; проверка ИИ ограничена 2000 символами.');
  if (ticket.reporter_hash) {
    const reporter = await inputHash(ticket.reporter_hash), at = ticket.created_at ? Date.parse(ticket.created_at) : Date.now();
    const id = ticket.ticket_id ?? crypto.randomUUID();
    // Store hashes only. Same identity + conservative problem signature + hour;
    // retries of the same ticket do not label themselves duplicate.
    const duplicate = await db.prepare('SELECT ticket_id FROM triage_history WHERE reporter = ? AND signature = ? AND event_at BETWEEN ? AND ? AND ticket_id <> ? ORDER BY event_at LIMIT 1')
      .bind(reporter, signature, at - 3600000, at, id).first<{ ticket_id: string }>();
    if (duplicate) {
      result.is_spam_or_duplicate = true; result.meta.duplicate_of = duplicate.ticket_id;
      result.reasons.push('Повтор той же формулировки от того же заявителя за час; приоритет и необходимость человека сохранены.');
    }
    await db.prepare('INSERT OR IGNORE INTO triage_history(id, ticket_id, reporter, signature, event_at, stored_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await inputHash(JSON.stringify([reporter, id, signature])), id, reporter, signature, at, Date.now()).run();
    await db.prepare('DELETE FROM triage_history WHERE stored_at < ?').bind(Date.now() - 86400000).run();
  }
  return result;
}
