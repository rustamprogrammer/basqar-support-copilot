import { requestReview, validateReviewDecision, type ReviewCandidate, type ReviewContext, type ReviewResult, type ReviewVerifiedAnswer } from './ai-review-client.ts';
import { decryptApiKey, finishAiRequest, inputHash, readAiSettings, reserveAiRequest, validSettingsSecret, type AiSettingsDatabase } from './ai-settings.ts';
import { AI_REVIEW_POLICY_VERSION } from './ai-review-prompt.ts';

export type ManagedReview = { result: ReviewResult; cached?: boolean } | { skipped: 'disabled' | 'limited' | 'unavailable' | 'in_progress'; code: string };
export async function managedReview(input: { db: AiSettingsDatabase; secret?: string; requestId: string; original: string; candidate: ReviewCandidate; context?: ReviewContext; verifiedAnswers?: readonly ReviewVerifiedAnswer[]; manual?: boolean; uncertain?: boolean; fetcher?: typeof fetch }): Promise<ManagedReview> {
  try {
    const settings = await readAiSettings(input.db);
    if (!settings.encrypted_key || (!input.manual && (!settings.enabled || (settings.mode === 'uncertain' && !input.uncertain)))) return { skipped: 'disabled', code: !settings.encrypted_key ? 'no_key' : !settings.enabled ? 'disabled' : 'confident_rules' };
    if (!validSettingsSecret(input.secret)) return { skipped: 'unavailable', code: 'encryption_unavailable' };
    // Never consume a reservation if a stored credential cannot be decrypted.
    const key = await decryptApiKey(settings.encrypted_key, input.secret);
    const hash = await inputHash(JSON.stringify([input.original, input.candidate, input.context ?? null, input.verifiedAnswers ?? [], settings.model, AI_REVIEW_POLICY_VERSION]));
    const reservation = await reserveAiRequest(input.db, input.requestId, hash, settings.encrypted_key, !!input.manual);
    if (!reservation.reserved) {
      if (reservation.row) {
        if (reservation.row.input_hash !== hash) return { skipped: 'unavailable', code: 'request_id_conflict' };
        if (reservation.row.result_json) {
          const result = JSON.parse(reservation.row.result_json) as ReviewResult;
          if (result.ok ? validateReviewDecision(result.decision) : ['timeout', 'network', 'http', 'invalid', 'refusal'].includes(result.code)) return { result, cached: true };
          return { skipped: 'unavailable', code: 'invalid_saved_result' };
        }
        return Date.now() - reservation.row.created_at < 30_000 ? { skipped: 'in_progress', code: 'in_progress' } : { skipped: 'unavailable', code: 'interrupted' };
      }
      return { skipped: 'limited', code: 'limit_or_settings_changed' };
    }
    const result = await requestReview({ original: input.original, candidate: input.candidate, context: input.context, verifiedAnswers: input.verifiedAnswers, apiKey: key, model: settings.model, fetcher: input.fetcher });
    // Failed requests count too: the provider may have processed a request before a timeout.
    await finishAiRequest(input.db, input.requestId, reservation.row.token, result);
    return { result };
  } catch { return { skipped: 'unavailable', code: 'settings_unavailable' }; }
}
