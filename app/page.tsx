"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, GitBranch, Inbox, MessageCircle, Send, ShieldCheck, Trash2, UserRound } from "lucide-react";
import type { Message, Status } from "@/lib/message-types";
import type { Box } from "@/lib/classifier";
import { BOX_LABELS } from "@/lib/box-labels";

const labels: Record<Status, string> = { pending: "На проверке", accepted: "Принято", trash: "Корзина" };

async function api<T = Message[]>(method = "GET", body?: object): Promise<T> {
  const response = await fetch("/api/messages", { method, cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Не удалось выполнить действие.");
  return result;
}

export default function Home() {
  const [role, setRole] = useState<"user" | "admin">("user");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Message[]>([]);
  const [filter, setFilter] = useState<Status>("pending");
  const [boxFilter, setBoxFilter] = useState<Box | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Message | null>(null);
  const [loading, setLoading] = useState(false);
  const draftId = useRef<string | null>(null);

  useEffect(() => {
    if (role !== "admin") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    const refresh = async () => {
      try { const data = await api(); if (active) { setRows(data); setError(""); } }
      catch (e) { if (active) setError(e instanceof Error ? e.message : "Ошибка соединения."); }
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

  const boxRows = rows.filter(row => boxFilter === "all" || row.processing?.box === boxFilter);
  const visibleRows = boxRows.filter(row => row.status === filter);

  return <div className="shell">
    <header className="header">
      <a className="brand" href="/" aria-label="На связи — главная"><span className="brand-icon"><MessageCircle size={21} /></span>На связи<span className="brand-dot">.</span></a>
      <div className="header-actions">
      <a className="nav-link" href="/logic"><GitBranch size={16} />Логика</a>
      <nav className="roles" aria-label="Роль">
        <button aria-pressed={role === "user"} onClick={() => { setRole("user"); setError(""); }}><UserRound size={16} />Пользователь</button>
        <button aria-pressed={role === "admin"} onClick={() => { setRole("admin"); setError(""); setReceipt(null); }}><ShieldCheck size={17} />Админ</button>
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
        <div className="routing"><span><ShieldCheck size={16} />Разберём смысл и тему обращения</span><span><MessageCircle size={15} />Неясные сообщения — на уточнение</span></div>
        {receipt && <div className="receipt" role="status">
          <div className={`notice ${receipt.status === "trash" ? "neutral" : ""}`}><Check size={18} />{receipt.status === "pending" ? "Отправлено админу на проверку" : receipt.status === "accepted" ? "Сообщение принято" : "Сообщение отправлено в корзину"}</div>
          {receipt.originalText && receipt.originalText.trim() !== receipt.text && <div className="correction"><span className="correction-label">Как понято сообщение</span><p>{receipt.text}</p><details><summary>Исходный текст</summary><p>{receipt.originalText}</p></details></div>}
          {receipt.processing && <a className="processing-link" href={`/logic?message=${receipt.id}`}><GitBranch size={16} />Этапы обработки</a>}
          {receipt.processing?.box && <p>Категория: {BOX_LABELS[receipt.processing.box]}</p>}
          {receipt.processing?.ai?.source === "fallback" && <p>{receipt.processing.ai.note}</p>}
        </div>}
      </> : <>
        <nav className="filters" aria-label="Категория сообщений">
          <button aria-pressed={boxFilter === "all"} onClick={() => setBoxFilter("all")}>Все<span>{rows.length}</span></button>
          {(Object.keys(BOX_LABELS) as Box[]).map(box => <button key={box} aria-pressed={boxFilter === box} onClick={() => setBoxFilter(box)}>{BOX_LABELS[box]}<span>{rows.filter(row => row.processing?.box === box).length}</span></button>)}
        </nav>
        <nav className="filters" aria-label="Статус сообщений">{(["pending", "accepted", "trash"] as Status[]).map(status => <button key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}>{labels[status]}<span>{boxRows.filter(row => row.status === status).length}</span></button>)}</nav>
        <section className="messages" aria-label={labels[filter]} aria-busy={loading}>
          {loading ? <div className="empty">Загрузка…</div> : visibleRows.length === 0 ? <div className="empty"><span className="empty-icon">{filter === "trash" ? <Trash2 size={28} /> : <Inbox size={30} />}</span><p>{filter === "pending" ? "Нет сообщений на проверке" : filter === "trash" ? "Корзина пуста" : "Пока нет принятых сообщений"}</p></div> : visibleRows.map(row => <article className="message" key={row.id}>
            <div className="message-meta"><span><UserRound size={14} />Пользователь</span><time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></div>
            <p>{row.text}</p>
            {row.processing?.box && <p className="correction-label">{BOX_LABELS[row.processing.box]}{row.processing.ai?.result.needs_human ? " · Нужна ручная проверка" : ""}</p>}
            {row.originalText && row.originalText.trim() !== row.text && <details className="message-original"><summary>Исходный текст</summary><p>{row.originalText}</p></details>}
            {row.processing && <a className="processing-link" href={`/logic?message=${row.id}`}><GitBranch size={16} />Этапы обработки</a>}
            {row.status === "pending" && <div className="actions"><button className="primary" disabled={!!busy} onClick={() => review(row.id, "accepted")}><Check size={16} />Принять</button><button className="secondary" disabled={!!busy} onClick={() => review(row.id, "trash")}><Trash2 size={15} />В корзину</button></div>}
          </article>)}
        </section>
      </>}
      {error && <div className="notice error" role="alert">{error}</div>}
    </main>
  </div>;
}
