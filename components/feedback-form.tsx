"use client";
import { useState } from "react";
import { feedbackLabel } from "@/lib/feedback";
import { ROUTING_SCHEMA, routeLabels } from "@/lib/message-routes";
import type { Message, Feedback } from "@/lib/message-types";

export function FeedbackForm({ message, onSave }: { message: Message; onSave: (feedback: Feedback) => void }) {
  const current = message.feedback?.routingSchema === ROUTING_SCHEMA;
  const [label, setLabel] = useState(current || (message.feedback && Object.hasOwn(routeLabels, message.feedback.label)) ? message.feedback!.label : "");
  const [details, setDetails] = useState(current && typeof message.feedback?.needsClarification === "boolean" ? String(message.feedback.needsClarification) : "unknown");
  const [corrected, setCorrected] = useState(message.feedback?.correctedText || "");
  const [note, setNote] = useState(message.feedback?.note || "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  return <details className="feedback-form">
    <summary>{message.feedback ? "Предложенная разметка" : "Указать правильный результат"}</summary>
    {!current && message.feedback && <p>Прежняя разметка: {feedbackLabel(message.feedback)}. Уточнение не оценивалось.</p>}
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setResult("");
      try {
        const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: message.id, label, routingSchema: ROUTING_SCHEMA, needsClarification: details === "unknown" ? null : details === "true", correctedText: corrected, note }) });
        const data = await response.json() as Feedback & { error?: string };
        if (!response.ok) throw new Error(data.error || "Не удалось сохранить разметку.");
        onSave(data); setResult("Предложение сохранено для проверки правил.");
      } catch (error) { setResult(error instanceof Error ? error.message : "Ошибка сохранения."); }
      finally { setBusy(false); }
    }}>
      <label>Правильная категория<select value={label} onChange={event => setLabel(event.target.value)} required disabled={busy}>
        <option value="">Выберите категорию</option>
        {Object.entries(routeLabels).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        <option value="clarify">Нельзя определить</option>
      </select></label>
      <label>Нужно уточнение<select value={details} onChange={event => setDetails(event.target.value)} disabled={busy}>
        <option value="unknown">Не могу оценить</option><option value="true">Да</option><option value="false">Нет</option>
      </select></label>
      <label>Правильный текст — если требуется<textarea value={corrected} onChange={event => setCorrected(event.target.value)} maxLength={2000} disabled={busy} /></label>
      <label>Причина — необязательно<input value={note} onChange={event => setNote(event.target.value)} maxLength={500} disabled={busy} /></label>
      <button className="secondary" disabled={busy || !label}>{busy ? "Сохранение…" : "Сохранить разметку"}</button>
      {result && <p role="status">{result}</p>}
    </form>
  </details>;
}
