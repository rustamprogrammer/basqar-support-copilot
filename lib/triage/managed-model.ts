import { decryptApiKey, inputHash, readAiSettings, reserveAiRequest, validSettingsSecret, type AiSettingsDatabase, type AiRequestRow } from '../ai-settings.ts';
import type { ProcessingTrace } from '../message-types.ts';
import { applyContestModel, buildContestRequest, CONTEST_PROMPT_VERSION, independentContestContext, modelSources, requestContestModel, validateModelDecision, type ContestModelResult } from './model.ts';
import { allowContestRequest } from './rate-limit.ts';
import { chooseContestReview } from './review-policy.ts';
import type { Corpus, RuleChunk, Ticket, TriageResult } from './types.ts';

export class ContestInProgressError extends Error {}
type ManagedResult = { triage: TriageResult; review: NonNullable<ProcessingTrace['aiReview']> };
function validStoredResult(value: unknown, ticket: Ticket, sources: RuleChunk[]): value is ContestModelResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as ContestModelResult;
  if (!Number.isFinite(r.elapsedMs) || r.elapsedMs < 0 || (r.costUsd !== null && (!Number.isFinite(r.costUsd) || r.costUsd < 0))) return false;
  if (!r.ok) return r.ok === false && typeof r.code === 'string' && /^[a-z0-9_]{1,80}$/u.test(r.code);
  return typeof r.model === 'string' && r.costUsd !== null && validateModelDecision(r.decision, ticket, sources)
    && !!r.usage && [r.usage.inputTokens, r.usage.outputTokens, r.usage.cachedTokens, r.usage.cacheWriteTokens].every(n => Number.isSafeInteger(n) && n >= 0)
    && r.usage.cachedTokens + r.usage.cacheWriteTokens <= r.usage.inputTokens;
}

export async function managedContestModel(input: { ticket: Ticket; baseline: TriageResult; corpus: Corpus; db: AiSettingsDatabase; secret?: string; clientHash: string; fetcher?: typeof fetch }): Promise<ManagedResult> {
  const skip = (outcome: 'disabled' | 'limited' | 'unavailable', code: string, reason: string): ManagedResult => ({
    triage: { ...input.baseline, reasons: [...input.baseline.reasons, reason] },
    review: { outcome, errorCode: code, promptVersion: CONTEST_PROMPT_VERSION, reason },
  });
  try {
    const settings = await readAiSettings(input.db);
    if (!settings.enabled || !settings.encrypted_key) return skip('disabled', 'disabled', 'ИИ выключен или ключ не настроен; используется локальная обработка.');
    const choice = chooseContestReview(input.ticket, input.baseline, settings.mode);
    if (!choice.review) return skip('disabled', choice.code, choice.reason);
    if (!validSettingsSecret(input.secret)) return skip('unavailable', 'encryption_unavailable', 'Ключ ИИ недоступен; сохранён локальный вариант.');
    const modelContext = independentContestContext();
    const sources = modelSources(input.ticket, modelContext, input.corpus);
    let request;
    try { request = buildContestRequest(input.ticket, modelContext, sources, settings.model); }
    catch { return skip('unavailable', 'unsupported_model_or_input', 'Для выбранной модели или длины обращения нет проверенного режима RAG; сохранён локальный вариант.'); }
    const hash = await inputHash(JSON.stringify([CONTEST_PROMPT_VERSION, request])), id = `contest:${hash}`;
    const restoreSaved = (row: AiRequestRow): ManagedResult => {
      if (row.input_hash !== hash) return skip('unavailable', 'cache_conflict', 'Сохранённая проверка не соответствует запросу.');
      if (!row.result_json) {
        if (Date.now() - row.created_at < 30_000) throw new ContestInProgressError('Сообщение уже проверяется. Повторите через несколько секунд.');
        return skip('unavailable', 'interrupted', 'Предыдущая проверка прервалась; автоматический платный повтор отключён.');
      }
      let result: unknown;
      try { result = JSON.parse(row.result_json); } catch { return skip('unavailable', 'invalid_saved_result', 'Сохранённая проверка повреждена; используется локальный вариант.'); }
      return validStoredResult(result, input.ticket, sources) ? finish(result, true) : skip('unavailable', 'invalid_saved_result', 'Сохранённая проверка не прошла валидацию.');
    };
    const finish = (result: ContestModelResult, cached = false): ManagedResult => {
      const triage = applyContestModel(input.baseline, result, sources);
      triage.reasons.unshift(choice.reason);
      return {
        triage: cached ? { ...triage, meta: { ...triage.meta, api_cost_usd: 0 } } : triage,
        review: { outcome: result.ok ? 'replaced' : 'unavailable', promptVersion: CONTEST_PROMPT_VERSION,
          reason: result.ok ? result.decision.reason : 'ИИ не завершил проверку; сохранён локальный вариант.', cached, elapsedMs: result.elapsedMs,
          ...(result.ok ? { model: result.model, usage: result.usage } : { errorCode: result.code }) },
      };
    };
    const existing = await input.db.prepare('SELECT * FROM ai_requests WHERE id = ?').bind(id).first<AiRequestRow>();
    if (existing) return restoreSaved(existing);
    if (settings.used >= 100) return skip('limited', 'lifetime_limit', 'Лимит 100 запросов исчерпан; сохранён локальный вариант.');
    const key = await decryptApiKey(settings.encrypted_key, input.secret);
    if (!await allowContestRequest(input.db, input.clientHash)) return skip('limited', 'rate_limit', 'Лимит частоты проверки ИИ достигнут; сохранён локальный вариант.');
    const reservation = await reserveAiRequest(input.db, id, hash, settings.encrypted_key);
    if (!reservation.reserved) return reservation.row ? restoreSaved(reservation.row) : skip('limited', 'limit_or_settings_changed', 'Лимит исчерпан или настройки ИИ изменились.');
    const result = await requestContestModel(input.ticket, modelContext, sources, key, { model: settings.model, fetcher: input.fetcher });
    await input.db.prepare('UPDATE ai_requests SET result_json = ? WHERE id = ? AND token = ? AND result_json IS NULL').bind(JSON.stringify(result), id, reservation.row.token).run();
    return finish(result);
  } catch (error) {
    if (error instanceof ContestInProgressError) throw error;
    return skip('unavailable', 'settings_or_database_unavailable', 'ИИ недоступен; сохранён локальный вариант. Проверьте настройки и миграции базы.');
  }
}
