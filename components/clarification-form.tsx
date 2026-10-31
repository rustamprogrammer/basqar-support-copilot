"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Message } from "@/lib/message-types";
import { canClarify } from "@/lib/message-context";

export function ClarificationForm({ message, onSave }: { message: Message; onSave: (saved: Message) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draftId = useRef<string | null>(null);
  const remaining = Math.max(0, 2000 - (message.originalText ?? message.text).length - 12);
  const question = message.processing?.followUp;
  if (!canClarify(message) || !question) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !text.trim() || text.length > remaining) return;
    setBusy(true); setError("");
    draftId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draftId.current, parentId: message.id, text }),
      });
      const saved = await response.json().catch(() => null) as (Message & { error?: string }) | null;
      if (!response.ok || !saved || typeof saved.id !== "string") throw new Error(saved?.error || "Сервер временно недоступен. Попробуйте отправить уточнение ещё раз.");
      onSave(saved);
      setText(""); draftId.current = null;
    } catch (reason) {
      setError(reason instanceof TypeError ? "Нет связи с сервером. Попробуйте отправить уточнение ещё раз." : reason instanceof Error ? reason.message : "Не удалось сохранить уточнение. Попробуйте ещё раз.");
    } finally { setBusy(false); }
  }

  return <div className="feedback-form clarification-form">
    <form onSubmit={submit}>
      <label htmlFor={`clarification-${message.id}`}>{question}
        <textarea id={`clarification-${message.id}`} value={text} maxLength={remaining} disabled={busy || !remaining} required
          onChange={event => { setText(event.target.value); setError(""); draftId.current = null; }} />
      </label>
      {!remaining ? <p role="status">Нет места для дополнения. Отправьте новое сообщение.</p> : <span className="counter">{text.length} / {remaining}</span>}
      <button className="primary" disabled={busy || !text.trim() || !remaining}>{busy ? "Отправка…" : "Дополнить"}</button>
      {error && <p className="notice error" role="alert">{error}</p>}
    </form>
  </div>;
}
