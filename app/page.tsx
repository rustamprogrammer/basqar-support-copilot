"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, GitBranch, Inbox, ScanText, ShieldAlert, Trash2, Undo2, UserRound } from "lucide-react";
import { SiteNav } from '@/components/site-nav';
import type { Message, MessageRoute, Status } from "@/lib/message-types";
import { messageRoute, routeLabels } from "@/lib/message-routes";
import { FeedbackForm } from "@/components/feedback-form";
import { ClarificationForm } from "@/components/clarification-form";
import { SupportCard } from '@/components/support-card';
import { effectiveState, latestCases } from '@/lib/support-state';
import { postMessage } from '@/lib/message-client';

const labels: Record<Status, string> = { pending: "На проверке", accepted: "Принято", trash: "В корзине", violation: "Отмечено нарушение" };
type MessageFilter = MessageRoute | "all" | "undetermined";
const filterLabels: Record<MessageFilter, string> = { ...routeLabels, all: "Все", undetermined: "Не определено" };
type InboxResult = { items: Message[]; counts: Record<MessageFilter, number>; total: number; allCount: number; page: number; pageSize: number; pageCount: number };
const emptyCounts: Record<MessageFilter, number> = { all: 0, question: 0, help: 0, undetermined: 0, violation: 0, trash: 0 };
const examples = [
  { label: 'Вопрос', text: 'Что такое ДМ?' },
  { label: 'Срочная помощь', text: 'Меня сейчас бьют у банка, помогите, ID 321' },
  { label: 'Казахский', text: 'Көмектесіңіз, мен көлікке кіре алмаймын' },
  { label: 'Узбекский', text: 'Yordam bering, akkauntga kira olmayapman' },
  { label: 'Украинский', text: 'Допоможіть, я застряг під картою' },
];

