import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const MIGRATIONS = Object.freeze([
  '0000_bumpy_raider.sql', '0001_sloppy_joshua_kane.sql', '0002_greedy_charles_xavier.sql',
  '0003_feedback.sql', '0004_feedback_routing.sql', '0005_assistance.sql',
  '0006_ai_settings.sql', '0007_triage_history.sql', '0008_ai_rate_limits.sql',
]);
export const UPGRADE_GUIDE = 'docs/jury-guide.md#upgrading-existing-database';
// type, NOT NULL, primary-key position. No application rows or secrets are selected.
export const REQUIRED_TABLES = {
  messages: { id: ['TEXT', 1, 1], text: ['TEXT', 1, 0], status: ['TEXT', 1, 0], created_at: ['INTEGER', 1, 0], original_text: ['TEXT', 0, 0], processing: ['TEXT', 0, 0], owner_hash: ['TEXT', 0, 0], service: ['TEXT', 0, 0] },
  message_feedback: { message_id: ['TEXT', 1, 1], label: ['TEXT', 1, 0], corrected_text: ['TEXT', 0, 0], note: ['TEXT', 0, 0], updated_at: ['INTEGER', 1, 0], routing_schema: ['TEXT', 0, 0], needs_clarification: ['INTEGER', 0, 0] },
  knowledge_entries: { id: ['TEXT', 1, 1], entry: ['TEXT', 1, 0], updated_at: ['INTEGER', 1, 0] },
  ai_settings: { id: ['INTEGER', 0, 1], encrypted_key: ['TEXT', 0, 0], key_suffix: ['TEXT', 0, 0], enabled: ['INTEGER', 1, 0], mode: ['TEXT', 1, 0], model: ['TEXT', 1, 0], used: ['INTEGER', 1, 0], updated_at: ['INTEGER', 1, 0] },
  ai_requests: { id: ['TEXT', 0, 1], token: ['TEXT', 1, 0], input_hash: ['TEXT', 1, 0], created_at: ['INTEGER', 1, 0], result_json: ['TEXT', 0, 0] },
  triage_history: { id: ['TEXT', 1, 1], ticket_id: ['TEXT', 1, 0], reporter: ['TEXT', 1, 0], signature: ['TEXT', 1, 0], event_at: ['INTEGER', 1, 0], stored_at: ['INTEGER', 1, 0] },
  ai_rate_limits: { bucket: ['TEXT', 1, 1], used: ['INTEGER', 1, 0], expires_at: ['INTEGER', 1, 0], token: ['TEXT', 1, 0] },
};
export const REQUIRED_INDEXES = {
  messages_owner_hash_idx: { table: 'messages', columns: ['owner_hash'] },
  triage_history_lookup: { table: 'triage_history', columns: ['reporter', 'signature', 'event_at'] },
  triage_history_retention: { table: 'triage_history', columns: ['stored_at'] },
  ai_rate_limits_expiry: { table: 'ai_rate_limits', columns: ['expires_at'] },
};
const tableNames = Object.keys(REQUIRED_TABLES).map(name => `'${name}'`).join(',');
const indexNames = Object.keys(REQUIRED_INDEXES).map(name => `'${name}'`).join(',');
export const SCHEMA_SQL = `
SELECT 'table' AS kind, name, '' AS parent, '' AS data_type, 0 AS required, 0 AS primary_key, 0 AS position
FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_METADATA', 'd1_migrations')
UNION ALL
SELECT 'column', p.name, m.name, p.type, p."notnull", p.pk, p.cid
FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name IN (${tableNames})
UNION ALL
SELECT 'index', name, tbl_name, '', 0, 0, 0 FROM sqlite_master WHERE type = 'index' AND name IN (${indexNames})
UNION ALL
SELECT 'index_column', p.name, m.name, '', 0, 0, p.seqno
FROM sqlite_master m JOIN pragma_index_info(m.name) p WHERE m.type = 'index' AND m.name IN (${indexNames});`;
export const SETTINGS_SQL = `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN id = 1 AND used BETWEEN 0 AND 100 AND enabled IN (0, 1) AND mode IN ('uncertain', 'all') THEN 1 ELSE 0 END), 0) AS valid FROM ai_settings;`;

