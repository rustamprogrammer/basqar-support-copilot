"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "@/components/site-link";
import type { Message } from "@/lib/message-types";
import { effectiveState, effectiveUrgency, queueFlags, type ServiceAction } from "@/lib/support-state";

const urgencyLabels = { now: "Сейчас", high: "Высокий", normal: "Обычный" };
const stateLabels = { queued: "В очереди", in_progress: "В работе", answered: "Ответ отправлен", resolved: "Решено" };
const actionLabels: Record<string, string> = { queued: "В очереди", knowledge_answer: "Ответ по базе знаний", claim: "Взято в работу", release: "Возвращено в очередь", reply: "Ответ администратора", priority: "Изменён приоритет", helped: "Игроку помогло", need_admin: "Игрок запросил администратора" };

export function SupportCard({ message, admin = false, onSave }: { message: Message; admin?: boolean; onSave: (row: Message, notice?: string) => void }) {
  const [pending, setPending] = useState<ServiceAction | null>(null);
  const requestPending = useRef(false);
  const busy = pending !== null;
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [level, setLevel] = useState(effectiveUrgency(message));
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const route = message.processing?.route;
  const state = effectiveState(message);
  const urgency = message.processing?.urgency;
  const flags = queueFlags(message, now);
  const response = message.service?.reply;
  const knowledge = message.processing?.knowledge;
  const answer = response?.text ?? (knowledge?.status === "answered" ? knowledge.answer : undefined);
  const isKnowledgeAnswer = response ? response.author === "knowledge" : knowledge?.status === "answered";
  if (message.status === 'trash' || message.status === 'violation' || (route !== "help" && route !== "question" && !message.service)) return null;

  async function act(action: ServiceAction, value: { text?: string; level?: "now" | "high" | "normal"; reason?: string } = {}) {
    if (requestPending.current) return;
    requestPending.current = true;
    setPending(action); setError("");
    try {
      const result = await fetch("/api/service", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: message.id, revision: message.service?.revision ?? 0, action, ...value }) });
      const data = await result.json().catch(() => null) as (Message & { error?: string; latestId?: string }) | null;
      if (result.status === 409) {
        const latestId = typeof data?.latestId === "string" ? data.latestId : message.id;
        const fresh = await fetch(`/api/messages?id=${encodeURIComponent(latestId)}`, { cache: "no-store" });
        const rows = await fresh.json().catch(() => null) as Message[] | null;
        const updated = fresh.ok && Array.isArray(rows) ? rows.find(row => row.id === latestId) : undefined;
        if (updated) {
          const notice = data?.latestId ? "Появилось уточнение. Данные обновлены; повторите действие." : "Обращение изменилось. Данные обновлены; повторите действие.";
          setError(notice); onSave(updated, notice); return;
        }
        throw new Error("Обращение изменилось. Обновите страницу перед повторной попыткой.");
      }
      if (!result.ok || !data?.id) throw new Error(data?.error || "Не удалось сохранить действие.");
      onSave(data);
      if (action === "reply") setReply("");
      if (action === "priority") setReason("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Нет связи с сервером."); }
    finally { requestPending.current = false; setPending(null); }
  }

  function submitReply(event: FormEvent) { event.preventDefault(); if (reply.trim()) void act("reply", { text: reply.trim() }); }
  function submitPriority(event: FormEvent) { event.preventDefault(); if (reason.trim()) void act("priority", { level, reason: reason.trim() }); }

  return <section className="support-card" aria-label="Обработка обращения" aria-busy={busy}>
    <div className="support-badges">
      <span className="support-state">{stateLabels[state]}</span>
      {route === "help" && <span className={`urgency-badge urgency-${effectiveUrgency(message)}`}>{urgencyLabels[effectiveUrgency(message)]}{message.service?.manualUrgency ? " · вручную" : ""}</span>}
      {urgency?.uncertain && !message.service?.manualUrgency && <span className="support-flag">Срочность уточняется</span>}
      {flags.overdue && <span className="support-flag">Ожидание {flags.minutes} мин</span>}
      {flags.stale && state !== "resolved" && <span className="support-flag">Проверьте, продолжается ли ситуация</span>}
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {route === "help" && (message.service?.manualReason || urgency?.reason) && <p className="support-reason">{message.service?.manualReason || urgency?.reason}</p>}
    {answer && <div className="support-answer">
      <strong>{isKnowledgeAnswer ? "Ответ по базе знаний" : "Ответ администратора"}</strong>
      <p>{answer}</p>
      {isKnowledgeAnswer && knowledge?.source && <p className="support-source">{knowledge.source.title}{knowledge.source.ref ? ` · ${knowledge.source.ref}` : ""} · версия {knowledge.source.version}</p>}
      {!admin && response && (state === "answered" || state === "resolved") && <div className="support-actions">
        {state === "answered" && <button type="button" className="primary" disabled={busy} onClick={() => void act("helped")}>{pending === "helped" ? "Сохранение…" : "Помогло"}</button>}
        <button type="button" className="secondary" disabled={busy} onClick={() => void act("need_admin")}>{pending === "need_admin" ? "Передаём…" : "Нужен администратор"}</button>
      </div>}
    </div>}
    {admin && <>
      <div className="support-actions">
        {state === "queued" && <button type="button" className="primary" disabled={busy} onClick={() => void act("claim")}>{pending === "claim" ? "Сохранение…" : "Взять в работу"}</button>}
        {state === "in_progress" && <button type="button" className="secondary" disabled={busy} onClick={() => void act("release")}>{pending === "release" ? "Сохранение…" : "Вернуть в очередь"}</button>}
        {response?.author === "admin" && <Link className="secondary" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }} href={`/knowledge?message=${encodeURIComponent(message.id)}`}>В базу ответов</Link>}
      </div>
      <details className="feedback-form"><summary>Ответить игроку</summary>
        <form onSubmit={submitReply}>
          <label htmlFor={`support-reply-${message.id}`}>Ответ<textarea id={`support-reply-${message.id}`} value={reply} onChange={event => setReply(event.target.value)} maxLength={4000} required disabled={busy} /></label>
          <button className="primary" disabled={busy || !reply.trim()}>{pending === "reply" ? "Отправка…" : "Отправить ответ"}</button>
        </form>
      </details>
      {route === "help" && <details className="feedback-form" onToggle={event => { if (event.currentTarget.open) setLevel(effectiveUrgency(message)); }}><summary>Изменить приоритет</summary>
        <form onSubmit={submitPriority}>
          <label htmlFor={`support-priority-${message.id}`}>Приоритет<select id={`support-priority-${message.id}`} value={level} onChange={event => setLevel(event.target.value as typeof level)} disabled={busy}>{Object.entries(urgencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label htmlFor={`support-reason-${message.id}`}>Причина<input id={`support-reason-${message.id}`} value={reason} onChange={event => setReason(event.target.value)} maxLength={300} required disabled={busy} /></label>
          <button className="secondary" disabled={busy || !reason.trim()}>{pending === "priority" ? "Сохранение…" : "Сохранить приоритет"}</button>
        </form>
      </details>}
    </>}
    {!!message.service?.history.length && <details className="support-history"><summary>История обработки</summary><ol>{message.service.history.map((event, index) => <li key={`${event.at}-${index}`}><time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleString("ru-RU")}</time> · {actionLabels[event.action] ?? event.action}{event.detail && <p>{event.detail}</p>}</li>)}</ol></details>}
  </section>;
}
