"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from '@/components/site-link';
import data from '@/lib/assistance-quality-summary.json';
import type { ProcessingTrace } from '@/lib/message-types';
import styles from './assistance-quality.module.css';

type Count = number | null;
type Aggregate = {
  total: Count; families: Count; correct: Count; errors: Count; accuracyPercent: Count; routeAccuracyPercent: Count;
  urgency: { total: Count; expectedNow: Count; correctNow: Count; missedNow: Count; nowRecallPercent: Count; falseNow: Count; unavailable: Count };
  faq: { total: Count; answerable: Count; answered: Count; correctAnswers: Count; unsafeAnswers: Count; answerPrecisionPercent: Count; answerRecallPercent: Count; needsAdmin: Count };
};
type Category = { total: Count; correct: Count; wrong: Count; accuracy: Count };
type Quality = {
  generatedAt: string;
  assistance: { stage: string; createdAt: string; overall: Aggregate; development: Aggregate | null; holdout: Aggregate | null; languages: (Aggregate & { language: string })[] };
  benchmark: (Category & {
    run: string; createdAt: string;
    diagnostics: { undetermined: Count; falseViolation: Count; falseTrash: Count; missedViolation: Count; helpAsQuestion: Count; questionAsHelp: Count };
    languages: (Category & { language: string })[]; categories: (Category & { route: string })[];
    comparison: { baseline: string; baselineCorrect: Count; improved: Count; regressed: Count; deltaCorrect: Count; deltaPercentagePoints: Count } | null;
    coverage: { urgency: { now: Count; high: Count; normal: Count; not_evaluated: Count }; urgencyUncertain: Count; faqAnswered: Count; faqNeedsAdmin: Count; faqCoverage: Count };
    labels: { scenarios: Count; baseTexts: Count; disputedReferenceRows: Count };
  }) | null;
};
const report = data as Quality;
const names: Record<string, string> = { ru: 'Русский', kk: 'Казахский', uk: 'Украинский', uz: 'Узбекский', question: 'Вопрос', help: 'Помощь', violation: 'Нарушение', trash: 'Корзина', undetermined: 'Не определено' };
const count = (value: Count) => value == null ? '—' : value.toLocaleString('ru-RU');
const percent = (value: Count, fraction = false) => value == null ? '—' : `${(fraction ? value * 100 : value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;

function saveDownload(contents: BlobPart, filename: string, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FeedbackDownload() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function download() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/feedback', { cache: 'no-store' });
      if (response.status === 401) throw new Error('Войдите как администратор на главной странице и повторите скачивание.');
      if (!response.ok) throw new Error('Не удалось скачать разметку. Повторите попытку.');
      const content = await response.text();
      if (!content.trim()) throw new Error('Сохранённой разметки пока нет. Укажите правильный результат в карточке обращения.');
      saveDownload(content, 'feedback.jsonl', 'application/x-ndjson;charset=utf-8');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Нет связи с сервером.'); }
    finally { setBusy(false); }
  }
  return <div className={styles.download}><button type="button" className="secondary" disabled={busy} onClick={() => void download()}>{busy ? 'Скачивание…' : 'Скачать предложенную разметку'}</button>{error && <p role="alert">{error} <Link href="/">К сообщениям</Link></p>}</div>;
}

type LiveResult = { original: string; text: string; processing: ProcessingTrace; index: number };
const routeName = (row: LiveResult) => row.processing.route ?? 'undetermined';
const liveExamples = ['Что такое ДМ?', 'Меня сейчас ДМят у банка, помогите', 'Вчера меня убили, проверьте запись', 'Мені қазір ұрып жатыр, көмектесіңіз', 'Meni hozir uryapti, yordam bering', 'Не можу вийти з машини'];

function LiveQuality() {
  const [input, setInput] = useState(''), [snapshot, setSnapshot] = useState<string[]>([]);
  const [rows, setRows] = useState<LiveResult[]>([]), [version, setVersion] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'stopped' | 'failed'>('idle');
  const [error, setError] = useState(''), [expected, setExpected] = useState<Record<number, string>>({});
  const [resumable, setResumable] = useState(true);
  const [category, setCategory] = useState('all'), [onlyErrors, setOnlyErrors] = useState(false), [page, setPage] = useState(1);
  const controller = useRef<AbortController | null>(null), stopped = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);
  const inputLines = input.split(/\r?\n/u).map(text => text.trim()).filter(Boolean);
  const running = status === 'running';
  const labelled = rows.filter(row => expected[row.index]);
  const matches = labelled.filter(row => expected[row.index] === routeName(row)).length;
  const filtered = useMemo(() => rows.filter(row => (category === 'all' || routeName(row) === category) && (!onlyErrors || (expected[row.index] && expected[row.index] !== routeName(row)))), [rows, category, onlyErrors, expected]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20)), currentPage = Math.min(page, pageCount);

  function edit(value: string) {
    setInput(value); setRows([]); setSnapshot([]); setVersion(''); setStatus('idle'); setError(''); setExpected({}); setResumable(true); setCategory('all'); setOnlyErrors(false); setPage(1);
  }
  async function run(resume = false) {
    if (controller.current) return;
    const texts = [...(resume ? snapshot : inputLines)];
    if (!texts.length || texts.length > 1000) { setError('Введите от 1 до 1000 сообщений, каждое с новой строки.'); return; }
    const tooLong = texts.findIndex(text => text.length > 2000);
    if (tooLong >= 0) { setError(`Сообщение ${tooLong + 1} длиннее 2000 символов. Сократите его.`); return; }
    const abort = new AbortController(); controller.current = abort; stopped.current = false;
    let done = resume ? [...rows] : [], observedVersion = resume ? version : '';
    const firstIndex = resume ? rows.length : 0;
    const batches = Array.from({ length: Math.ceil((texts.length - firstIndex) / 10) }, (_, index) => {
      const offset = firstIndex + index * 10;
      return { offset, texts: texts.slice(offset, offset + 10) };
    });
    if (!resume) { setRows([]); setExpected({}); setSnapshot(texts); setVersion(''); setResumable(true); setPage(1); }
    setStatus('running'); setError('');
    try {
      for (const { offset, texts: batch } of batches) {
        const response = await fetch('/api/quality/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: batch }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]) });
        const value = await response.json().catch(() => null) as { error?: string; version?: string; results?: { text?: string; processing?: ProcessingTrace }[] } | null;
        if (!response.ok) throw new Error(value?.error || `Сервер вернул ошибку ${response.status}.`);
        if (!value?.version || !Array.isArray(value.results) || value.results.length !== batch.length || value.results.some(row => typeof row.text !== 'string' || !row.processing || !Array.isArray(row.processing.steps))) throw new Error('Сервер вернул неполный результат. Повторите оставшиеся сообщения.');
        if (observedVersion && observedVersion !== value.version) {
          setResumable(false);
          throw new Error('Версия алгоритма изменилась во время проверки. Запустите весь набор заново.');
        }
        observedVersion = value.version; setVersion(observedVersion);
        done = [...done, ...value.results.map((row, index) => ({ original: batch[index], text: row.text!, processing: row.processing!, index: offset + index }))];
        setRows(done);
      }
      setStatus('done');
    } catch (cause) {
      if (stopped.current) setStatus('stopped');
      else { setStatus('failed'); setError(cause instanceof Error && cause.name === 'TimeoutError' ? 'Сервер не ответил за 30 секунд. Уже полученные результаты сохранены.' : cause instanceof Error ? cause.message : 'Нет связи с сервером. Уже полученные результаты сохранены.'); }
    } finally { controller.current = null; }
  }
  function exportResults() {
    const output = { kind: 'live-rules-check', exportedAt: new Date().toISOString(), version, total: snapshot.length, completed: rows.length, state: status,
      manualComparison: { labelled: labelled.length, matched: matches },
      results: rows.map(row => ({ ...row, expectedRoute: expected[row.index] || null, matchesExpected: expected[row.index] ? expected[row.index] === routeName(row) : null })) };
    saveDownload(JSON.stringify(output, null, 2), `quality-live-${new Date().toISOString().slice(0, 10)}.json`);
  }

  return <section aria-labelledby="live-quality-heading" className={styles.live}>
    <h2 id="live-quality-heading">Проверить текущий алгоритм</h2>
    <p>Без сохранения обращений и без ИИ. По одной строке на сообщение, до 1000 сообщений и 2000 символов в каждом.</p>
    <p>Начальная база ответов; изменения карточек проверяйте отправкой <Link href="/">на главной</Link>.</p>
    <label className={styles.inputLabel} htmlFor="quality-input">Тексты для проверки</label>
    <textarea id="quality-input" className={styles.textarea} value={input} onChange={event => edit(event.target.value)} disabled={running} rows={7} placeholder="Что такое ДМ?&#10;Меня сейчас бьют у банка, помогите" />
    <div className={styles.toolbar}>
      <button type="button" className="primary" disabled={running || !input.trim()} onClick={() => void run()}>{running ? 'Проверяется…' : rows.length ? 'Проверить заново' : 'Запустить проверку'}</button>
      <button type="button" className="secondary" disabled={running} onClick={() => edit(liveExamples.join('\n'))}>Подставить 6 примеров</button>
      {running && <button type="button" className="secondary" onClick={() => { stopped.current = true; controller.current?.abort(); }}>Остановить</button>}
      {resumable && (status === 'failed' || status === 'stopped') && rows.length < snapshot.length && <button type="button" className="secondary" onClick={() => void run(true)}>Продолжить с сообщения {rows.length + 1}</button>}
      {!!rows.length && <button type="button" className="secondary" disabled={running} onClick={exportResults}>Скачать результат JSON</button>}
      <button type="button" className="secondary" disabled={running || !input} onClick={() => edit('')}>Очистить проверку</button>
    </div>
    {!!snapshot.length && <div className={styles.progress} role="status" aria-live="polite">
      <span>{status === 'done' ? 'Проверка завершена' : status === 'stopped' ? 'Проверка остановлена' : status === 'failed' ? 'Проверка прервана' : 'Проверка'}: {rows.length} / {snapshot.length}</span>
      <progress value={rows.length} max={snapshot.length} aria-label="Проверено сообщений" />
      {version && <span>Версия: {version}</span>}
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!!rows.length && <>
      <div className={styles.metrics}>
        <div><span>Проверено</span><strong>{rows.length}</strong></div>
        <div><span>Не определено</span><strong>{rows.filter(row => !row.processing.route).length}</strong></div>
        <div><span>Срочно сейчас</span><strong>{rows.filter(row => row.processing.urgency?.level === 'now').length}</strong></div>
        <div><span>Готовых ответов</span><strong>{rows.filter(row => row.processing.knowledge?.status === 'answered').length}</strong></div>
      </div>
      <p>{labelled.length ? `Ручная сверка: совпало ${matches} из ${labelled.length} указанных вами категорий.` : 'Точность не рассчитана: выберите ожидаемую категорию у результатов, которые хотите проверить.'} Оценки сохраняются только в скачанном файле.</p>
      <div className={styles.toolbar}>
        <label>Категория<select value={category} onChange={event => { setCategory(event.target.value); setPage(1); }}><option value="all">Все категории</option>{['question', 'help', 'violation', 'trash', 'undetermined'].map(key => <option key={key} value={key}>{names[key]}</option>)}</select></label>
        <label className={styles.checkbox}><input type="checkbox" checked={onlyErrors} onChange={event => { setOnlyErrors(event.target.checked); setPage(1); }} />Только несовпадения с моей оценкой</label>
        <span>Показано: {filtered.length} из {rows.length}</span>
      </div>
      {filtered.length === 0 && <p>Нет результатов для выбранного фильтра.</p>}
      {filtered.slice((currentPage - 1) * 20, currentPage * 20).map(row => <article key={row.index} className={styles.result}>
        <div className={styles.resultHeader}><strong>№ {row.index + 1} · {names[routeName(row)]}</strong><span>{row.processing.urgency ? { now: 'Сейчас', high: 'Высокий', normal: 'Обычный' }[row.processing.urgency.level] : ''}</span></div>
        <p className={styles.original}>{row.original}</p>
        {row.text !== row.original && <p><strong>После исправления:</strong> {row.text}</p>}
        {row.processing.knowledge?.status === 'answered' && <p className={styles.answer}><strong>Готовый ответ:</strong> {row.processing.knowledge.answer}</p>}
        {row.processing.followUp && <p><strong>Уточнение:</strong> {row.processing.followUp}</p>}
        <div className={styles.toolbar}>
          <label>Ожидаемая категория<select aria-label={`Ожидаемая категория сообщения ${row.index + 1}`} value={expected[row.index] || ''} onChange={event => setExpected(current => ({ ...current, [row.index]: event.target.value }))}><option value="">Не оценено</option>{['question', 'help', 'violation', 'trash', 'undetermined'].map(key => <option key={key} value={key}>{names[key]}</option>)}</select></label>
          {expected[row.index] && <strong className={expected[row.index] === routeName(row) ? styles.match : styles.mismatch}>{expected[row.index] === routeName(row) ? 'Совпало' : 'Не совпало'}</strong>}
        </div>
        <details><summary>Почему получился этот результат</summary><ol className={styles.trace}>{row.processing.steps.map((step, index) => <li key={`${step.id}-${index}`}><strong>{step.title}</strong><p>{step.value}</p>{step.detail && <p>{step.detail}</p>}</li>)}</ol></details>
      </article>)}
      {pageCount > 1 && <nav className={styles.toolbar} aria-label="Страницы результатов проверки"><button type="button" className="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Назад</button><span>Страница {currentPage} из {pageCount}</span><button type="button" className="secondary" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Далее</button></nav>}
    </>}
  </section>;
}

export default function AssistanceQuality() {
  const { assistance, benchmark } = report;
  const [view, setView] = useState<'saved' | 'live'>('saved');
  const [breakdown, setBreakdown] = useState<'language' | 'category'>('language');
  const [sort, setSort] = useState('errors');
  useEffect(() => {
    const selectHash = () => {
      if (window.location.hash === '#live-check') setView('live');
      else if (window.location.hash === '#saved-check') setView('saved');
    };
    selectHash();
    window.addEventListener('hashchange', selectHash);
    return () => window.removeEventListener('hashchange', selectHash);
  }, []);
  useEffect(() => {
    if (view === 'live' && window.location.hash === '#live-check') {
      const frame = requestAnimationFrame(() => document.getElementById('live-check')?.scrollIntoView({ block: 'start' }));
      return () => cancelAnimationFrame(frame);
    }
  }, [view]);
  function changeView(next: 'saved' | 'live') {
    setView(next);
    window.history.replaceState(window.history.state, '', next === 'live' ? '#live-check' : '#saved-check');
  }
  const breakdownRows = (breakdown === 'language' ? benchmark?.languages.map(row => ({ ...row, key: row.language })) : benchmark?.categories.map(row => ({ ...row, key: row.route }))) ?? [];
  breakdownRows.sort((a, b) => sort === 'errors' ? (b.wrong ?? -1) - (a.wrong ?? -1) : sort === 'accuracy' ? (b.accuracy ?? -1) - (a.accuracy ?? -1) : names[a.key].localeCompare(names[b.key], 'ru'));
  const splits = [
    ...(assistance.development ? [{ title: 'Разработка — знакомые примеры', value: assistance.development }] : []),
    ...(assistance.holdout ? [{ title: 'Отложенная проверка — новые группы', value: assistance.holdout }] : []),
  ];
  return <section aria-label="Текущие проверки алгоритмов" className={styles.dashboard}>
    <div className={styles.modeButtons} role="group" aria-label="Режим проверки">
      <button type="button" aria-pressed={view === 'saved'} onClick={() => changeView('saved')}>Сохранённые проверки</button>
      <button type="button" aria-pressed={view === 'live'} onClick={() => changeView('live')}>Проверить сейчас</button>
    </div>
    <div id="live-check" hidden={view !== 'live'}><LiveQuality /></div>
    <div id="saved-check" hidden={view !== 'saved'}>
    <div className={styles.toolbar}><p className={styles.savedLabel}>Сохранённый прогон · {benchmark ? new Date(benchmark.createdAt).toLocaleString('ru-RU', { timeZone: 'Asia/Qyzylorda' }) : 'Не опубликован'}</p><button type="button" className="secondary" onClick={() => saveDownload(JSON.stringify(report, null, 2), 'quality-saved-summary.json')}>Скачать сводку JSON</button></div>
    <p className="quality-note">Это сохранённые результаты, а не новый запуск. Алгоритмы проверялись без ИИ; разметка ассистентская, не подтверждена человеком.</p>
    <h2>Категории на {benchmark ? count(benchmark.total) : '10 000'} сообщениях</h2>
    {benchmark ? <>
      <div className={styles.metrics}>
        <div><span>Совпадение с разметкой</span><strong>{percent(benchmark.accuracy, true)}</strong></div>
        <div><span>Верных категорий</span><strong>{count(benchmark.correct)} / {count(benchmark.total)}</strong></div>
        <div><span>Несовпадений</span><strong>{count(benchmark.wrong)}</strong></div>
        <div><span>Не определено, всего</span><strong>{count(benchmark.diagnostics.undetermined)}</strong></div>
      </div>
      <div className="quality-table-wrap"><table className="quality-table">
        <caption>Неопределённые решения могут входить в число ошибок; эти показатели не складываются.</caption>
        <thead><tr><th scope="col">Несовпадений категорий</th><th scope="col">Не определено, всего</th><th scope="col">Ложных нарушений</th><th scope="col">Ложная корзина</th></tr></thead>
        <tbody><tr><td>{count(benchmark.wrong)}</td><td>{count(benchmark.diagnostics.undetermined)}</td><td>{count(benchmark.diagnostics.falseViolation)}</td><td>{count(benchmark.diagnostics.falseTrash)}</td></tr></tbody>
      </table></div>
      <div className={styles.toolbar}>
        <div className={styles.segmented} role="group" aria-label="Разрез статистики"><button type="button" aria-pressed={breakdown === 'language'} onClick={() => setBreakdown('language')}>По языкам</button><button type="button" aria-pressed={breakdown === 'category'} onClick={() => setBreakdown('category')}>По категориям</button></div>
        <label>Порядок<select value={sort} onChange={event => setSort(event.target.value)}><option value="errors">Сначала больше ошибок</option><option value="accuracy">Сначала выше совпадение</option><option value="name">По названию</option></select></label>
      </div>
      <div className="quality-table-wrap"><table className="quality-table">
        <caption>{breakdown === 'language' ? 'Ошибки по языкам' : 'Ошибки по категориям предварительной разметки'}</caption>
        <thead><tr><th scope="col">{breakdown === 'language' ? 'Язык' : 'Категория'}</th><th scope="col">Сообщений</th><th scope="col">Совпало</th><th scope="col">Ошибок</th><th scope="col">Совпадение</th></tr></thead>
        <tbody>{breakdownRows.map(row => <tr key={row.key}><th scope="row">{names[row.key]}</th><td>{count(row.total)}</td><td>{count(row.correct)}</td><td>{count(row.wrong)}</td><td>{percent(row.accuracy, true)}</td></tr>)}</tbody>
      </table></div>
      {benchmark.comparison && <p>По сравнению с предыдущей базовой версией: исправлено {count(benchmark.comparison.improved)}, новых ошибок {count(benchmark.comparison.regressed)}.</p>}
      <details><summary>Ошибки маршрутизации и покрытие новых функций</summary>
        <div className="quality-table-wrap"><table className="quality-table">
          <thead><tr><th scope="col">Пропущено нарушений</th><th scope="col">Помощь → вопрос</th><th scope="col">Вопрос → помощь</th></tr></thead>
          <tbody><tr><td>{count(benchmark.diagnostics.missedViolation)}</td><td>{count(benchmark.diagnostics.helpAsQuestion)}</td><td>{count(benchmark.diagnostics.questionAsHelp)}</td></tr></tbody>
        </table></div>
        <p>Для срочности и готовых ответов в этой выборке нет эталонных оценок. Следующие числа показывают только использование функций.</p>
        <div className="quality-table-wrap"><table className="quality-table">
          <thead><tr><th scope="col">Срочность: сейчас</th><th scope="col">Высокий</th><th scope="col">Обычный</th><th scope="col">Не оценивалась</th></tr></thead>
          <tbody><tr><td>{count(benchmark.coverage.urgency.now)}</td><td>{count(benchmark.coverage.urgency.high)}</td><td>{count(benchmark.coverage.urgency.normal)}</td><td>{count(benchmark.coverage.urgency.not_evaluated)}</td></tr></tbody>
        </table></div>
        <p>Готовый ответ: {count(benchmark.coverage.faqAnswered)} из {count(benchmark.total)} ({percent(benchmark.coverage.faqCoverage, true)}). Вопросы, переданные администратору: {count(benchmark.coverage.faqNeedsAdmin)}.</p>
        <p>Набор знаком алгоритму: {count(benchmark.labels.scenarios)} сценариев и {count(benchmark.labels.baseTexts)} базовых формулировок. Пограничных эталонных меток: {count(benchmark.labels.disputedReferenceRows)}.</p>
      </details>
    </> : <p>Новый прогон на 10 000 сообщениях ещё не опубликован.</p>}

    <h2>Срочность и готовые ответы</h2>
    <p>{count(assistance.overall.total)} проверенных примеров в {count(assistance.overall.families)} группах. Варианты одной группы связаны между собой. Отложенные группы не использовались для настройки.</p>
    <div className="quality-table-wrap"><table className="quality-table">
      <caption>Совпадают и категория, и решение о срочности или готовом ответе</caption>
      <thead><tr><th scope="col">Выборка</th><th scope="col">Примеров</th><th scope="col">Совпало</th><th scope="col">Ошибок</th><th scope="col">Совпадение</th></tr></thead>
      <tbody>{splits.map(({ title, value }) => <tr key={title}><th scope="row">{title}</th><td>{count(value.total)}</td><td>{count(value.correct)}</td><td>{count(value.errors)}</td><td>{percent(value.accuracyPercent)}</td></tr>)}</tbody>
    </table></div>
    {!assistance.holdout && <p>Отложенная проверка ещё не опубликована.</p>}
    <h3>Срочные ситуации</h3>
    <div className="quality-table-wrap"><table className="quality-table">
      <thead><tr><th scope="col">Выборка</th><th scope="col">Нужно вмешаться сейчас</th><th scope="col">Найдено</th><th scope="col">Пропущено</th><th scope="col">Ложная срочность</th></tr></thead>
      <tbody>{splits.map(({ title, value }) => <tr key={title}><th scope="row">{title}</th><td>{count(value.urgency.expectedNow)}</td><td>{count(value.urgency.correctNow)} ({percent(value.urgency.nowRecallPercent)})</td><td>{count(value.urgency.missedNow)}</td><td>{count(value.urgency.falseNow)}</td></tr>)}</tbody>
    </table></div>
    <h3>Готовые ответы</h3>
    <div className="quality-table-wrap"><table className="quality-table">
      <thead><tr><th scope="col">Выборка</th><th scope="col">Выдано ответов</th><th scope="col">Верных по разметке</th><th scope="col">Ошибочных ответов</th><th scope="col">Охват ответимых вопросов</th></tr></thead>
      <tbody>{splits.map(({ title, value }) => <tr key={title}><th scope="row">{title}</th><td>{count(value.faq.answered)}</td><td>{count(value.faq.correctAnswers)}</td><td>{count(value.faq.unsafeAnswers)}</td><td>{count(value.faq.correctAnswers)} / {count(value.faq.answerable)} ({percent(value.faq.answerRecallPercent)})</td></tr>)}</tbody>
    </table></div>
    <p>Это синтетическая проверка, а не гарантия качества в реальном потоке. Естественность переводов отдельно не подтверждена носителями языков.</p>
    <p>Дата проверки: {new Date(assistance.createdAt).toLocaleString('ru-RU', { timeZone: 'Asia/Qyzylorda' })}.</p>
    </div>
  </section>;
}