export function parseSetupArgs(args) {
  const options = { rules: undefined, archive: undefined, skipInstall: false, help: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw new Error('Параметры команды не должны повторяться.');
    seen.add(arg);
    if (arg === '--skip-install') options.skipInstall = true;
    else if (arg === '--help') options.help = true;
    else if (arg === '--rules' || arg === '--archive') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('После --rules или --archive нужен путь к файлу.');
      options[arg === '--rules' ? 'rules' : 'archive'] = value;
    } else throw new Error('Неизвестный параметр setup:local. Используйте --help.');
  }
  if (!options.help && Number(Boolean(options.rules)) + Number(Boolean(options.archive)) !== 1) throw new Error('Укажите ровно один источник: --rules rules.json или --archive handout.tgz.');
  return options;
}

export function planDatabase(rows) {
  if (!Array.isArray(rows) || rows.some(row => !row || !['table', 'column', 'index', 'index_column'].includes(row.kind) || typeof row.name !== 'string' || typeof row.parent !== 'string')) throw new Error('Некорректный ответ проверки схемы базы.');
  if (!rows.length) return { state: 'fresh', migrations: [...MIGRATIONS], problems: [] };
  const problems = [];
  for (const [table, columns] of Object.entries(REQUIRED_TABLES)) {
    if (rows.filter(row => row.kind === 'table' && row.name === table).length !== 1) { problems.push(`table:${table}`); continue; }
    const actual = rows.filter(row => row.kind === 'column' && row.parent === table);
    if (actual.length !== Object.keys(columns).length) problems.push(`columns:${table}`);
    for (const [name, expected] of Object.entries(columns)) {
      const matches = actual.filter(row => row.name === name);
      if (matches.length !== 1 || matches[0].data_type?.toUpperCase() !== expected[0] || matches[0].required !== expected[1] || matches[0].primary_key !== expected[2]) problems.push(`column:${table}.${name}`);
    }
  }
  for (const [name, expected] of Object.entries(REQUIRED_INDEXES)) {
    const indexes = rows.filter(row => row.kind === 'index' && row.name === name);
    const columns = rows.filter(row => row.kind === 'index_column' && row.parent === name).sort((a, b) => a.position - b.position).map(row => row.name);
    if (indexes.length !== 1 || indexes[0].parent !== expected.table || JSON.stringify(columns) !== JSON.stringify(expected.columns)) problems.push(`index:${name}`);
  }
  return { state: problems.length ? 'partial' : 'complete', migrations: [], problems };
}

export function parseWranglerJson(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Некорректный ответ локальной базы.');
  let result;
  try { result = JSON.parse(raw); } catch { throw new Error('Wrangler не вернул корректный JSON. Обновите зависимости через npm run install:ci.'); }
  if (!Array.isArray(result) || !result.length || result.some(item => item?.success !== true || !Array.isArray(item.results))) throw new Error('Локальная база не подтвердила выполнение команды.');
  return result.flatMap(item => item.results);
}

export function setupEnvironment(parent) {
  const env = { ...parent, AI_REVIEW_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' };
  for (const name of ['OPENAI_API_KEY', 'SUPPORT_SETTINGS_SECRET', 'SUPPORT_ADMIN_PASSWORD']) delete env[name];
  return env;
}

export function wranglerArguments(root, envFile, operation, value) {
  if (!['--command', '--file'].includes(operation)) throw new Error('Некорректная операция локальной базы.');
  return ['--import', pathToFileURL(path.join(root, 'scripts/sites-env.mjs')).href,
    path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'DB', '--local',
    '--config', path.join(root, 'dist/server/wrangler.json'), '--persist-to', path.join(root, '.wrangler/state'),
    '--env-file', envFile, '--json', '--yes', operation, value];
}

function runProcess(args, { root, env, capture, stage }) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, shell: false, windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 20 * 60 * 1000 });
  if (result.error || result.signal || result.status !== 0) throw new Error(`Этап «${stage}» не завершён. Данные базы не удалялись; для частичной базы см. ${UPGRADE_GUIDE}.`);
  return result.stdout ?? '';
}

function requireFile(filename, maxSize = Infinity) {
  try { const info = statSync(filename); if (!info.isFile() || info.size === 0 || info.size > maxSize) throw new Error(); }
  catch { throw new Error('Не найден доступный обычный файл. Проверьте путь к правилам/архиву и файлы проекта до установки.'); }
}

