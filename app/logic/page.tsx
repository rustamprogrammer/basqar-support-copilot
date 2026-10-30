"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, GitBranch, MessageCircle } from "lucide-react";
import { ProcessingTimeline } from "@/components/processing-timeline";
import type { Message } from "@/lib/message-types";

export default function LogicPage() {
  const [rows, setRows] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setSelectedId(new URLSearchParams(window.location.search).get("message") || "");
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/messages", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Не удалось загрузить этапы обработки.");
        const messages = await response.json() as Message[];
        if (active) { setRows(messages.filter(message => message.processing)); setError(""); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Ошибка соединения."); }
      finally { if (active) { setLoading(false); timer = setTimeout(refresh, 2000); } }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, []);

  const selected = selectedId ? rows.find(message => message.id === selectedId) : rows[0];
  return <div className="shell">
    <header className="header">
      <a className="brand" href="/" aria-label="На связи — главная"><span className="brand-icon"><MessageCircle size={21} /></span>На связи<span className="brand-dot">.</span></a>
      <a className="nav-link" href="/"><ArrowLeft size={16} />К сообщениям</a>
    </header>
    <main className="logic-main">
      <div className="heading"><span className="section-icon"><GitBranch size={25} /></span><h1>Логика</h1></div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {rows.length > 1 && <div className="logic-selector"><label htmlFor="logic-message">Обращение</label><select id="logic-message" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
        <option value="">Последнее обращение</option>
        {rows.map(message => <option key={message.id} value={message.id}>{new Date(message.createdAt).toLocaleString("ru-RU")} — {(message.originalText || message.text).replace(/\s+/g, " ").slice(0, 72)}</option>)}
      </select></div>}
      <section aria-label="Обработка обращения" aria-busy={loading} aria-live="polite">
        {loading ? <div className="empty">Загрузка…</div> : selected ? <ProcessingTimeline message={selected} /> : !error && <div className="empty">{selectedId ? "Обращение не найдено" : "Пока нет обращений"}</div>}
      </section>
    </main>
  </div>;
}
