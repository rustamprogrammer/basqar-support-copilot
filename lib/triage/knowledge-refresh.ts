import type { ProcessingTrace } from '../message-types.ts';
import type { TriageResult } from './types.ts';

/** Refresh local FAQ applicability without losing the already completed attempt.
 * This function never invokes a provider or changes the reservation ledger.
 */
export function refreshTriageAfterKnowledgeChange(previous: TriageResult, refreshed: TriageResult, review: NonNullable<ProcessingTrace['aiReview']>): TriageResult {
  // A successful model draft is separate from the automatic knowledge card.
  if (previous.meta.mode === 'rules+ai') return previous;
  const failedReview = review.outcome === 'unavailable' || review.outcome === 'limited';
  return {
    ...refreshed,
    needs_human: refreshed.needs_human || (failedReview && previous.needs_human),
    reasons: failedReview ? [...new Set([...refreshed.reasons, ...previous.reasons])] : refreshed.reasons,
    meta: { ...refreshed.meta, api_cost_usd: previous.meta.api_cost_usd,
      ...(previous.meta.provider_usage ? { provider_usage: previous.meta.provider_usage } : {}),
    },
  };
}
