"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound, Play, Save } from 'lucide-react';
import { SiteNav } from '@/components/site-nav';
import type { AiMode } from '@/lib/ai-settings';

type Settings = { configured: boolean; keyMask: string | null; enabled: boolean; active: boolean; mode: AiMode; model: string; used: number; limit: number; remaining: number; encryptionReady: boolean; canManage: boolean; localUrl: string; policyVersion: string; referenceDate: string };
type TestResult = { success: boolean; text: string; model?: string; tokens?: number };
const categoryLabels = { question: 'Вопрос', help: 'Помощь', violation: 'Нарушение', trash: 'Корзина', undetermined: 'Не определено' };

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState(''), [model, setModel] = useState('gpt-6-luna');
  const [enabled, setEnabled] = useState(false), [mode, setMode] = useState<AiMode>('uncertain');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [testText, setTestText] = useState('Что такое ДМить?'), [testResult, setTestResult] = useState<TestResult | null>(null);
  const pending = useRef(false);
  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/settings', { cache: 'no-store' });
      const data = await response.json() as Settings & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить настройки.');
      setSettings(data); setModel(data.model); setMode(data.mode); setEnabled(data.enabled);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Нет связи с сервером.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);

  async function save(event?: FormEvent, removeKey = false) {
    event?.preventDefault(); if (pending.current) return;
    pending.current = true; setBusy(true); setNotice(''); setError('');
    try {
      const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(removeKey ? { removeKey: true } : { model, enabled, mode, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }) });
      const data = await response.json() as Settings & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить настройки.');
      setApiKey(''); setSettings(data); setEnabled(data.enabled); setMode(data.mode); setModel(data.model); setNotice(removeKey ? 'Ключ удалён. ИИ выключен.' : 'Настройки сохранены.');
      window.dispatchEvent(new Event('ai-settings-changed'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Нет связи с сервером.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function testConnection(event: FormEvent) {
    event.preventDefault(); if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice(''); setTestResult(null);
    try {
      const response = await fetch('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), text: testText }) });
      const data = await response.json() as { error?: string; settings?: Partial<Settings>; review?: { skipped?: string; code?: string; result?: { ok: boolean; code?: string; model?: string; usage?: { inputTokens: number; outputTokens: number }; decision?: { ok: boolean; correction: { category: keyof typeof categoryLabels; corrected_text: string } | null } } } };
      if (!response.ok) throw new Error(data.error || 'Проверка не завершилась.');
      if (data.settings) setSettings(previous => previous ? { ...previous, ...data.settings } : previous);
      window.dispatchEvent(new Event('ai-settings-changed'));
      const result = data.review?.result;
      if (result?.ok) setTestResult({ success: true, text: result.decision?.ok ? 'Подключение работает. ИИ подтвердил решение алгоритма.' : `Подключение работает. Решение ИИ: ${categoryLabels[result.decision!.correction!.category]}.`, model: result.model, tokens: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0) });
      else setTestResult({ success: false, text: data.review?.skipped === 'limited' ? 'Лимит исчерпан. Новые запросы ИИ не отправляются.' : data.review?.code === 'no_key' ? 'Сначала сохраните API-ключ.' : 'ИИ не ответил. Проверьте ключ, доступ к модели и баланс OpenAI. Автоматического повтора нет.' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Нет связи с сервером.'); }
    finally { pending.current = false; setBusy(false); }
  }

  return <div className="shell"><SiteNav active="settings" busy={busy} /><main id="main-content" className="logic-main settings-main">
    <div className="secondary-page-heading"><h1>Настройки</h1></div>
    {error && <p role="alert" className="notice error">{error}</p>}
    {loading ? <p role="status">Загрузка…</p> : !settings ? <button className="secondary" onClick={() => void load()}>Повторить загрузку</button> : <>
      <section className="settings-overview"><div><span className="settings-status">{settings.active ? 'ИИ подключён' : settings.remaining === 0 ? 'Лимит ИИ исчерпан' : 'ИИ выключен'}</span><h2>{settings.used} <span>/ {settings.limit} запросов</span></h2></div><div><progress value={settings.used} max={settings.limit} aria-label="Использовано платных запросов" /><p>Смена ключа и перезапуск не сбрасывают лимит.</p></div></section>
      {!settings.canManage && <div className="notice neutral settings-local-note"><p>Ключ и платные запросы настраиваются только на ноутбуке.</p><a className="secondary" href={settings.localUrl}>Открыть локальные настройки</a></div>}
      <section className="settings-card"><h2><KeyRound size={19} aria-hidden="true" />Подключение OpenAI</h2>
        <form className="feedback-form settings-form" onSubmit={save}><fieldset disabled={busy || !settings.canManage}>
          <label>API-ключ{settings.configured && <span className="settings-key-mask">Сохранён {settings.keyMask}</span>}<input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={settings.configured ? 'Новый ключ для замены' : 'sk-…'} maxLength={4003} /></label>
          <label>Модель<input value={model} onChange={event => setModel(event.target.value)} placeholder="gpt-6-luna" maxLength={84} pattern="gpt-[a-z0-9][a-z0-9.\-]{0,79}" required /></label>
          <label>Когда проверять ИИ<select value={mode} onChange={event => setMode(event.target.value as AiMode)}><option value="uncertain">Только сложные и неясные обращения</option><option value="all">Все новые обращения, кроме явных нарушений</option></select></label>
          <label className="settings-toggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={busy || !settings.canManage || (!settings.configured && !apiKey.trim()) || settings.remaining === 0} />Включить ИИ для новых сообщений</label>
          <div className="settings-actions"><button className="primary" disabled={busy || !settings.canManage}><Save size={16} aria-hidden="true" />{busy ? 'Подождите…' : 'Сохранить настройки'}</button>{settings.configured && <button type="button" className="secondary" onClick={() => void save(undefined, true)}>Удалить ключ</button>}</div>
        </fieldset></form>
        {notice && <p role="status" className="notice">{notice}</p>}
      </section>
      <section className="settings-card"><h2>Проверка подключения</h2><form className="feedback-form settings-form" onSubmit={testConnection}><fieldset disabled={busy || !settings.canManage}><label>Тестовое сообщение<textarea value={testText} onChange={event => setTestText(event.target.value)} maxLength={2000} required /></label><div className="settings-actions"><button className="secondary" disabled={busy || !settings.canManage || !settings.configured || !testText.trim() || settings.remaining === 0}><Play size={16} aria-hidden="true" />Проверить · 1 платный запрос</button></div></fieldset></form>
        {testResult && <div role="status" className={`notice${testResult.success ? '' : ' error'}`}><div>{testResult.text}{testResult.model && <p>{testResult.model} · {testResult.tokens} токенов</p>}</div></div>}
      </section>
      <details className="settings-policy"><summary>Правила работы ИИ</summary><p>Сначала работают алгоритмы. ИИ проверяет исходный текст и предложенное решение. Для ответа игроку используется только опубликованная карточка базы; остальные обращения передаются администратору.</p><p>Срочная помощь имеет приоритет. Явные нарушения повторно не проверяются. Массовые тесты алгоритмов не расходуют API-токены.</p><p>Политика: {settings.policyVersion}. Справочник обновлён {settings.referenceDate}. Доступ к указанной модели зависит от аккаунта OpenAI.</p></details>
    </>}
  </main></div>;
}
