"use client";
import type { TriageResult } from '@/lib/triage/types';
const priorities = { p0: 'Критичный', p1: 'Высокий', p2: 'Обычный', p3: 'Низкий' };
export function TriageSummary({ result, onUseDraft, blocked = false }: { result: TriageResult; onUseDraft?: () => void; blocked?: boolean }) {
  return <section className="triage-summary" aria-label="Черновик поддержки">
    <div className="support-badges"><strong>Черновик поддержки</strong><span className={`triage-priority triage-${result.priority}`}>{priorities[result.priority]} · {result.priority.toUpperCase()}</span><span>{result.draft_reply.lang.toUpperCase()}</span><span>{result.needs_human ? 'Нужна проверка человека' : 'Проверенный FAQ'}</span></div>
    <p>{result.draft_reply.text}</p>
    {blocked && <p className="support-flag">Проблема сохранена отдельно от нарушения общения. Верните обращение на проверку, чтобы ответить игроку.</p>}
    {onUseDraft && <button type="button" className="secondary" onClick={onUseDraft}>Редактировать и отправить</button>}
    <details><summary>Основания и сведения</summary>
      <p>Категория: {result.category}. Язык: {result.lang}. Игрок: {result.extracted.nickname ?? 'не указан'}. Сервер: {result.extracted.server ?? 'не указан'}.</p>
      <p>{result.extracted.has_evidence ? 'Указаны вложения; содержимое не проверено.' : 'Наличие вложений не подтверждено.'}</p>
      <ul>{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><p>Уверенность — эвристическая оценка, не измеренная вероятность правильности.</p>
      {result.meta.citations.map(rule => <blockquote key={rule.id}><strong>{rule.section} · {rule.ref}</strong><p>{rule.text}</p></blockquote>)}
      {!result.meta.citations.length && <p>Пункты правил не подобраны.</p>}
    </details>
  </section>;
}
