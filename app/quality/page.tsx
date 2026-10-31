import { ArrowLeft, MessageCircle } from "lucide-react";
import Link from "next/link";
import data from "@/lib/routing-quality-summary.json";
import { routeLabels } from "@/lib/message-routes";
import BenchmarkSection from "./benchmark-section";

type RouteKey = keyof typeof routeLabels | "undetermined";
type Summary = {
  total: number; scored: number; correct: number; wrong: number; abstained: number; ambiguous: number;
  routeAccuracy: number | null; coverage: number | null; decisionPrecision: number | null;
  helpAsQuestion: number; questionAsHelp: number; falseViolation: number; falseTrash: number;
  missedViolation: number; ambiguousTerminal: number;
  matrix: Record<RouteKey, Record<RouteKey, number>>;
  details: { evaluated: number; correct: number; unnecessary: number; missing: number };
};
type Report = {
  stage: string; processorVersion: string; datasetSha256: string; labelStatus: string; humanReviewed: number;
  summary: Summary;
  comparison: { baseline: string; improved: number; lostCorrect: number; abstainedToWrong: number } | null;
};
type Stage = { title: string; file: string; report: Report };
type Quality = {
  generatedAt: string; schema: string; stages: Stage[];
  fresh: { baseline: Report; final: Report } | null; regression: Report | null; retest?: Report | null;
  followUps?: { title: string; baseline: Report; final: Report }[];
};
const quality = data as Quality;
const percent = (value: number | null) => value == null ? "—" : (value * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";
const matrixLabels = { ...routeLabels, undetermined: "Не определено" };
const routes = Object.keys(matrixLabels) as RouteKey[];

function Stages({ stages }: { stages: Stage[] }) {
  const sample = stages[0]?.report.summary;
  return <>
    {sample && <p className="quality-note">Совпадение считается из {sample.scored} сообщений с однозначной разметкой. Остальные {sample.ambiguous} оцениваются отдельно.</p>}
    <div className="quality-table-wrap"><table className="quality-table">
      <caption className="sr-only">Изменение категорий по этапам</caption>
      <thead><tr><th scope="col">Этап</th><th scope="col">Верно</th><th scope="col">Ошибка</th><th scope="col">Не определено</th><th scope="col">Совпадение</th></tr></thead>
      <tbody>{stages.map(({ title, report }) => <tr key={report.stage}>
        <th scope="row">{title}</th><td>{report.summary.correct}</td><td>{report.summary.wrong}</td><td>{report.summary.abstained}</td><td>{percent(report.summary.routeAccuracy)}</td>
      </tr>)}</tbody>
    </table></div>
    <details><summary>Ошибки маршрута и уточнения по этапам</summary>
      <div className="quality-table-wrap"><table className="quality-table">
        <thead><tr><th scope="col">Этап</th><th scope="col">Помощь → Вопрос</th><th scope="col">Вопрос → Помощь</th><th scope="col">Ложное нарушение</th><th scope="col">Ложная корзина</th><th scope="col">Пропущено нарушений</th></tr></thead>
        <tbody>{stages.map(({ title, report: { stage, summary } }) => <tr key={stage}><th scope="row">{title}</th><td>{summary.helpAsQuestion}</td><td>{summary.questionAsHelp}</td><td>{summary.falseViolation}</td><td>{summary.falseTrash}</td><td>{summary.missedViolation}</td></tr>)}</tbody>
      </table></div>
      <div className="quality-table-wrap"><table className="quality-table">
        <thead><tr><th scope="col">Этап</th><th scope="col">Уточнение оценено верно</th><th scope="col">Лишнее</th><th scope="col">Не запрошено</th></tr></thead>
        <tbody>{stages.map(({ title, report: { stage, summary: { details } } }) => <tr key={stage}><th scope="row">{title}</th><td>{details.correct} / {details.evaluated}</td><td>{details.unnecessary}</td><td>{details.missing}</td></tr>)}</tbody>
      </table></div>
    </details>
  </>;
}

function Matrix({ report }: { report: Report }) {
  const { summary } = report;
  return <details className="quality-note"><summary>Матрица категорий и границы оценки</summary>
    <div className="quality-table-wrap"><table className="quality-table">
      <caption>Строка — разметка; столбец — решение системы</caption>
      <thead><tr><th scope="col">Разметка</th>{routes.map(route => <th scope="col" key={route}>{matrixLabels[route]}</th>)}</tr></thead>
      <tbody>{routes.map(expected => <tr key={expected}><th scope="row">{matrixLabels[expected]}</th>{routes.map(actual => <td key={actual}>{summary.matrix[expected][actual]}</td>)}</tr>)}</tbody>
    </table></div>
    <p>Оценены категории {summary.scored} из {summary.total} сообщений. У {summary.ambiguous} примеров нет однозначной эталонной категории; среди них в нарушение или корзину отправлено {summary.ambiguousTerminal}.</p>
    <p>Категория определена в {percent(summary.coverage)} оцениваемых сообщений. Совпадение среди определённых: {percent(summary.decisionPrecision)}. Неопределённые решения в этот показатель не входят.</p>
    <p>Проверено человеком: {report.humanReviewed}. Версия: {report.processorVersion}.</p>
  </details>;
}

export default function QualityPage() {
  const latest = quality.stages.at(-1)?.report;
  return <div className="shell">
    <header className="header"><Link className="brand" href="/"><span className="brand-icon"><MessageCircle size={21} /></span>На связи<span className="brand-dot">.</span></Link><Link className="nav-link" href="/"><ArrowLeft size={16} />К сообщениям</Link></header>
    <main className="logic-main">
      <h1>Качество обработки</h1>
      <p className="quality-note">Здесь сохранены проверки алгоритма без ИИ. Они не оценивают новую проверку ИИ. Потребность в уточнении проверяется отдельно.</p>
      <BenchmarkSection />
      {latest && <>
        <h2>Этапы на {latest.summary.total} знакомых сообщениях</h2>
        <p className="quality-note">Одна зафиксированная разметка для всех этапов. Набор используется при разработке; узкие темы жалоб не считаются отдельными категориями.</p>
        <Stages stages={quality.stages} />
        <Matrix report={latest} />
      </>}
      <h2>Первая проверка на новой выборке</h2>
      {quality.fresh ? <>
        <p className="quality-note">{quality.fresh.final.summary.total} сообщений размечены заранее. Здесь сохранён первый результат до разбора ошибок этой выборки.</p>
        <Stages stages={[{ title: "До изменений", file: "", report: quality.fresh.baseline }, { title: "После изменений", file: "", report: quality.fresh.final }]} />
        {quality.fresh.final.comparison && <p className="quality-note">Стали верными: {quality.fresh.final.comparison.improved}. Перестали быть верными: {quality.fresh.final.comparison.lostCorrect}.</p>}
        <Matrix report={quality.fresh.final} />
      </> : <p className="quality-note">Итоговый прогон ещё не опубликован.</p>}
      {quality.retest && <>
        <h2>Повтор после разбора примеров</h2>
        <p className="quality-note">Эти {quality.retest.summary.total} сообщений уже использовались для исправления правил. Повторный результат не считается независимой проверкой.</p>
        <Stages stages={[
          ...(quality.fresh ? [{ title: "Первый прогон", file: "", report: quality.fresh.final }] : []),
          { title: "После разбора примеров", file: "", report: quality.retest },
        ]} />
        {quality.retest.comparison && <p className="quality-note">Относительно первого прогона стали верными: {quality.retest.comparison.improved}. Перестали быть верными: {quality.retest.comparison.lostCorrect}.</p>}
        <Matrix report={quality.retest} />
      </>}
      {quality.regression && <details className="quality-note"><summary>Все {quality.regression.summary.total} знакомых сообщений</summary>
        <Stages stages={[{ title: "Итоговая версия", file: "", report: quality.regression }]} /><Matrix report={quality.regression} />
      </details>}
      {!!quality.followUps?.length && <>
        <h2>Дополнительные проверки</h2>
        <p className="quality-note">Эти выборки уже использовались при разработке. Результаты показывают изменения на знакомых примерах и не являются независимой проверкой.</p>
        {quality.followUps.map(({ title, baseline, final }) => <section key={`${title}:${baseline.stage}:${final.stage}`}>
          <h3>{title}</h3>
          <Stages stages={[{ title: "До изменений", file: "", report: baseline }, { title: "После изменений", file: "", report: final }]} />
          {final.comparison && <p className="quality-note">Стали верными: {final.comparison.improved}. Перестали быть верными: {final.comparison.lostCorrect}.</p>}
          <Matrix report={final} />
        </section>)}
      </>}
      <details className="quality-note"><summary>Как читать результаты</summary>
        <p>Разметка предварительная, подготовлена ассистентами. Совпадение с ней не доказывает нарушение и не гарантирует результат на новых сообщениях.</p>
        <p>«Совпадение» — верная категория среди примеров с однозначной разметкой. «Не определено» — система оставила решение админу; это не корзина и не верный ответ. Качество исправления текста этот процент не измеряет.</p>
        <p>«Помощь → Вопрос» — личная проблема ошибочно принята за справочный вопрос. Раздел «Вопрос» пока не отправляет автоматические ответы.</p>
        <p>Публичная разметка — предложение для отдельной проверки правил. Сохранение не меняет работающий алгоритм.</p>
        <p>Проверка: {new Date(quality.generatedAt).toISOString().slice(0, 10)}.</p>
      </details>
      <a className="secondary" href="/api/feedback">Скачать предложенную разметку</a>
    </main>
  </div>;
}
