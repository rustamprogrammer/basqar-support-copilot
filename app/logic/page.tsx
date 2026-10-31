"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, GitBranch, MessageCircle } from "lucide-react";
import { ProcessingTimeline } from "@/components/processing-timeline";
import type { Message } from "@/lib/message-types";

export default function LogicPage() {
  const [rows, setRows] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const initialSelectedId = new URLSearchParams(window.location.search).get("message") || "";
    let initial = true;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/messages", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Не удалось загрузить этапы обработки.");
        const messages = await response.json() as Message[];
        if (active) {
          if (initial) { setSelectedId(initialSelectedId); initial = false; }
          setRows(messages.filter(message => message.processing)); setError("");
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Ошибка соединения."); }
      finally { if (active) { setLoading(false); timer = setTimeout(refresh, 2000); } }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, []);

  const selected = selectedId ? rows.find(message => message.id === selectedId) : rows[0];
  const clarifications = selected ? rows.filter(message => message.processing?.context?.parentId === selected.id) : [];
  return <div className="shell">
    <header className="header">
      <Link className="brand" href="/" aria-label="На связи — главная"><span className="brand-icon"><MessageCircle size={21} /></span>На связи<span className="brand-dot">.</span></Link>
      <div className="header-actions"><a className="nav-link" href="/quality">Качество</a><Link className="nav-link" href="/"><ArrowLeft size={16} />К сообщениям</Link></div>
    </header>
    <main className="logic-main">
      <div className="heading"><span className="section-icon"><GitBranch size={25} /></span><h1>Логика</h1></div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {rows.length > 1 && <div className="logic-selector"><label htmlFor="logic-message">Обращение</label><select id="logic-message" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
        <option value="">Последнее обращение</option>
        {rows.map(message => <option key={message.id} value={message.id}>{new Date(message.createdAt).toLocaleString("ru-RU")} — {(message.originalText || message.text).replace(/\s+/g, " ").slice(0, 72)}</option>)}
      </select></div>}
      <section aria-label="Обработка обращения" aria-busy={loading} aria-live="polite">
        {loading ? <div className="empty">Загрузка…</div> : selected ? <>
          <details className="quality-note"><summary>Как выбирается категория</summary>
            {selected.processing?.aiReview ? <>
              <p>Алгоритм предлагает исправленный текст, категорию и уточнение. ИИ получает исходное сообщение и этот результат: подтверждает его или возвращает собственный полный вариант. При проверке смысл определяется по исходнику.</p>
              <p>Исходник, результат алгоритма и итог сохраняются. Если ИИ отключён, недоступен или достигнут лимит, остаётся результат алгоритма с отметкой, что ИИ его не проверил. Правила автоматически не меняются.</p>
            </> : <p>Сохранён результат прежней обработки по правилам и словарям. Исторические записи повторно не обрабатываются и не проходят проверку ИИ.</p>}
            <p>«Вопрос» — просьба объяснить или дать инструкцию. «Помощь» — конкретная проблема, жалоба, апелляция или действие администратора. Если вместе со справочным вопросом нужна помощь, выбирается «Помощь».</p>
            <p>«Нарушение» относится к собственному обращению автора. Мат в жалобе или пересказ чужих слов сам по себе не доказывает нарушение. Бессмысленные сообщения попадают в корзину.</p>
            <p>Подробности оцениваются отдельно от категории. Неясные обращения остаются на проверке у админа. Уточнение связано с исходным сообщением; автоматические ответы пока не отправляются.</p>
          </details>
          <ProcessingTimeline message={selected} />{clarifications.length > 0 && <nav aria-label="Уточнения к обращению">{clarifications.map(message => <div key={message.id}><a className="processing-link" href={`/logic?message=${encodeURIComponent(message.id)}`}>Уточнение от {new Date(message.createdAt).toLocaleString("ru-RU")}</a></div>)}</nav>}
        </> : !error && <div className="empty">{selectedId ? "Обращение не найдено" : "Пока нет обращений"}</div>}
      </section>
    </main>
  </div>;
}
