import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { inputHash } from '../ai-settings.ts';
import { processSupportMessage } from '../support-processing.ts';
import { loadKnowledge } from '../knowledge-store.ts';
import { triage, ticketText, problemSignature } from './engine.ts';
import { normalizeKazakh } from './language.ts';
import { ruleCorpus } from './runtime.ts';
import type { Ticket } from './types.ts';
import { recordTriageHistory } from './history.ts';
import { managedContestModel } from './managed-model.ts';

export async function runServerTriage(ticket: Ticket, clientHash = 'anonymous') {
  const db = getDb().$client, entries = await loadKnowledge();
  const original = ticketText(ticket), normalized = normalizeKazakh(original, ticket.server_lang ?? ticket.lang);
  const signature = await inputHash(problemSignature(normalized));
  const support = processSupportMessage(normalized, undefined, entries);
  const baseline = triage(ticket, { corpus: ruleCorpus, support, entries });
  const { triage: result } = await managedContestModel({ ticket, baseline, corpus: ruleCorpus, db, secret: env.SUPPORT_SETTINGS_SECRET, clientHash });
  if (ticket.reporter_hash) {
    const reporter = await inputHash(ticket.reporter_hash), at = ticket.created_at ? Date.parse(ticket.created_at) : Date.now();
    const id = ticket.ticket_id ?? crypto.randomUUID();
    const duplicate = await recordTriageHistory(db, {
      id: await inputHash(JSON.stringify([reporter, id, signature])), ticketId: id,
      reporter, signature, eventAt: at, storedAt: Date.now(),
    });
    if (duplicate) {
      result.is_spam_or_duplicate = true; result.meta.duplicate_of = duplicate;
      result.reasons.push('Повтор той же формулировки от того же заявителя за час; приоритет и необходимость человека сохранены.');
    }
  }
  return result;
}