export function acquireSetupLock(root) {
  const runtime = path.join(root, '.sites-runtime');
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const filename = path.join(runtime, 'setup-local.lock');
  let descriptor;
  try { descriptor = openSync(filename, 'wx', 0o600); }
  catch { throw new Error('Другой setup:local уже работает или оставил .sites-runtime/setup-local.lock. Убедитесь, что установка остановлена, прежде чем вручную удалить только этот lock-файл.'); }
  try { writeFileSync(descriptor, `${process.pid}\n`); }
  finally { closeSync(descriptor); }
  let released = false;
  return () => { if (!released) { unlinkSync(filename); released = true; } };
}

export function setupLocal(options, { root = projectRoot, environment = process.env, run = runProcess, log = text => process.stdout.write(`${text}\n`) } = {}) {
  if (Number(Boolean(options.rules)) + Number(Boolean(options.archive)) !== 1) throw new Error('Нужен ровно один источник правил.');
  const source = path.resolve(root, options.rules ?? options.archive);
  requireFile(source, options.archive ? 50 * 1024 * 1024 : 5 * 1024 * 1024);
  for (const migration of MIGRATIONS) requireFile(path.join(root, 'drizzle', migration));
  const npm = environment.npm_execpath;
  if (!npm || !path.isAbsolute(npm)) throw new Error('Запустите установку через npm run setup:local.');
  requireFile(npm);
  const unlock = acquireSetupLock(root);
  const envFile = path.join(root, '.sites-runtime', `setup-empty-${randomUUID()}.env`);
  const env = setupEnvironment(environment);
  try {
    writeFileSync(envFile, '', { flag: 'wx', mode: 0o600 });
    const execute = (args, stage, capture = false) => run(args, { root, env, stage, capture });
    if (!options.skipInstall) {
      log('Установка зависимостей…');
      execute([npm, 'run', 'install:ci'], 'install:ci');
    }
    log('Подготовка локального корпуса правил…');
    execute([path.join(root, 'scripts/prepare-triage-corpus.mjs'), options.rules ? '--rules' : '--archive', source], 'triage:prepare', true);
    log('Production-сборка…');
    execute([npm, 'run', 'build'], 'build');
    const query = sql => parseWranglerJson(execute(wranglerArguments(root, envFile, '--command', sql), 'проверка схемы базы', true));
    const plan = planDatabase(query(SCHEMA_SQL));
    if (plan.state === 'partial') throw new Error(`Обнаружена частичная или несовместимая база. Автоматические миграции не запускались. Сохраните резервную копию и примените только недостающие миграции по ${UPGRADE_GUIDE}.`);
    if (plan.state === 'fresh') {
      log('Пустая локальная база: применение девяти миграций…');
      for (const filename of plan.migrations) parseWranglerJson(execute(wranglerArguments(root, envFile, '--file', path.join(root, 'drizzle', filename)), `миграция ${filename}`, true));
      if (planDatabase(query(SCHEMA_SQL)).state !== 'complete') throw new Error(`Проверка схемы после миграций не пройдена. Не запускайте миграции повторно вслепую: ${UPGRADE_GUIDE}.`);
    } else log('Готовая локальная база: миграции пропущены, существующие данные сохранены.');
    const state = query(SETTINGS_SQL);
    if (state.length !== 1 || state[0].total !== 1 || state[0].valid !== 1) throw new Error(`Состояние ai_settings требует ручной проверки. Настройки и счётчик не изменялись: ${UPGRADE_GUIDE}.`);
    log('Готово. Запустите npm start, затем при необходимости npm run ai:configure. Ключ не копировался, ИИ не включался.');
    return { database: plan.state, migrationsApplied: plan.migrations.length };
  } finally {
    try { unlinkSync(envFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { unlock(); }
  }
}

export const SETUP_HELP = `Локальная подготовка Basqar (Node.js 22.13+):
  npm run setup:local -- --rules /path/rules.json
  npm run setup:local -- --archive /path/handout.tgz
Ровно один источник обязателен. --skip-install пропускает установку при уже готовых зависимостях.
Установка → корпус → сборка → проверка базы. Девять миграций применяются только к пустой базе.
Готовая база сохраняется; частичная требует ручного обновления: ${UPGRADE_GUIDE}.
Остановите работающий локальный сайт перед setup. Ключи не копируются, платных API-вызовов нет.`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseSetupArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${SETUP_HELP}\n`); else setupLocal(options);
  } catch (error) { process.stderr.write(`Не удалось подготовить сайт: ${error.message}\n`); process.exitCode = 1; }
}
