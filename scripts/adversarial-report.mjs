import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { evaluationBreakdown } from './adversarial-evaluation.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const ratio = value => value == null ? '—' : `${(100 * value).toFixed(1)}%`;
const number = value => Number.isFinite(value) ? value.toFixed(1) : '—';
const fields = ['category', 'priority', 'lang'];
const fieldNames = { category: 'категория', priority: 'приоритет', lang: 'язык' };
const same = isDeepStrictEqual;
const difference = (expected, actual) => actual == null ? ['Нет валидного решения'] : [
  ...fields.filter(field => actual[field] !== expected[field]).map(field => `${fieldNames[field]}: ожидалось ${expected[field]}, получено ${actual[field] ?? '—'}`),
  ...(expected.needs_human && actual.needs_human !== true ? ['Не подтверждена обязательная проверка человеком'] : []),
];
const correct = row => difference(row.expected, row.prediction).length === 0;
const draft = row => row?.finalResult?.draft_reply?.text ?? (row?.modelResult?.ok ? row.modelResult.decision?.draft : row?.localResult?.draft_reply?.text);

function alignReport(report, canonical, datasetHash, name) {
  if (!report || !Array.isArray(report.results) || report.datasetSha256Lf !== datasetHash) throw new Error(`${name}: missing results or different frozen dataset hash.`);
  if (report.total !== canonical.length) throw new Error(`${name}: declared total differs from the baseline.`);
  const source = new Map();
  for (const row of report.results) {
    if (typeof row.id !== 'string' || source.has(row.id)) throw new Error(`${name}: duplicate/missing result ID.`);
    source.set(row.id, row);
  }
  const canonicalIds = new Set(canonical.map(row => row.id));
  if ([...source.keys()].some(id => !canonicalIds.has(id))) throw new Error(`${name}: unknown result ID.`);
  let missing = 0, unfinished = 0;
  const rows = canonical.map(base => {
    const found = source.get(base.id);
    if (found && (!same(found.expected, base.expected) || !same(found.ticket, base.ticket))) throw new Error(`${name}: labels or input changed at ${base.id}.`);
    if (!found) missing++;
    else if (found.state !== 'complete') unfinished++;
    return { ...base, ...found, state: 'complete', prediction: found?.state === 'complete' ? found.prediction ?? null : null,
      elapsedMs: Number.isFinite(found?.elapsedMs) ? found.elapsedMs : null,
      costUsd: found ? found.costUsd ?? null : 0, providerCalls: found?.providerCalls ?? 0 };
  });
  const metrics = evaluationBreakdown(rows);
  // All expected rows count toward accuracy; latency only describes measured
  // requests, and an unstarted row must not be reported as a billed API attempt.
  const latency = rows.map(row => row.elapsedMs).filter(Number.isFinite).sort((a, b) => a - b);
  metrics.latencyMs = { measured: latency.length, p50: latency[Math.ceil(latency.length * .5) - 1] ?? null, p95: latency[Math.ceil(latency.length * .95) - 1] ?? null, max: latency.at(-1) ?? null };
  metrics.jointCorrect = rows.filter(correct).length;
  metrics.jointAccuracy = rows.length ? metrics.jointCorrect / rows.length : null;
  metrics.failures = rows.filter(row => row.prediction === null).length;
  metrics.unnecessaryHumanEscalations = rows.filter(row => !row.expected.needs_human && row.prediction?.needs_human === true).length;
  return { rows, metrics, missing, unfinished, state: report.state ?? 'unknown', promptVersion: report.promptVersion ?? null, corpusVersion: report.corpusVersion ?? null };
}

