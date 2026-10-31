"use client";

import { useEffect, useState } from "react";
import Link from "@/components/site-link";
import { ArrowLeft, GitBranch, MessageCircle } from "lucide-react";
import { ProcessingTimeline } from "@/components/processing-timeline";
import type { Message } from "@/lib/message-types";

export default function LogicPage() {
  const [rows, setRows] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('message') || '');
  const [selectedRow, setSelected] = useState<Message | undefined>();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadedListKey, setLoadedListKey] = useState<string | null>(null);
  const [failedListKey, setFailedListKey] = useState<string | null>(null);
  const [loadedMessageKey, setLoadedMessageKey] = useState('');
  const [failedMessageKey, setFailedMessageKey] = useState('');
  const [error, setError] = useState("");

  const listLoading = search !== loadedListKey && search !== failedListKey;
  const selectorRows = search === loadedListKey ? rows : [];
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const params = new URLSearchParams({ view: 'selector', limit: '100', q: search });
        const response = await fetch(`/api/messages?${params}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Не удалось загрузить список обращений.");
        const messages = await response.json() as Message[];
        if (active) { setRows(messages); setLoadedListKey(search); setFailedListKey(null); setError(''); }
      } catch (e) { if (active) { setFailedListKey(search); setError(e instanceof Error ? e.message : "Ошибка соединения."); } }
    };
    void load();
    return () => { active = false; controller.abort(); };
  }, [search, refreshKey]);

  const activeId = selectedId || selectorRows[0]?.id;
  const loading = !!activeId && loadedMessageKey !== activeId && failedMessageKey !== activeId;
  const selected = selectedRow?.id === activeId ? selectedRow : undefined;
  useEffect(() => {
    if (!activeId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        if (document.visibilityState !== 'hidden') {
          const response = await fetch(`/api/messages?id=${encodeURIComponent(activeId!)}`, { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('Не удалось загрузить этапы. Нажмите «Обновить».');
          const data = await response.json() as Message[];
          if (active) { setSelected(data[0]); setLoadedMessageKey(activeId!); setFailedMessageKey(''); setError(''); }
        }
      } catch (cause) { if (active) { setFailedMessageKey(activeId!); setError(cause instanceof Error ? cause.message : 'Нет связи с сервером.'); } }
      finally { if (active) timer = setTimeout(refresh, 8000); }
    }
    void refresh();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [activeId, refreshKey]);

  function chooseMessage(id: string) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('message', id); else url.searchParams.delete('message');
    window.history.replaceState(null, '', url);
  }

  const clarifications = selected ? rows.filter(message => message.processing?.context?.parentId === selected.id) : [];
  return <div className="shell">
    <header className="header">
      <Link className="brand" href="/" aria-label="На связи — главная"><span className="brand-icon"><MessageCircle size={21} /></span>На связи<span className="brand-dot">.</span></Link>
      <div className="header-actions"><a className="nav-link" href="/quality">Статистика и тесты</a><Link className="nav-link" href="/"><ArrowLeft size={16} />К сообщениям</Link></div>
    </header>
    <main className="logic-main">
      <div className="heading"><span className="section-icon"><GitBranch size={25} /></span><h1>Как принято решение</h1></div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="workbench-list-tools"><label className="workflow-filter workbench-search">Найти обращение<input value={query} maxLength={200} placeholder="Слова из сообщения…" onChange={event => { setQuery(event.target.value); chooseMessage(''); }} /></label><button className="secondary" disabled={loading || listLoading} onClick={() => setRefreshKey(value => value + 1)}>Обновить</button>{query && <button className="secondary" onClick={() => { setQuery(''); setSearch(''); chooseMessage(''); }}>Сбросить поиск</button>}</div>
      {(selectorRows.length > 0 || selected) && <div className="logic-selector"><label htmlFor="logic-message">Обращение · последние {selectorRows.length}</label><select id="logic-message" value={selectedId} onChange={e => chooseMessage(e.target.value)}>
        <option value="">Последнее обращение</option>
        {selectedId && selected?.id === selectedId && !rows.some(row => row.id === selectedId) && <option value={selectedId}>{(selected.originalText || selected.text).slice(0, 72)}</option>}
        {selectorRows.map(message => <option key={message.id} value={message.id}>{new Date(message.createdAt).toLocaleString("ru-RU")} — {(message.originalText || message.text).replace(/\s+/g, " ").slice(0, 72)}</option>)}
      </select></div>}
      <section aria-label="Обработка обращения" aria-busy={loading} aria-live="polite">
        {loading || listLoading ? <div className="empty">Загрузка…</div> : selected ? <>
          <div className="workbench-mode"><span>{selected.processing?.version?.startsWith('rules-assistance-') ? 'Алгоритмы · текущая версия' : 'Сохранённая историческая обработка'}</span><Link href="/">К проверке сообщений</Link></div>
          <details className="quality-note"><summary>Как выбирается категория</summary>
            {selected.processing?.version?.startsWith('rules-assistance-') ? <>
              <p>Правила определяют цель обращения. В помощи оцениваются текущее событие, возможность вмешательства и срочность. Неясные детали уточняются параллельно с передачей администратору.</p>
              <p>Для вопросов проверяется база утверждённых ответов. Если подходящего ответа нет или нужна помощь в конкретной ситуации, обращение остаётся у администратора. Эта версия не вызывает ИИ.</p>
            </> : selected.processing?.aiReview ? <>
              <p>Алгоритм предлагает исправленный текст, категорию и уточнение. ИИ получает исходное сообщение и этот результат: подтверждает его или возвращает собственный полный вариант. При проверке смысл определяется по исходнику.</p>
              <p>Исходник, результат алгоритма и итог сохраняются. Если ИИ отключён, недоступен или достигнут лимит, остаётся результат алгоритма с отметкой, что ИИ его не проверил. Правила автоматически не меняются.</p>
            </> : <p>Сохранён результат прежней обработки по правилам и словарям. Исторические записи повторно не обрабатываются и не проходят проверку ИИ.</p>}
            <p>«Вопрос» — просьба объяснить или дать инструкцию. «Помощь» — конкретная проблема, жалоба, апелляция или действие администратора. Если вместе со справочным вопросом нужна помощь, выбирается «Помощь».</p>
            <p>«Нарушение» относится к собственному обращению автора. Мат в жалобе или пересказ чужих слов сам по себе не доказывает нарушение. Бессмысленные сообщения попадают в корзину.</p>
            <p>Уточнение связано с исходным сообщением. Готовый ответ можно отметить как полезный или передать вопрос администратору. Выданный ответ, его источник и версия сохраняются в истории.</p>
          </details>
          <ProcessingTimeline message={selected} />{clarifications.length > 0 && <nav aria-label="Уточнения к обращению">{clarifications.map(message => <div key={message.id}><a className="processing-link" href={`/logic?message=${encodeURIComponent(message.id)}`}>Уточнение от {new Date(message.createdAt).toLocaleString("ru-RU")}</a></div>)}</nav>}
        </> : !error && <div className="empty"><p>{selectedId ? "Обращение не найдено или недоступно в этой сессии" : query ? 'По запросу ничего не найдено' : "Пока нет доступных обращений"}</p><Link className="secondary" href="/">Отправить пример или войти как администратор</Link></div>}
      </section>
    </main>
  </div>;
}
