"use client";

import { useEffect, useState } from "react";
import data from "@/lib/benchmark-quality-summary.json";

type Counts = { total: number; correct: number; wrong: number; accuracy: number };
type BenchmarkQuality = {
  schema: string; generatedAt: string | null; labelNote: string; filesReady: boolean;
  runs: (Counts & { id: string; title: string; processorVersion: string; source: "live" | "local";
    undetermined: number; falseViolation: number; falseTrash: number })[];
  languages: (Counts & { language: "ru" | "kk" | "uk" | "uz" })[];
  independent: Counts | null;
};
const languages = { ru: "Русский", kk: "Казахский", uk: "Украинский", uz: "Узбекский" };
const percent = (value: number) => (value * 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + "%";

export default function BenchmarkSection() {
  const [benchmark, setBenchmark] = useState<BenchmarkQuality>(data as BenchmarkQuality);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/quality/benchmark-10000-summary.json", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then((raw: unknown) => {
        const value = raw as Partial<BenchmarkQuality> | null;
        if (value?.schema === "benchmark-quality-v1" && Array.isArray(value.runs) && Array.isArray(value.languages)) setBenchmark(value as BenchmarkQuality);
      }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (!benchmark.runs.length) return null;
  return <section aria-labelledby="benchmark-heading">
    <h2 id="benchmark-heading">Прогоны на 10 000 сообщениях</h2>
    {benchmark.labelNote && <p className="quality-note">{benchmark.labelNote}</p>}
    <div className="quality-table-wrap"><table className="quality-table">
      <caption className="sr-only">Результаты каждого прогона на 10 000 сообщениях</caption>
      <thead><tr><th scope="col">Прогон</th><th scope="col">Верно</th><th scope="col">Ошибок</th><th scope="col">Совпадение</th><th scope="col">Где проверено</th></tr></thead>
      <tbody>{benchmark.runs.map(run => <tr key={run.id}>
        <th scope="row">{run.title}</th><td>{run.correct} / {run.total}</td><td>{run.wrong}</td><td>{percent(run.accuracy)}</td><td>{run.source === "live" ? "Сайт" : "Локально"}</td>
      </tr>)}</tbody>
    </table></div>
    <details className="quality-note"><summary>Категории и языки</summary>
      <div className="quality-table-wrap"><table className="quality-table">
        <thead><tr><th scope="col">Прогон</th><th scope="col">Не определено</th><th scope="col">Ложное нарушение</th><th scope="col">Ложная корзина</th><th scope="col">Версия</th></tr></thead>
        <tbody>{benchmark.runs.map(run => <tr key={run.id}><th scope="row">{run.title}</th><td>{run.undetermined}</td><td>{run.falseViolation}</td><td>{run.falseTrash}</td><td>{run.processorVersion}</td></tr>)}</tbody>
      </table></div>
      <div className="quality-table-wrap"><table className="quality-table">
        <caption>Языки в последнем прогоне</caption>
        <thead><tr><th scope="col">Язык</th><th scope="col">Сообщений</th><th scope="col">Верно</th><th scope="col">Ошибок</th><th scope="col">Совпадение</th></tr></thead>
        <tbody>{benchmark.languages.map(row => <tr key={row.language}><th scope="row">{languages[row.language]}</th><td>{row.total}</td><td>{row.correct}</td><td>{row.wrong}</td><td>{percent(row.accuracy)}</td></tr>)}</tbody>
      </table></div>
    </details>
    {benchmark.independent && <p className="quality-note">Отдельная новая выборка: верно {benchmark.independent.correct} из {benchmark.independent.total} ({percent(benchmark.independent.accuracy)}), ошибок {benchmark.independent.wrong}.</p>}
    {benchmark.filesReady && <p>
      <a href="/quality/benchmark-10000-report.pdf">Отчёт PDF</a>{" · "}
      <a href="/quality/benchmark-10000-errors.pdf">Все ошибки PDF</a>{" · "}
      <a href="/quality/benchmark-10000-results.zip">Результаты ZIP</a>
    </p>}
  </section>;
}
