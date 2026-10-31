"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Message } from "@/lib/message-types";
import { canClarify } from "@/lib/message-context";
import { postMessage } from '@/lib/message-client';

export function ClarificationForm({ message, onSave }: { message: Message; onSave: (saved: Message, notice?: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draftId = useRef<string | null>(null);
  const requestPending = useRef(false);
  const remaining = Math.max(0, 2000 - (message.originalText ?? message.text).length - 12);
  const question = message.processing?.followUp;
  if (!canClarify(message) || !question) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (requestPending.current || !text.trim() || text.length > remaining) return;
    requestPending.current = true;
    setBusy(true); setError("");
    draftId.current ??= crypto.randomUUID();
    try {
      const response = await postMessage({ id: draftId.current, parentId: message.id, text });
      const saved = await response.json().catch(() => null) as (Message & { error?: string; latestId?: string }) | null;
      if (response.status === 409) {
        const latestId = typeof saved?.latestId === "string" ? saved.latestId : message.id;
        const fresh = await fetch(`/api/messages?id=${encodeURIComponent(latestId)}`, { cache: "no-store" });
        const rows = await fresh.json().catch(() => null) as Message[] | null;
        const current = fresh.ok && Array.isArray(rows) ? rows.find(row => row.id === latestId) : undefined;
        if (!current) throw new Error("Обращение изменилось. Обновите страницу и проверьте уточнение перед отправкой.");
        draftId.current = null;
        const notice = "Обращение обновилось. Проверьте новые данные и при необходимости повторите уточнение.";
        setError(notice);
        onSave(current, notice);
        return;
      }
      if (!response.ok || !saved || typeof saved.id !== "string") throw new Error(saved?.error || "Сервер временно недоступен. Попробуйте отправить уточнение ещё раз.");
      onSave(saved);
      setText(""); draftId.current = null;
    } catch (reason) {
      setError(reason instanceof TypeError ? "Нет связи с сервером. Попробуйте отправить уточнение ещё раз." : reason instanceof Error ? reason.message : "Не удалось сохранить уточнение. Попробуйте ещё раз.");
    } finally { requestPending.current = false; setBusy(false); }
  }

  return <div className="feedback-form clarification-form">
    <form onSubmit={submit} aria-busy={busy}>
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
