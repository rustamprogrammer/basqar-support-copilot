"use client";

import { useEffect, useState } from 'react';
import { BookOpen, ChartNoAxesCombined, GitBranch, Inbox, MessageSquare, ScanText, Settings2 } from 'lucide-react';
import Link from '@/components/site-link';

type Section = 'test' | 'inbox' | 'knowledge' | 'quality' | 'logic' | 'settings';
const sections = [
  { id: 'test', href: '/', label: 'Проверка сообщения', icon: ScanText },
  { id: 'inbox', href: '/?view=inbox', label: 'Обращения', icon: Inbox },
  { id: 'knowledge', href: '/knowledge', label: 'База ответов', icon: BookOpen },
  { id: 'quality', href: '/quality', label: 'Тесты и статистика', icon: ChartNoAxesCombined },
  { id: 'logic', href: '/logic', label: 'Логика обработки', icon: GitBranch },
  { id: 'settings', href: '/settings', label: 'Настройки', icon: Settings2 },
] as const;

export function SiteNav({ active, onSectionChange, busy = false }: {
  active: Section;
  onSectionChange?: (view: 'test' | 'inbox') => void;
  busy?: boolean;
}) {
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => { fetch('/api/health', { cache: 'no-store' }).then(response => response.json() as Promise<{ aiReviewEnabled?: boolean }>).then(data => { if (active) setAiEnabled(data.aiReviewEnabled === true); }).catch(() => { if (active) setAiEnabled(null); }); };
    refresh();
    window.addEventListener('ai-settings-changed', refresh);
    return () => { active = false; window.removeEventListener('ai-settings-changed', refresh); };
  }, []);
  return <>
    <a className="skip-link" href="#main-content">К содержимому</a>
    <aside className="site-sidebar">
      <Link href="/" className="site-brand" aria-label="На связи — главная"><span className="site-brand-icon"><MessageSquare size={21} strokeWidth={2} aria-hidden="true" /></span><span>На связи<span className="site-brand-caption">Grand Mobile</span></span></Link>
      <nav className="site-navigation" aria-label="Основная навигация">
        {sections.map(({ id, href, label, icon: Icon }) => <Link key={id} href={href} aria-current={active === id ? 'page' : undefined} aria-disabled={busy || undefined} onClick={event => {
          if (busy) { event.preventDefault(); return; }
          if (onSectionChange && (id === 'test' || id === 'inbox') && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onSectionChange(id); }
        }}><Icon size={19} aria-hidden="true" /><span>{label}</span></Link>)}
      </nav>
      <div className="site-runtime"><span className="runtime-dot" aria-hidden="true" /><span>{aiEnabled ? 'Алгоритмы + ИИ' : 'Алгоритмы'}<span>{aiEnabled === null ? 'Статус ИИ уточняется' : aiEnabled ? 'ИИ подключён' : 'ИИ выключен'}</span></span></div>
    </aside>
  </>;
}