async function api<T = Message[]>(method = "GET", body?: object): Promise<T> {
  const response = method === 'POST' && body ? await postMessage(body) : await fetch(method === 'GET' ? '/api/messages?scope=admin' : '/api/messages', { method, cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || result === null) throw new Error(result?.error || "Сервер временно недоступен. Попробуйте ещё раз.");
  return result;
}

export default function Home() {
  const [role, setRole] = useState<"user" | "admin">("user");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Message[]>([]);
  const [filter, setFilter] = useState<MessageFilter>("all");
  const [workflow, setWorkflow] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [loginOpen, setLoginOpen] = useState(false);
  const [publicDemo, setPublicDemo] = useState(false);
  const [password, setPassword] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [inbox, setInbox] = useState<Omit<InboxResult, 'items'>>({ counts: emptyCounts, total: 0, allCount: 0, page: 1, pageSize: 20, pageCount: 1 });
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Message | null>(null);
  const [loadingFlag, setLoading] = useState(false);
  const [loadedQuery, setLoadedQuery] = useState('');
  const [failedQuery, setFailedQuery] = useState('');
  const [settledLoadKey, setSettledLoadKey] = useState('');
  const [clearIds, setClearIds] = useState<string[] | null>(null);
  const [clearError, setClearError] = useState("");
  const [deletedCount, setDeletedCount] = useState<number | null>(null);
  const draftId = useRef<string | null>(null);
  const clearDialog = useRef<HTMLDialogElement>(null);
  const clearing = useRef(false);
  const rowsEpoch = useRef(0);
  const actionLock = useRef(false);
  const listUrl = `/api/inbox?${new URLSearchParams({ category: filter, workflow, urgency: urgencyFilter, q: search, page: String(page), pageSize: '20' })}`;
  const loadKey = `${listUrl}&refresh=${refreshKey}`;
  const hasFreshList = loadedQuery === listUrl;
  const loading = role === 'admin' && (loadingFlag || (!hasFreshList && failedQuery !== listUrl));
  const refreshing = role === 'admin' && settledLoadKey !== loadKey;
  const receiptId = receipt?.id;

  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const id = localStorage.getItem('basqar-last-message');
    if (id) fetch(`/api/messages?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).then(r => r.json()).then(items => { if (Array.isArray(items) && items[0]) setReceipt(items[0]); }).catch(() => {});
  }, []);
  useEffect(() => { if (receiptId) localStorage.setItem('basqar-last-message', receiptId); }, [receiptId]);
  useEffect(() => {
    if (role !== 'user' || !receiptId) return;
    let active = true;
    const timer = setInterval(() => { fetch(`/api/messages?id=${encodeURIComponent(receiptId)}`, { cache: 'no-store' }).then(r => r.json()).then(items => { if (active && Array.isArray(items) && items[0]) setReceipt(current => current?.id === items[0].id ? items[0] : current); }).catch(() => {}); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [role, receiptId]);

  const enterAdmin = useCallback(async () => {
    if (role === 'admin' || actionLock.current) return;
    actionLock.current = true;
    setError('');
    try {
      const result = await fetch('/api/admin', { cache: 'no-store' }).then(r => r.json()) as { authenticated?: boolean; publicDemo?: boolean };
      setPublicDemo(result.publicDemo === true);
      if (result.authenticated) { setRole('admin'); setLoading(true); setLoginOpen(false); window.history.replaceState(null, '', '/?view=inbox'); }
      else setLoginOpen(true);
    } catch { setError('Не удалось проверить вход.'); }
    finally { actionLock.current = false; }
  }, [role]);
  useEffect(() => {
    const timer = setTimeout(() => { if (new URLSearchParams(window.location.search).get('view') === 'inbox') void enterAdmin(); }, 0);
    return () => clearTimeout(timer);
  }, [enterAdmin]);
  async function login(event: FormEvent) {
    event.preventDefault(); if (actionLock.current) return; actionLock.current = true; setBusy('login'); setError('');
    try {
      const response = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error);
      setPassword(''); setLoginOpen(false); setRole('admin'); setLoading(true); window.history.replaceState(null, '', '/?view=inbox');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось войти.'); }
    finally { actionLock.current = false; setBusy(null); }
  }
  async function logout() {
    if (actionLock.current) return;
    actionLock.current = true; setBusy('logout'); setError('');
    try {
      const result = await fetch('/api/admin', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!result.ok) throw new Error('Не удалось выйти. Повторите попытку.');
      setRows([]); setRole('user'); setLoginOpen(false); window.history.replaceState(null, '', '/');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Нет связи с сервером.'); }
    finally { actionLock.current = false; setBusy(null); }
  }

  useEffect(() => {
    if (clearIds) clearDialog.current?.showModal();
    else clearDialog.current?.close();
  }, [clearIds]);

  useEffect(() => {
    if (role !== "admin") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      const epoch = rowsEpoch.current;
      try { if (!clearing.current && document.visibilityState !== "hidden") {
        const response = await fetch(listUrl, { cache: 'no-store', signal: controller.signal });
        const data = await response.json() as InboxResult & { error?: string };
        if (!response.ok || !Array.isArray(data.items)) throw new Error(data.error || 'Не удалось загрузить обращения.');
        if (active && !clearing.current && epoch === rowsEpoch.current) { const { items, ...summary } = data; setRows(items); setInbox(summary); setLoadedQuery(listUrl); setFailedQuery(''); setUpdatedAt(Date.now()); setError(''); }
      } }
      catch (e) { if (active && !clearing.current && epoch === rowsEpoch.current) { setFailedQuery(listUrl); setError(e instanceof Error ? e.message : "Ошибка соединения."); } }
      finally { if (active) { setLoading(false); setSettledLoadKey(loadKey); timer = setTimeout(refresh, 10000); } }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [role, listUrl, loadKey]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy || actionLock.current) return;
    actionLock.current = true;
    setBusy("send"); setError(""); setReceipt(null);
    draftId.current ??= crypto.randomUUID();
    try {
      const saved = await api<Message>("POST", { text, id: draftId.current });
      setReceipt(saved); setText(""); draftId.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка соединения."); }
    finally { actionLock.current = false; setBusy(null); }
  }

  async function review(id: string, status: Status) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(id); setError("");
    try {
      const saved = await api<Message>("PATCH", { id, status, revision: rows.find(row => row.id === id)?.service?.revision ?? 0 });
      setRows(current => current.map(row => row.id === id ? saved : row));
      setRefreshKey(value => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка соединения."); }
    finally { actionLock.current = false; setBusy(null); }
  }

  async function prepareClear() {
    if (busy) return;
    clearing.current = true; rowsEpoch.current += 1;
    setBusy("clear-prepare"); setError(""); setClearError(""); setDeletedCount(null);
    try {
      const response = await fetch('/api/messages?scope=admin&idsOnly=true', { cache: 'no-store' });
      const data = await response.json() as { ids?: string[]; error?: string };
      if (!response.ok || !Array.isArray(data.ids)) throw new Error(data.error || 'Не удалось получить список сообщений.');
      if (data.ids.length) setClearIds(data.ids);
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
      localStorage.removeItem('basqar-last-message'); setRefreshKey(value => value + 1);
      clearing.current = false; rowsEpoch.current += 1;
    } catch (e) { setClearError(e instanceof Error ? e.message : "Ошибка соединения."); }
    finally { setBusy(null); }
  }

  // A restored terminal child can briefly coexist with its old parent before
  // the next inbox response. Keep one active card and its draft per case.
  const visible = hasFreshList ? latestCases(rows) : [];
  const paginated = { items: visible, page: hasFreshList ? inbox.page : 1, pageCount: hasFreshList ? inbox.pageCount : 1 };
  function resetFilters() { setFilter('all'); setWorkflow('all'); setUrgencyFilter('all'); setQuery(''); setSearch(''); setPage(1); }

  return <div className="shell">
    <SiteNav active={role === 'admin' ? 'inbox' : 'test'} busy={!!busy} onSectionChange={view => { if (view === 'inbox') void enterAdmin(); else { setRole('user'); setLoginOpen(false); setError(''); window.history.replaceState(null, '', '/'); } }} />
    <main id="main-content" className={`workbench-main ${role === 'admin' ? 'workbench-admin' : ''}`}>
      {loginOpen && <form className="admin-login feedback-form" onSubmit={login}><label htmlFor="admin-password">Пароль администратора<input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label><div className="actions"><button className="primary" disabled={!!busy}>Войти</button><button type="button" className="secondary" onClick={() => { setLoginOpen(false); setPassword(''); }}>Отмена</button></div><p>Пароль находится на ноутбуке в файле .sites-runtime/admin-password.txt.</p></form>}
      <div className="heading page-heading"><div><h1>{role === "user" ? "Проверка сообщения" : "Обращения"}</h1><p>{role === 'user' ? 'Проверьте, как система поймёт текст игрока.' : 'Разбирайте запросы, отвечайте игрокам и уточняйте разметку.'}</p></div>{role === 'user' && <a className="secondary" href="/quality#live-check">Проверить список<ArrowRight size={16} /></a>}</div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {role === "user" ? <div className="test-workspace">
        <section className="test-input-panel" aria-labelledby="input-heading">
          <div className="panel-heading"><h2 id="input-heading">Текст игрока</h2><label className="example-picker"><span className="sr-only">Пример сообщения</span><select value="" disabled={!!busy} onChange={event => { const example = examples.find(item => item.label === event.target.value); if (!example) return; setText(example.text); setReceipt(null); setError(''); draftId.current = null; document.getElementById('message')?.focus(); }}><option value="" disabled>Выбрать пример</option>{examples.map(example => <option key={example.label} value={example.label}>{example.label}</option>)}</select></label></div>
          <form className="composer" onSubmit={send}>
            <label className="sr-only" htmlFor="message">Ваше сообщение</label>
            <textarea id="message" placeholder="Например: што такое дмить?" value={text} maxLength={2000} disabled={busy === "send"} onChange={e => { setText(e.target.value); setReceipt(null); draftId.current = null; }} required />
            <div className="composer-footer"><span className="counter">{text.length} / 2000</span><div className="actions">{(text || receipt) && <button type="button" className="text-button" disabled={!!busy} onClick={() => { setText(''); setReceipt(null); setError(''); draftId.current = null; localStorage.removeItem('basqar-last-message'); document.getElementById('message')?.focus(); }}>Очистить</button>}<button className="primary" disabled={!text.trim() || !!busy}>{busy === "send" ? "Обработка…" : "Проверить"}<ArrowRight size={17} /></button></div></div>
          </form>
          <p className="input-note">Сообщение сохранится в обращениях.</p>
        </section>
        <section className={`result-panel ${receipt ? 'has-result' : ''}`} aria-label="Результат проверки">
          <div className="panel-heading"><h2>Результат</h2>{receipt && <span className="result-ready"><Check size={14} />Готово</span>}</div>
          {!receipt && <div className="result-placeholder"><ScanText size={32} strokeWidth={1.5} /><strong>{busy === 'send' ? 'Проверяем сообщение…' : 'Здесь появится результат'}</strong><p>Категория, исправленный текст и ответ системы.</p></div>}
          {receipt && <div className="receipt">
          <div className="workbench-verdict" data-route={messageRoute(receipt) ?? 'undetermined'}><span>Категория</span><strong>{messageRoute(receipt) ? routeLabels[messageRoute(receipt)!] : 'Не определено'}</strong></div>
          <p role="status" className="result-status">{receipt.status === "violation" ? "Отправлено в нарушения" : effectiveState(receipt) === 'answered' ? 'Готовый ответ отправлен игроку' : effectiveState(receipt) === 'resolved' ? 'Обращение решено' : receipt.status === "pending" ? receipt.processing?.needsClarification || receipt.processing?.followUp ? "Передано админу · нужно уточнение" : "Передано администратору" : "Отправлено в корзину"}</p>
          <SupportCard message={receipt} onSave={(saved, notice) => { setReceipt(saved); setError(notice ?? ''); }} />
          {receipt.originalText && receipt.originalText.trim() !== receipt.text && <div className="correction"><span className="correction-label">Исправлено</span><p>{receipt.text}</p><details><summary>Исходный текст</summary><p>{receipt.originalText}</p></details></div>}
          {receipt.processing && <a className="processing-link" href={`/logic?message=${receipt.id}`}><GitBranch size={16} />Этапы обработки</a>}
          {receipt.processing?.context && <a className="processing-link" href={`/logic?message=${encodeURIComponent(receipt.processing.context.parentId)}`}>Исходное обращение</a>}
          <ClarificationForm key={receipt.id} message={receipt} onSave={(saved, notice) => { setReceipt(saved); setError(notice ?? ''); }} />
        </div>}
        </section>
      </div> : <>
        <nav className="filters" aria-label="Категория сообщений">{(["all", "question", "help", "undetermined", "violation", "trash"] as const).map(route => <button key={route} className={route === "violation" ? "violation-filter" : undefined} aria-pressed={filter === route} onClick={() => { setFilter(route); setPage(1); if (route === "violation" || route === "trash") setWorkflow("all"); }}>{filterLabels[route]}<span>{hasFreshList ? inbox.counts[route] : '—'}</span></button>)}</nav>
        <div className="admin-toolbar">
          <label className="workflow-filter workbench-search">Поиск<input value={query} maxLength={200} placeholder="Текст обращения…" onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
          <label className="workflow-filter">Статус<select value={workflow} onChange={event => { setWorkflow(event.target.value); setPage(1); }}><option value="all">Любой</option><option value="pending">Ожидают помощи</option><option value="answered">Отвечено</option><option value="accepted">Решено</option></select></label>
          {filter === 'help' && <label className="workflow-filter">Срочность<select value={urgencyFilter} onChange={event => { setUrgencyFilter(event.target.value); setPage(1); }}><option value="all">Любая</option><option value="now">Сейчас</option><option value="high">Высокий</option><option value="normal">Обычный</option></select></label>}
        </div>
        <div className="workbench-list-tools"><span role="status">Найдено: {hasFreshList ? inbox.total.toLocaleString('ru-RU') : '—'}{hasFreshList && updatedAt ? ` · обновлено ${new Date(updatedAt).toLocaleTimeString('ru-RU')}` : ''}</span><div className="actions"><button className="secondary" disabled={loading || refreshing || !!busy} onClick={() => setRefreshKey(value => value + 1)}>{loading || refreshing ? 'Загрузка…' : 'Обновить'}</button>{(filter !== 'all' || workflow !== 'all' || urgencyFilter !== 'all' || query) && <button className="text-button" disabled={!!busy} onClick={resetFilters}>Сбросить фильтры</button>}</div></div>
        {deletedCount !== null && <div className="notice clear-result" role="status">Удалено сообщений: {deletedCount}.</div>}
        {!loading && paginated.pageCount > 1 && <nav className="message-pagination" aria-label="Страницы сообщений">
          <button className="secondary" disabled={paginated.page === 1} onClick={() => setPage(paginated.page - 1)}>Назад</button>
          <span aria-live="polite">Страница {paginated.page} из {paginated.pageCount}</span>
          <button className="secondary" disabled={paginated.page === paginated.pageCount} onClick={() => setPage(paginated.page + 1)}>Вперёд</button>
        </nav>}
        <section className="messages" aria-label={filter === "all" ? "Все сообщения" : filterLabels[filter]} aria-busy={loading}>
          {loading ? <div className="empty">Загрузка…</div> : visible.length === 0 ? <div className="empty"><span className="empty-icon">{filter === "violation" ? <ShieldAlert size={28} /> : filter === "trash" ? <Trash2 size={28} /> : <Inbox size={30} />}</span><p>Нет сообщений с выбранными фильтрами</p><button className="secondary" onClick={resetFilters}>Показать все</button></div> : paginated.items.map(row => <article className={`message ${messageRoute(row) === "violation" ? "message-violation" : ""}`} key={row.status === 'trash' || row.status === 'violation' ? `terminal:${row.id}` : `case:${row.service?.caseId ?? row.id}`}>
            <div className="message-meta"><span><UserRound size={14} />Пользователь</span><time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></div>
            <div className="message-tags"><span>{messageRoute(row) ? routeLabels[messageRoute(row)!] : "Категория не определена"}</span>{(!row.service || row.status === 'trash' || row.status === 'violation') && <span>{labels[row.status]}</span>}{row.processing?.needsClarification && <span>Нужно уточнение</span>}</div>
            <p>{row.text}</p>
            <SupportCard message={row} admin onSave={(saved, notice) => { setRows(current => current.map(item => item.id === row.id ? saved : item)); setRefreshKey(value => value + 1); if (notice) setError(notice); else if (saved.id !== row.id) setError('Появилось уточнение. Данные обновлены; повторите действие.'); }} />
            {(row.status === "pending" || row.status === "violation") && row.processing?.needsClarification && row.processing.followUp && <p className="quality-note">Уточнить: {row.processing.followUp}</p>}
            {row.status === "violation" && <p className="violation-reason">{row.processing?.classification === "violation" ? row.processing.steps.find(step => step.id === "classified")?.detail : "Отмечено администратором."}</p>}
            <details className="message-analysis"><summary>Анализ и разметка</summary>
            {row.originalText && row.originalText.trim() !== row.text && <details className="message-original"><summary>Исходный текст</summary><p>{row.originalText}</p></details>}
            {row.processing && <a className="processing-link" href={`/logic?message=${row.id}`}><GitBranch size={16} />Этапы обработки</a>}
            {row.processing?.context && <a className="processing-link" href={`/logic?message=${encodeURIComponent(row.processing.context.parentId)}`}>Исходное обращение</a>}
            <FeedbackForm key={row.id} message={row} onSave={feedback => setRows(current => current.map(item => item.id === row.id ? { ...item, feedback } : item))} />
            </details>
            <div className="message-footer">
              {row.status === "pending" && <button className="secondary" disabled={!!busy} onClick={() => review(row.id, "accepted")}><Check size={16} />Завершить обращение</button>}
              <details className="message-menu"><summary>Изменить категорию</summary><div className="actions">
              {row.status !== "trash" && <button className="secondary" disabled={!!busy} onClick={() => review(row.id, "trash")}><Trash2 size={15} />В корзину</button>}
              {row.status !== "violation" && <button className="secondary violation-action" disabled={!!busy} onClick={() => review(row.id, "violation")}><ShieldAlert size={15} />В нарушения</button>}
              {row.status !== "pending" && <button className="secondary" disabled={!!busy} onClick={() => review(row.id, "pending")}><Undo2 size={15} />Вернуть на проверку</button>}
              </div></details>
            </div>
          </article>)}
        </section>
        {paginated.pageCount > 1 && <nav className="message-pagination" aria-label="Перелистывание сообщений"><button className="secondary" disabled={loading || paginated.page <= 1} onClick={() => setPage(paginated.page - 1)}>Назад</button><span>{paginated.page} / {paginated.pageCount}</span><button className="secondary" disabled={loading || paginated.page >= paginated.pageCount} onClick={() => setPage(paginated.page + 1)}>Вперёд</button></nav>}
        <details className="workbench-data-tools"><summary>Управление тестовыми данными</summary><button className="secondary violation-action" disabled={loading || !!busy || inbox.allCount === 0} onClick={prepareClear}><Trash2 size={15} />{busy === "clear-prepare" ? "Загрузка…" : `Очистить все сообщения (${inbox.allCount})`}</button></details>
        {!publicDemo && <button className="text-button" disabled={!!busy} onClick={logout}>{busy === 'logout' ? 'Выход…' : 'Выйти из админ-панели'}</button>}
      </>}
      <dialog ref={clearDialog} className="clear-dialog" aria-labelledby="clear-title" aria-describedby="clear-description" onCancel={event => { event.preventDefault(); cancelClear(); }}>
        <h2 id="clear-title">Очистить сообщения</h2>
        <p id="clear-description">Удалить все текущие сообщения ({clearIds?.length ?? 0}), ответы и разметку? Отменить удаление нельзя.</p>
        {clearError && <div className="notice error" role="alert">{clearError}</div>}
        <div className="actions"><button className="secondary" autoFocus disabled={busy === "clear"} onClick={cancelClear}>Отмена</button><button className="primary clear-confirm" disabled={!!busy} onClick={clearMessages}>{busy === "clear" ? "Удаление…" : "Удалить"}</button></div>
      </dialog>
    </main>
  </div>;
}
