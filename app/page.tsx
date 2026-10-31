"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, GitBranch, Inbox, MessageCircle, Send, ShieldAlert, ShieldCheck, Trash2, Undo2, UserRound } from "lucide-react";
import type { Message, MessageRoute, Status } from "@/lib/message-types";
import { messageRoute, routeLabels } from "@/lib/message-routes";
import { messagePage, retainMessageSnapshot } from "@/lib/message-list";
import { FeedbackForm } from "@/components/feedback-form";
import { ClarificationForm } from "@/components/clarification-form";

const labels: Record<Status, string> = { pending: "На проверке", accepted: "Принято", trash: "В корзине", violation: "Отмечено нарушение" };
type MessageFilter = MessageRoute | "all" | "undetermined";
const filterLabels: Record<MessageFilter, string> = { ...routeLabels, all: "Все", undetermined: "Не определено" };
function matchesFilter(row: Message, filter: MessageFilter) {
  return filter === "all" || messageRoute(row) === (filter === "undetermined" ? null : filter);
}

async function api<T = Message[]>(method = "GET", body?: object): Promise<T> {
  const response = await fetch("/api/messages", { method, cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || result === null) throw new Error(result?.error || "Сервер временно недоступен. Попробуйте ещё раз.");
  return result;
}

export default function Home() {
  const [role, setRole] = useState<"user" | "admin">("user");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Message[]>([]);
  const [filter, setFilter] = useState<MessageFilter>("all");
  const [workflow, setWorkflow] = useState<"all" | "pending" | "accepted">("pending");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Message | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearIds, setClearIds] = useState<string[] | null>(null);
  const [clearError, setClearError] = useState("");
  const [deletedCount, setDeletedCount] = useState<number | null>(null);
  const draftId = useRef<string | null>(null);
  const clearDialog = useRef<HTMLDialogElement>(null);
  const clearing = useRef(false);
  const rowsEpoch = useRef(0);

  useEffect(() => {
    if (clearIds) clearDialog.current?.showModal();
    else clearDialog.current?.close();
  }, [clearIds]);

  useEffect(() => {
    if (role !== "admin") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const epoch = rowsEpoch.current;
      try { if (!clearing.current && document.visibilityState !== "hidden") { const data = await api(); if (active && !clearing.current && epoch === rowsEpoch.current) { setRows(current => retainMessageSnapshot(current, data)); setError(""); } } }
      catch (e) { if (active && !clearing.current && epoch === rowsEpoch.current) setError(e instanceof Error ? e.message : "Ошибка соединения."); }
      finally { if (active) { setLoading(false); timer = setTimeout(refresh, 3000); } }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [role]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy("send"); setError(""); setReceipt(null);
    draftId.current ??= crypto.randomUUID();
    try {
      const saved = await api<Message>("POST", { text, id: draftId.current });
      setReceipt(saved); setText(""); draftId.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка соединения."); }
    finally { setBusy(null); }
  }

  async function review(id: string, status: Status) {
    setBusy(id); setError("");
    try {
      const saved = await api<Message>("PATCH", { id, status });
      setRows(current => current.map(row => row.id === id ? saved : row));
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка соединения."); }
    finally { setBusy(null); }
  }

  async function prepareClear() {
    if (busy) return;
    clearing.current = true; rowsEpoch.current += 1;
    setBusy("clear-prepare"); setError(""); setClearError(""); setDeletedCount(null);
    try {
      const data = await api();
      setRows(data);
      if (data.length) setClearIds(data.map(row => row.id));
      else clearing.current = false;
    } catch (e) {
      clearing.current = false;
      setError(e instanceof Error ? e.message : "Ошибка соединения.");
    } finally { setBusy(null); }
  }

  function cancelClear() {
    if (busy === "clear") return;
    setClearIds(null); setClearError("");
    clearing.current = false; rowsEpoch.current += 1;
  }

  async function clearMessages() {
    if (!clearIds || busy) return;
    setBusy("clear"); setClearError("");
    try {
      const result = await api<{ deletedCount: number }>("DELETE", { confirmation: "clear-messages", ids: clearIds });
      const removed = new Set(clearIds);
      setRows(current => current.filter(row => !removed.has(row.id)));
      setReceipt(null); setClearIds(null); setDeletedCount(result.deletedCount); setPage(1);
      clearing.current = false; rowsEpoch.current += 1;
    } catch (e) { setClearError(e instanceof Error ? e.message : "Ошибка соединения."); }
    finally { setBusy(null); }
  }

  const matchesWorkflow = (row: Message) => workflow === "all" || row.status === workflow;
  const visible = useMemo(() => rows.filter(row => (workflow === "all" || row.status === workflow) && matchesFilter(row, filter)), [rows, workflow, filter]);
  const paginated = messagePage(visible, page);

  return <div className="shell">
    <header className="header">
      <Link className="brand" href="/" aria-label="На связи — главная"><span className="brand-icon"><MessageCircle size={21} /></span>На связи<span className="brand-dot">.</span></Link>
      <div className="header-actions">
      <a className="nav-link" href="/logic"><GitBranch size={16} />Логика</a>
      {role === "admin" && <a className="nav-link" href="/quality">Качество</a>}
      <nav className="roles" aria-label="Роль">
        <button aria-pressed={role === "user"} onClick={() => { setRole("user"); setError(""); }}><UserRound size={16} />Пользователь</button>
        <button aria-pressed={role === "admin"} onClick={() => { if (role !== "admin") setLoading(true); setRole("admin"); setError(""); setReceipt(null); }}><ShieldCheck size={17} />Админ</button>
      </nav>
      </div>
    </header>
    <main>
      <div className="heading"><span className="section-icon">{role === "user" ? <Send size={24} /> : <ShieldCheck size={26} />}</span><h1>{role === "user" ? "Новое сообщение" : "Проверка сообщений"}</h1></div>
      {role === "user" ? <>
        <form className="composer" onSubmit={send}>
          <label className="sr-only" htmlFor="message">Ваше сообщение</label>
          <textarea id="message" placeholder="Напишите сообщение…" value={text} maxLength={2000} disabled={busy === "send"} onChange={e => { setText(e.target.value); setReceipt(null); draftId.current = null; }} required />
          <div className="composer-footer"><span className="counter">{text.length} / 2000</span><button className="primary" disabled={!text.trim() || !!busy}>{busy === "send" ? "Отправка…" : "Отправить"}<ArrowUpRight size={19} /></button></div>
        </form>
        {receipt && <div className="receipt">
          <div role="status" className={`notice ${receipt.status === "violation" ? "violation-notice" : receipt.status === "trash" ? "neutral" : ""}`}>{receipt.status === "violation" ? <ShieldAlert size={18} /> : <Check size={18} />}{receipt.status === "violation" ? "Сообщение отправлено в раздел «Нарушение»" : receipt.status === "pending" ? receipt.processing?.needsClarification || receipt.processing?.followUp ? "Передано админу; нужно уточнение" : "Отправлено админу на проверку" : receipt.status === "accepted" ? "Сообщение принято" : "Сообщение отправлено в корзину"}</div>
          {receipt.originalText && receipt.originalText.trim() !== receipt.text && <div className="correction"><span className="correction-label">Исправлено</span><p>{receipt.text}</p><details><summary>Исходный текст</summary><p>{receipt.originalText}</p></details></div>}
          {receipt.processing && <a className="processing-link" href={`/logic?message=${receipt.id}`}><GitBranch size={16} />Этапы обработки</a>}
          {receipt.processing?.context && <a className="processing-link" href={`/logic?message=${encodeURIComponent(receipt.processing.context.parentId)}`}>Исходное обращение</a>}
          <ClarificationForm key={receipt.id} message={receipt} onSave={setReceipt} />
        </div>}
      </> : <>
        <nav className="filters" aria-label="Категория сообщений">{(["all", "question", "help", "undetermined", "violation", "trash"] as const).map(route => <button key={route} className={route === "violation" ? "violation-filter" : undefined} aria-pressed={filter === route} onClick={() => { setFilter(route); setPage(1); if (route === "violation" || route === "trash") setWorkflow("all"); }}>{filterLabels[route]}<span>{rows.filter(row => (route === "violation" || route === "trash" || matchesWorkflow(row)) && matchesFilter(row, route)).length}</span></button>)}</nav>
        <div className="admin-toolbar">
          <button className="secondary violation-action" disabled={loading || !!busy || rows.length === 0} onClick={prepareClear}><Trash2 size={15} />{busy === "clear-prepare" ? "Загрузка…" : "Очистить сообщения"}</button>
          <label className="workflow-filter">Статус<select value={workflow} onChange={event => { setWorkflow(event.target.value as typeof workflow); setPage(1); }}><option value="all">Любой</option><option value="pending">На проверке</option><option value="accepted">Принято</option></select></label>
        </div>
        {deletedCount !== null && <div className="notice clear-result" role="status">Удалено сообщений: {deletedCount}.</div>}
        {!loading && paginated.pageCount > 1 && <nav className="message-pagination" aria-label="Страницы сообщений">
          <button className="secondary" disabled={paginated.page === 1} onClick={() => setPage(paginated.page - 1)}>Назад</button>
          <span aria-live="polite">Страница {paginated.page} из {paginated.pageCount}</span>
          <button className="secondary" disabled={paginated.page === paginated.pageCount} onClick={() => setPage(paginated.page + 1)}>Вперёд</button>
        </nav>}
        <section className="messages" aria-label={filter === "all" ? "Все сообщения" : filterLabels[filter]} aria-busy={loading}>
          {loading ? <div className="empty">Загрузка…</div> : visible.length === 0 ? <div className="empty"><span className="empty-icon">{filter === "violation" ? <ShieldAlert size={28} /> : filter === "trash" ? <Trash2 size={28} /> : <Inbox size={30} />}</span><p>Нет сообщений с выбранными фильтрами</p></div> : paginated.items.map(row => <article className={`message ${messageRoute(row) === "violation" ? "message-violation" : ""}`} key={row.id}>
            <div className="message-meta"><span><UserRound size={14} />Пользователь</span><time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></div>
            <div className="message-tags"><span>{messageRoute(row) ? routeLabels[messageRoute(row)!] : "Категория не определена"}</span><span>{labels[row.status]}</span>{row.processing?.needsClarification && <span>Нужно уточнение</span>}</div>
            <p>{row.text}</p>
            {(row.status === "pending" || row.status === "violation") && row.processing?.needsClarification && row.processing.followUp && <p className="quality-note">Уточнить: {row.processing.followUp}</p>}
            {row.status === "violation" && <p className="violation-reason">{row.processing?.classification === "violation" ? row.processing.steps.find(step => step.id === "classified")?.detail : "Отмечено администратором."}</p>}
            {row.originalText && row.originalText.trim() !== row.text && <details className="message-original"><summary>Исходный текст</summary><p>{row.originalText}</p></details>}
            {row.processing && <a className="processing-link" href={`/logic?message=${row.id}`}><GitBranch size={16} />Этапы обработки</a>}
            {row.processing?.context && <a className="processing-link" href={`/logic?message=${encodeURIComponent(row.processing.context.parentId)}`}>Исходное обращение</a>}
            <FeedbackForm message={row} onSave={feedback => setRows(current => current.map(item => item.id === row.id ? { ...item, feedback } : item))} />
            <div className="actions">
              {row.status === "pending" && <button className="primary" disabled={!!busy} onClick={() => review(row.id, "accepted")}><Check size={16} />Принять</button>}
              {row.status !== "trash" && <button className="secondary" disabled={!!busy} onClick={() => review(row.id, "trash")}><Trash2 size={15} />В корзину</button>}
              {row.status !== "violation" && <button className="secondary violation-action" disabled={!!busy} onClick={() => review(row.id, "violation")}><ShieldAlert size={15} />В нарушения</button>}
              {row.status !== "pending" && <button className="secondary" disabled={!!busy} onClick={() => review(row.id, "pending")}><Undo2 size={15} />Вернуть на проверку</button>}
            </div>
          </article>)}
        </section>
      </>}
      {error && <div className="notice error" role="alert">{error}</div>}
      <dialog ref={clearDialog} className="clear-dialog" aria-labelledby="clear-title" aria-describedby="clear-description" onCancel={event => { event.preventDefault(); cancelClear(); }}>
        <h2 id="clear-title">Очистить сообщения</h2>
        <p id="clear-description">Удалить все текущие сообщения ({clearIds?.length ?? 0}), ответы и разметку? Отменить удаление нельзя.</p>
        {clearError && <div className="notice error" role="alert">{clearError}</div>}
        <div className="actions"><button className="secondary" autoFocus disabled={busy === "clear"} onClick={cancelClear}>Отмена</button><button className="primary clear-confirm" disabled={!!busy} onClick={clearMessages}>{busy === "clear" ? "Удаление…" : "Удалить"}</button></div>
      </dialog>
    </main>
  </div>;
}