export function buildAdversarialReport(algorithm, ai, hybrid) {
  if (!algorithm || !Array.isArray(algorithm.results) || !algorithm.results.length || algorithm.results.length !== algorithm.total || !algorithm.datasetSha256Lf) throw new Error('Algorithm report must contain the complete canonical input list and its frozen hash.');
  const canonical = algorithm.results;
  if (new Set(canonical.map(row => row.id)).size !== canonical.length || canonical.some(row => !row.ticket || !row.expected || !Array.isArray(row.challenge_tags))) throw new Error('Invalid canonical input list.');
  const runs = {
    algorithm: alignReport(algorithm, canonical, algorithm.datasetSha256Lf, 'algorithm'),
    ai: alignReport(ai, canonical, algorithm.datasetSha256Lf, 'ai'),
    ...(hybrid ? { hybrid: alignReport(hybrid, canonical, algorithm.datasetSha256Lf, 'hybrid') } : {}),
  };
  const comparisons = canonical.map((base, index) => {
    const a = runs.algorithm.rows[index], b = runs.ai.rows[index], h = runs.hybrid?.rows[index];
    const aCorrect = correct(a), bCorrect = correct(b), hCorrect = h ? correct(h) : null;
    return { id: base.id, algorithmError: !aCorrect, aiError: !bCorrect, aiRescue: !aCorrect && bCorrect,
      aiRegression: aCorrect && !bCorrect, bothErrors: !aCorrect && !bCorrect, hybridError: h ? !hCorrect : null };
  });
  const count = key => comparisons.filter(row => row[key] === true).length;
  const summary = { schema: 'adversarial-comparison-v1', generatedAt: new Date().toISOString(), datasetSha256Lf: algorithm.datasetSha256Lf, total: canonical.length,
    comparisonDefinition: 'Correct means category, priority and language match and mandatory human review is retained. Optional human review is safe and reported separately.',
    counts: { algorithmErrors: count('algorithmError'), aiErrors: count('aiError'), aiRescues: count('aiRescue'), aiRegressions: count('aiRegression'), bothErrors: count('bothErrors'), hybridErrors: hybrid ? count('hybridError') : null },
    runs: Object.fromEntries(Object.entries(runs).map(([key, value]) => [key, { state: value.state, missing: value.missing, unfinished: value.unfinished, promptVersion: value.promptVersion, corpusVersion: value.corpusVersion, metrics: value.metrics }])),
    cases: comparisons,
    limitations: ['Synthetic provisional assistant-authored labels, not independent real-world accuracy.', 'No native-speaker review.', 'No oracle chooses a successful answer per row; hybrid, when supplied, is scored as its actual recorded prediction.', 'Missing/unfinished/invalid predictions count as errors against the full expected dataset.', 'Drafts are shown for inspection; their fluency and citation relevance are not measured by classification accuracy.', 'After this set informs changes, updated scores are regression results on studied examples.'] };
  const names = { algorithm: 'Алгоритмы', ai: 'Только ИИ', hybrid: 'Обновлённый гибрид' };
  const metricRow = (label, get) => `<tr><th scope="row">${escape(label)}</th>${Object.values(runs).map(run => `<td>${escape(get(run.metrics))}</td>`).join('')}</tr>`;
  const metrics = `<table class="metrics"><thead><tr><th>Показатель</th>${Object.keys(runs).map(key => `<th>${names[key]}</th>`).join('')}</tr></thead><tbody>
    ${metricRow('Категория', m => ratio(m.categoryAccuracy))}${metricRow('Приоритет', m => ratio(m.priorityAccuracy))}${metricRow('Язык', m => ratio(m.languageAccuracy))}
    ${metricRow('Всё верно + безопасная передача', m => `${m.jointCorrect}/${m.total} · ${ratio(m.jointAccuracy)}`)}${metricRow('Приоритет macro-F1', m => ratio(m.priorityMacroF1))}
    ${metricRow('Распознаны p0', m => ratio(m.criticalRecall))}${metricRow('Нет валидного решения', m => m.failures)}${metricRow('Небезопасные автоответы', m => m.humanSafety.unsafeAutomaticDecisions)}
    ${metricRow('Лишняя передача разрешённого FAQ', m => m.unnecessaryHumanEscalations)}${metricRow('Задержка p95, мс', m => number(m.latencyMs.p95))}
    ${metricRow('Известная стоимость API, USD', m => m.costs.knownUsd.toFixed(6))}${metricRow('Запросы с неизвестной стоимостью', m => m.costs.unknownCalls)}${metricRow('Вызовы провайдера', m => m.costs.providerCalls)}</tbody></table>`;
  const predictionCell = (row, expected, expectedOnly = false) => {
    const value = expectedOnly ? expected : row?.prediction;
    if (!value) return '<div class="bad">Нет валидного решения</div>';
    const errors = expectedOnly ? [] : difference(expected, value);
    return `<div class="${errors.length ? 'bad' : 'good'}"><strong>${escape(value.category)}</strong><div>${escape(value.priority)} · ${escape(value.lang)}</div><small>${value.needs_human ? 'Проверка человеком' : 'FAQ без обязательной проверки'}</small></div>${errors.length ? `<ul class="errors">${errors.map(error => `<li>${escape(error)}</li>`).join('')}</ul>` : ''}`;
  };
  const rows = canonical.map((base, index) => {
    const flags = comparisons[index], a = runs.algorithm.rows[index], b = runs.ai.rows[index], h = runs.hybrid?.rows[index];
    const filters = ['all', ...(flags.algorithmError ? ['algorithm-errors'] : []), ...(flags.aiRescue ? ['ai-rescues'] : []), ...(flags.bothErrors ? ['both-errors'] : []), ...(flags.hybridError ? ['hybrid-errors'] : [])].join(' ');
    const inputs = base.ticket.messages.filter(message => message.role === 'player').map(message => message.text).join('\n');
    const drafts = [['Алгоритмы', a], ['ИИ', b], ...(h ? [['Гибрид', h]] : [])].map(([name, row]) => {
      const value = draft(row);
      return `<div><h4>${name}</h4><p class="verbatim">${escape(value || 'Черновик недоступен')}</p>${row.modelResult?.ok === false ? `<p class="bad">Ошибка провайдера/валидации: ${escape(row.modelResult.errorCode ?? row.modelResult.code ?? 'неизвестно')}</p>` : ''}</div>`;
    }).join('');
    return `<article class="case" data-filters="${filters}"><header><span class="case-number">${index + 1}</span><h3>${escape(base.id)}</h3><span>${escape(base.ticket.kind)} · вложений: ${escape(base.ticket.images_count ?? 0)}</span></header>
      <p class="input verbatim">${escape(inputs)}</p><p class="tags">${base.challenge_tags.map(escape).join(' · ')}</p>
      <div class="decisions"><section><h4>Ожидается</h4>${predictionCell(null, base.expected, true)}</section><section><h4>Алгоритмы</h4>${predictionCell(a, base.expected)}</section><section><h4>Только ИИ</h4>${predictionCell(b, base.expected)}</section>${h ? `<section><h4>Гибрид</h4>${predictionCell(h, base.expected)}</section>` : ''}</div>
      <details><summary>Обоснование метки и черновики</summary><p>${escape(base.label_reason ?? 'Обоснование не задано')}</p><div class="drafts">${drafts}</div></details></article>`;
  }).join('\n');
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Basqar — проверка ${canonical.length} сложных обращений</title>
<style>:root{font-family:system-ui,sans-serif;color:#172b35;background:#f2f5f5;line-height:1.5}*{box-sizing:border-box}body{margin:0}main{max-width:1240px;margin:auto;padding:36px 24px 80px}h1{font-size:clamp(26px,4vw,42px);line-height:1.15;max-width:850px;margin:12px 0}h2{margin-top:30px;font-size:22px}h3,h4,p{margin:0 0 12px}h4{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#53656f}.eyebrow{letter-spacing:.12em;font-size:12px;font-weight:700;color:#00695c}.note{max-width:1050px;color:#52636e}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:24px 0}.stat{padding:18px;background:#fff;border:1px solid #dbe4e6;border-radius:10px}.stat strong{display:block;font-size:30px}.table-wrap{overflow:auto}.metrics{width:100%;border-collapse:collapse;background:white}.metrics th,.metrics td{padding:11px 15px;text-align:left;border-bottom:1px solid #e1e8e9}.metrics thead{background:#153d48;color:white}.metrics tbody th{font-weight:500}.toolbar{background:#f2f5f5;padding:14px 0;position:sticky;top:0;z-index:1;display:flex;flex-wrap:wrap;gap:8px;align-items:center}button,input{font:inherit;border:1px solid #cbd8da;border-radius:7px;padding:9px 12px;background:white}button{cursor:pointer}button[aria-pressed=true]{background:#075f55;color:#fff;border-color:#075f55}input{min-width:210px;flex:1}.case{background:white;border:1px solid #d8e2e4;border-radius:12px;padding:22px;margin:14px 0}.case[hidden]{display:none}.case header{display:flex;gap:12px;flex-wrap:wrap;align-items:center;color:#62737d;font-size:13px}.case h3{font-size:14px;color:#172b35;margin:0}.case-number{background:#e6f1ee;padding:3px 10px;border-radius:20px;color:#075f55;font-weight:700}.input{margin-top:16px;font-size:17px}.verbatim{white-space:pre-wrap;overflow-wrap:anywhere}.tags{font-size:12px;color:#697982}.decisions{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:12px;border-top:1px solid #e2eaeb;padding-top:16px}.decisions strong{font-size:14px;overflow-wrap:anywhere}.good{color:#146047}.bad{color:#a22d2c}.errors{padding-left:18px;font-size:12px;color:#a22d2c}small{font-size:12px}details{border-top:1px solid #e2eaeb;margin-top:16px;padding-top:12px}summary{cursor:pointer;font-size:14px;color:#355e6b;margin-bottom:12px}.drafts{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px;font-size:14px}.hash{font:11px ui-monospace,monospace;overflow-wrap:anywhere;color:#637780}#visible-count{font-size:13px;color:#49616b}@media(max-width:600px){main{padding:22px 14px}.case{padding:16px}.toolbar{position:static}.decisions{grid-template-columns:1fr}.metrics th,.metrics td{padding:8px;font-size:12px}}</style></head><body><main>
<div class="eyebrow">BASQAR · СОХРАНЁННЫЕ РЕЗУЛЬТАТЫ</div><h1>${canonical.length} сложных обращений: алгоритмы, ИИ${hybrid ? ' и гибрид' : ''}</h1><p class="note">Синтетические примеры с предварительной разметкой ассистента. Проверки носителями языков не было. Баллы здесь показывают совпадение с этими метками, а не точность на реальных игроках.</p>
<div class="stats"><div class="stat"><strong>${summary.counts.algorithmErrors}</strong>ошибок алгоритмов</div><div class="stat"><strong>${summary.counts.aiRescues}</strong>ошибок алгоритмов исправил ИИ</div><div class="stat"><strong>${summary.counts.aiRegressions}</strong>верных решений алгоритмов потерял ИИ</div><div class="stat"><strong>${summary.counts.bothErrors}</strong>случаев с ошибками обоих${hybrid ? `</div><div class="stat"><strong>${summary.counts.hybridErrors}</strong>ошибок обновлённого гибрида` : ''}</div></div>
<p class="note">«Верно» означает совпадение категории, приоритета и языка с сохранением обязательной проверки человеком. Дополнительная передача разрешённого FAQ безопасна и считается отдельно. Отсутствующее или незавершённое решение считается ошибкой; метрики рассчитаны на всех ${canonical.length} ожидаемых строках.</p><p class="note">${Object.entries(runs).map(([key, run]) => `${names[key]}: состояние ${escape(run.state)}, отсутствуют ${run.missing}, не завершены ${run.unfinished}`).join(' · ')}.</p>
<div class="table-wrap">${metrics}</div><p class="note">ИИ оценивается по собственному сохранённому решению. Ответ «лучшего из двух» по известной правильной метке не выбирается. ${hybrid ? 'Гибрид — фактический отдельный прогон после изменений; использованные для правок случаи уже знакомы разработчикам.' : 'Отдельный прогон обновлённого гибрида не приложен.'} Черновики можно прочитать ниже; эти числа не измеряют качество языка и релевантность цитат.</p>
<h2>Все обращения и решения</h2><div class="toolbar" role="group" aria-label="Фильтры обращений"><button type="button" data-filter="all" aria-pressed="true">Все</button><button type="button" data-filter="algorithm-errors" aria-pressed="false">Ошибки алгоритмов</button><button type="button" data-filter="ai-rescues" aria-pressed="false">ИИ исправил</button><button type="button" data-filter="both-errors" aria-pressed="false">Ошиблись оба</button>${hybrid ? '<button type="button" data-filter="hybrid-errors" aria-pressed="false">Ошибки гибрида</button>' : ''}<input id="search" aria-label="Поиск по обращениям и решениям" placeholder="Текст, ID, категория…"><span id="visible-count" role="status" aria-live="polite">Показано ${canonical.length}</span></div>
<div id="cases">${rows}</div><p class="hash">Frozen dataset SHA-256 (LF): ${escape(algorithm.datasetSha256Lf)}</p><p class="note">Отчёт автономный: сеть не используется. Полные источники правил, заголовки запросов и секреты в документ не включены.</p>
</main><script>const cards=Array.from(document.querySelectorAll('.case'));const buttons=Array.from(document.querySelectorAll('[data-filter]'));const search=document.getElementById('search');let active='all';function filter(){const query=search.value.toLocaleLowerCase();let shown=0;for(const card of cards){const show=card.dataset.filters.split(' ').includes(active)&&card.textContent.toLocaleLowerCase().includes(query);card.hidden=!show;if(show)shown++;}document.getElementById('visible-count').textContent='Показано '+shown+' / '+cards.length;}for(const button of buttons)button.addEventListener('click',()=>{active=button.dataset.filter;for(const item of buttons)item.setAttribute('aria-pressed',String(item===button));filter();});search.addEventListener('input',filter);</script></body></html>`;
  return { html, summary };
}

async function main() {
  const args = process.argv.slice(2), allowed = new Set(['--algorithm', '--ai', '--hybrid', '--out']);
  if (args.length % 2 || args.some((value, index) => index % 2 === 0 && !allowed.has(value))) throw new Error('Usage: --algorithm BASELINE.local.json --ai AI.local.json [--hybrid HYBRID.local.json] --out ABSOLUTE.html');
  const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]]));
  if (Object.keys(options).length !== args.length / 2 || !options['--algorithm'] || !options['--ai'] || !path.isAbsolute(options['--out'] ?? '') || !options['--out'].endsWith('.html')) throw new Error('Provide unique inputs and an absolute .html output.');
  const out = path.resolve(options['--out']), summaryPath = out.slice(0, -5) + '.summary.json';
  const inputs = ['--algorithm', '--ai', '--hybrid'].filter(key => options[key]).map(key => path.resolve(options[key]));
  if (inputs.includes(out) || inputs.includes(summaryPath)) throw new Error('Output must not replace an input.');
  const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
  const [algorithm, ai, hybrid] = await Promise.all([read(options['--algorithm']), read(options['--ai']), options['--hybrid'] ? read(options['--hybrid']) : undefined]);
  const result = buildAdversarialReport(algorithm, ai, hybrid);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, result.html, 'utf8');
  await fs.writeFile(summaryPath, JSON.stringify(result.summary, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ html: out, summary: summaryPath, total: result.summary.total, counts: result.summary.counts }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
