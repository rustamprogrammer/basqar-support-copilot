"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "@/components/site-link";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { KnowledgeEntry } from "@/lib/knowledge-base";
import type { Message } from "@/lib/message-types";

type Editor = { entry: KnowledgeEntry; aliases: string; required: string; excluded: string; confirmed: boolean; expectedVersion: string | null };
const statuses = { published: "Опубликовано", draft: "Черновик", retired: "В архиве" };
const lines = (text: string) => [...new Set(text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean))];
const edit = (entry: KnowledgeEntry, expectedVersion: string | null = entry.version): Editor => ({ entry: { ...entry, source: { ...entry.source } }, aliases: entry.aliases.join("\n"), required: entry.requiredTerms?.join("\n") ?? "", excluded: entry.excludedTerms?.join("\n") ?? "", confirmed: false, expectedVersion });
const blank = (): KnowledgeEntry => ({ id: `faq-${crypto.randomUUID()}`, version: "draft", title: "", answer: "", aliases: [], requiredTerms: [], excludedTerms: [], status: "draft", source: { title: "", version: "" } });
const contents = (editor: Editor) => JSON.stringify([editor.entry, editor.aliases, editor.required, editor.excluded]);

export default function KnowledgePage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [baseline, setBaseline] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadedMessage = useRef<string | null>(null);
  const requestPending = useRef(false);
  const loadPending = useRef(false);
  const dirty = !!editor && contents(editor) !== baseline;

  function openEditor(next: Editor, protectChanges = false) {
    if (protectChanges && dirty && !window.confirm("Изменения не сохранены. Открыть другую карточку и потерять их?")) return false;
    setEditor(next); setBaseline(contents(next)); return true;
  }

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const load = useCallback(async (preserveEditor = false) => {
    if (loadPending.current) return;
    loadPending.current = true; setRefreshing(true);
    try {
      const auth = await fetch("/api/admin", { cache: "no-store" });
      const authData = await auth.json().catch(() => null) as { authenticated?: boolean; configured?: boolean } | null;
      if (!auth.ok || !authData) throw new Error("Не удалось проверить доступ. Повторите загрузку.");
      setAuthenticated(!!authData.authenticated); setConfigured(!!authData.configured);
      if (!authData.authenticated) return;
      const response = await fetch("/api/knowledge", { cache: "no-store" });
      const data = await response.json().catch(() => null) as (KnowledgeEntry[] & { error?: string }) | null;
      if (!response.ok || !Array.isArray(data)) { if (response.status === 401) setAuthenticated(false); throw new Error(data?.error || "Не удалось загрузить базу ответов."); }
      setEntries(data);
      const messageId = new URLSearchParams(window.location.search).get("message");
      if (!preserveEditor && messageId && loadedMessage.current !== messageId) {
        const result = await fetch(`/api/messages?id=${encodeURIComponent(messageId)}`, { cache: "no-store" });
        const rows = await result.json().catch(() => null) as Message[] | null;
        const row = result.ok && Array.isArray(rows) ? rows.find(item => item.id === messageId) : undefined;
        if (!row?.service?.reply || row.service.reply.author !== "admin") { setNotice("Для черновика нужен ответ администратора в исходном обращении."); return; }
        const draft = blank(); draft.title = "Новый ответ"; draft.answer = row.service.reply.text; draft.aliases = [row.originalText ?? row.text];
        const next = edit(draft, null); setEditor(next); setBaseline(contents(next)); loadedMessage.current = messageId;
        setNotice("Черновик из обращения. Уберите личные детали и проверьте, подходит ли ответ другим игрокам.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Нет связи с сервером."); }
    finally { loadPending.current = false; setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => {
    const start = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(start);
  }, [load]);

  async function login(event: FormEvent) {
    event.preventDefault(); if (requestPending.current) return; requestPending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Не удалось войти.");
      setPassword(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Нет связи с сервером."); }
    finally { requestPending.current = false; setBusy(false); }
  }
  function field<K extends keyof KnowledgeEntry>(key: K, value: KnowledgeEntry[K]) { setEditor(previous => previous ? { ...previous, entry: { ...previous.entry, [key]: value }, confirmed: false } : previous); }
  function source(key: "title" | "ref" | "version", value: string) { if (editor) field("source", { ...editor.entry.source, [key]: value }); }

  async function save(event: FormEvent) {
    event.preventDefault(); if (!editor || requestPending.current) return; setError(""); setNotice("");
    const entry: KnowledgeEntry = { ...editor.entry, aliases: lines(editor.aliases), requiredTerms: lines(editor.required), excludedTerms: lines(editor.excluded), source: { title: editor.entry.source.title, version: editor.entry.source.version, ...(editor.entry.source.ref?.trim() ? { ref: editor.entry.source.ref.trim() } : {}) } };
    if (!entry.title.trim() || !entry.answer.trim()) { setError("Заполните название и текст ответа."); return; }
    for (const [name, values] of [["Варианты вопроса", entry.aliases], ["Обязательные фразы", entry.requiredTerms ?? []], ["Исключающие фразы", entry.excludedTerms ?? []]] as const) {
      if (values.length > 80 || values.some(value => value.length > 300)) { setError(`${name}: максимум 80 строк, до 300 символов в каждой.`); return; }
    }
    if (!entry.aliases.length) { setError("Добавьте хотя бы один вариант вопроса."); return; }
    if (entry.status === "published" && (!entry.source.title.trim() || !entry.source.version.trim() || !editor.confirmed)) { setError("Укажите источник, его версию и подтвердите проверку."); return; }
    requestPending.current = true; setBusy(true);
    try {
      const response = await fetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry, confirmed: editor.confirmed, expectedVersion: editor.expectedVersion }) });
      const data = await response.json().catch(() => null) as (KnowledgeEntry & { error?: string }) | null;
      if (response.status === 409) throw new Error("Карточку уже изменили. Обновите базу и сравните с сохранённой версией. Ваш текст остался в форме.");
      if (!response.ok || !data?.id) { if (response.status === 401) setAuthenticated(false); throw new Error(data?.error || "Не удалось сохранить ответ."); }
      setEntries(previous => [...previous.filter(item => item.id !== data.id), data]); openEditor(edit(data));
      setNotice(data.status === "published" ? "Ответ опубликован." : data.status === "retired" ? "Ответ исключён из автоматической выдачи." : "Черновик сохранён.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Нет связи с сервером."); }
    finally { requestPending.current = false; setBusy(false); }
  }

  const visible = entries.filter(entry => `${entry.title} ${entry.aliases.join(" ")}`.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")));
  const newerEntry = editor ? entries.find(entry => entry.id === editor.entry.id && entry.version !== editor.expectedVersion) : undefined;
  return <div className="shell">
    <header className="header"><Link className="brand" href="/"><span className="brand-icon"><BookOpen size={21} /></span>На связи<span className="brand-dot">.</span></Link><Link className="nav-link" href="/"><ArrowLeft size={16} />К сообщениям</Link></header>
    <main className="logic-main knowledge-main"><h1>База ответов</h1>
      {loading ? <p role="status">Загрузка…</p> : !authenticated ? <div className="feedback-form knowledge-login">
        {configured ? <form onSubmit={login}><label htmlFor="knowledge-password">Пароль администратора<input id="knowledge-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} /></label><button className="primary" disabled={busy || !password}>{busy ? "Вход…" : "Войти"}</button></form> : <p>Пароль администратора не настроен. Перезапустите сайт через start-site.cmd.</p>}
      </div> : <>
        <div className="knowledge-toolbar"><label htmlFor="knowledge-search">Поиск<input id="knowledge-search" value={search} onChange={event => setSearch(event.target.value)} /></label><button type="button" className="secondary" disabled={busy || refreshing} onClick={() => { setError(""); void load(true); }}>{refreshing ? "Обновление…" : "Обновить базу"}</button><button type="button" className="primary" disabled={busy || refreshing} onClick={() => { if (openEditor(edit(blank(), null), true)) { setNotice(""); setError(""); } }}>Новый ответ</button></div>
        <div className="knowledge-layout">
          <nav className="knowledge-list" aria-label="Карточки базы ответов">{visible.map(entry => <button type="button" key={entry.id} aria-pressed={editor?.entry.id === entry.id} disabled={busy} onClick={() => { if (entry.id === editor?.entry.id) return; if (openEditor(edit(entry), true)) { setNotice(""); setError(""); } }}><strong>{entry.title}</strong><span>{statuses[entry.status]}</span></button>)}{!visible.length && <p>Карточки не найдены.</p>}</nav>
          {editor ? <form className="feedback-form knowledge-editor" onSubmit={save}><fieldset disabled={busy}>
            <legend>{entries.some(entry => entry.id === editor.entry.id) ? "Редактирование ответа" : "Новый ответ"}{dirty ? " · не сохранено" : ""}</legend>
            {newerEntry && <details><summary>Сравнить с новой версией</summary><p><strong>{newerEntry.title}</strong> · {statuses[newerEntry.status]}</p><p>{newerEntry.answer}</p><p>Варианты: {newerEntry.aliases.join("; ")}</p>{!!newerEntry.requiredTerms?.length && <p>Обязательные: {newerEntry.requiredTerms.join("; ")}</p>}{!!newerEntry.excludedTerms?.length && <p>Исключения: {newerEntry.excludedTerms.join("; ")}</p>}<p>{newerEntry.source.title} · {newerEntry.source.ref} · {newerEntry.source.version}</p><div className="support-actions"><button type="button" className="secondary" onClick={() => { if (openEditor(edit(newerEntry), true)) { setError(""); setNotice("Открыта сохранённая версия."); } }}>Загрузить эту версию</button><button type="button" className="secondary" onClick={() => { setEditor({ ...editor, expectedVersion: newerEntry.version, confirmed: false }); setError(""); setNotice("Версии сравнены. Проверьте свой вариант и сохраните его."); }}>Сравнил: оставить мои правки</button></div></details>}
            <label>Название<input value={editor.entry.title} onChange={event => field("title", event.target.value)} maxLength={160} required /></label>
            <label>Ответ игроку<textarea value={editor.entry.answer} onChange={event => field("answer", event.target.value)} maxLength={4000} required /></label>
            <label>Варианты вопроса — по строке<textarea value={editor.aliases} onChange={event => setEditor({ ...editor, aliases: event.target.value, confirmed: false })} required /></label>
            <details><summary>Условия применения</summary>
              <label>Обязательные фразы — по одной на строке<textarea value={editor.required} onChange={event => setEditor({ ...editor, required: event.target.value, confirmed: false })} /></label>
              <label>Исключающие фразы — по одной на строке<textarea value={editor.excluded} onChange={event => setEditor({ ...editor, excluded: event.target.value, confirmed: false })} /></label>
            </details>
            <label>Источник<input value={editor.entry.source.title} onChange={event => source("title", event.target.value)} maxLength={300} required={editor.entry.status === "published"} /></label>
            <label>Пункт или ссылка<input value={editor.entry.source.ref ?? ""} onChange={event => source("ref", event.target.value)} maxLength={160} /></label>
            <label>Версия или дата источника<input value={editor.entry.source.version} onChange={event => source("version", event.target.value)} maxLength={100} required={editor.entry.status === "published"} /></label>
            <label>Статус<select value={editor.entry.status} onChange={event => field("status", event.target.value as KnowledgeEntry["status"])}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {editor.entry.status === "published" && <label className="knowledge-confirm"><input type="checkbox" checked={editor.confirmed} onChange={event => setEditor({ ...editor, confirmed: event.target.checked })} required />Источник и ответ проверены; личных данных нет.</label>}
            {notice && <p role="status" className="notice">{notice}</p>}
            {error && <p role="alert" className="notice error">{error}</p>}
            <button className="primary" disabled={busy || !lines(editor.aliases).length || (editor.entry.status === "published" && !editor.confirmed)}>{busy ? "Сохранение…" : editor.entry.status === "published" ? "Опубликовать" : "Сохранить"}</button>
          </fieldset></form> : <p>Выберите карточку или создайте ответ.</p>}
        </div>
      </>}
      {(!editor || !authenticated) && notice && <p role="status" className="notice">{notice}</p>}
      {(!editor || !authenticated) && error && <div><p role="alert" className="notice error">{error}</p>{!authenticated && <button type="button" className="secondary" disabled={busy || refreshing} onClick={() => { setError(""); void load(true); }}>{refreshing ? "Загрузка…" : "Повторить загрузку"}</button>}</div>}
    </main>
  </div>;
}
