import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const KEY_FILE_LIMIT = 64 * 1024;
export const RESPONSE_LIMIT = 16 * 1024;
const DEFAULT_MODEL = 'gpt-6-luna';

/** Read only OPENAI_API_KEY; do not evaluate dotenv, shell expressions, or other settings. */
export function parseKeyFile(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > KEY_FILE_LIMIT) throw new Error('Файл ключа слишком большой.');
  const assignments = source.replace(/^\uFEFF/u, '').split(/\r?\n/u)
    .map(line => line.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*?)\s*$/u))
    .filter(Boolean);
  if (assignments.length !== 1) throw new Error('В файле должна быть ровно одна строка OPENAI_API_KEY=… .');
  const value = assignments[0][1].match(/^(?:"(sk-[A-Za-z0-9_-]{17,4000})"|'(sk-[A-Za-z0-9_-]{17,4000})'|(sk-[A-Za-z0-9_-]{17,4000}))(?:\s+#.*)?$/u);
  if (!value) throw new Error('OPENAI_API_KEY пуст или имеет неверный формат. Исправьте локальный файл ключа.');
  return value[1] ?? value[2] ?? value[3];
}

export function readKeyFile(filename) {
  let descriptor;
  try {
    descriptor = openSync(filename, 'r');
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > KEY_FILE_LIMIT) throw new Error('Invalid file');
    const buffer = Buffer.alloc(KEY_FILE_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length > KEY_FILE_LIMIT) throw new Error('Invalid file');
    return parseKeyFile(buffer.subarray(0, length).toString('utf8'));
  } catch {
    // Never interpolate filesystem or parser errors: their text may contain credentials.
    throw new Error('Не удалось прочитать ключ: нужен обычный файл до 64 КиБ с одной корректной строкой OPENAI_API_KEY=… .');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function parseConfigureArgs(args) {
  const options = { keyFile: '.dev.vars', port: 8787, replaceKey: false, help: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw new Error('Параметры команды не должны повторяться.');
    seen.add(arg);
    if (arg === '--help') options.help = true;
    else if (arg === '--replace-key') options.replaceKey = true;
    else if (arg === '--key-file' || arg === '--port') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Для --key-file и --port требуется значение.');
      if (arg === '--key-file') options.keyFile = value;
      else {
        if (!/^\d{1,5}$/u.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('Порт должен быть числом от 1 до 65535.');
        options.port = Number(value);
      }
    } else throw new Error('Неизвестный параметр. Используйте --help; ключ передаётся только через файл.');
  }
  return options;
}

/** Fixed loopback transport: ignores proxy environment, rejects redirects, bounds body and total time. */
export function requestLocalJson(port, pathname, { method = 'GET', body, timeoutMs = 5000 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !['/api/health', '/api/settings'].includes(pathname)) throw new Error('Некорректный локальный адрес.');
  return new Promise((resolve, reject) => {
    let settled = false;
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const request = http.request({ hostname: '127.0.0.1', port, path: pathname, method, agent: false,
      headers: { Accept: 'application/json', Origin: `http://127.0.0.1:${port}`,
        ...(encoded === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) }) } }, response => {
      if (response.statusCode !== 200) {
        finish(new Error('Локальный сервер отклонил запрос. Проверьте запуск и настройки сайта.'));
        response.destroy();
        return;
      }
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > RESPONSE_LIMIT) {
          finish(new Error('Локальный сервер вернул слишком большой ответ.'));
          response.destroy();
        } else chunks.push(chunk);
      });
      response.once('error', () => finish(new Error('Не удалось прочитать ответ локального сервера.')));
      response.once('end', () => {
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { finish(new Error('Локальный сервер вернул некорректный ответ.')); }
      });
    });
    const timer = setTimeout(() => {
      finish(new Error('Локальный сервер не ответил за 5 секунд.'));
      request.destroy();
    }, timeoutMs);
    request.once('error', () => finish(new Error('Локальный сайт недоступен. Сначала выполните npm start.')));
    request.end(encoded);
  });
}

function validateSettings(value) {
  if (!value || value.canManage !== true || value.encryptionReady !== true || value.limit !== 100
    || !Number.isInteger(value.used) || value.used < 0 || value.used > 100 || value.remaining !== 100 - value.used
    || typeof value.configured !== 'boolean' || typeof value.enabled !== 'boolean' || typeof value.active !== 'boolean'
    || !['uncertain', 'all'].includes(value.mode) || typeof value.model !== 'string'
    || typeof value.policyVersion !== 'string' || !value.policyVersion.startsWith('contest-rag-')) {
    throw new Error('Сервер не подтвердил локальное управление, шифрование и лимит 100. Обновите и перезапустите сайт.');
  }
  return value;
}

/** Does not call a provider, reserve requests, reset counters, or replace an existing key by default. */
export async function configureLocalAi({ keyFile = '.dev.vars', port = 8787, replaceKey = false, root = projectRoot } = {},
  { requestJson = requestLocalJson, readKey = readKeyFile } = {}) {
  const health = await requestJson(port, '/api/health');
  if (!health || health.ok !== true || health.service !== 'basqar' || health.aiLimit !== 100
    || !health.build || !['build', 'serve'].includes(health.build.mode)) {
    throw new Error('На этом порту нет готового Basqar. Выполните сборку, миграции и npm start.');
  }
  const before = validateSettings(await requestJson(port, '/api/settings'));
  if (before.remaining === 0) throw new Error('Общий лимит 100 запросов исчерпан. Команда не сбрасывает счётчик.');
  const imported = !before.configured || replaceKey;
  const update = { enabled: true, mode: 'uncertain', model: DEFAULT_MODEL,
    ...(imported ? { apiKey: readKey(path.resolve(root, keyFile)) } : {}) };
  let after;
  try { after = validateSettings(await requestJson(port, '/api/settings', { method: 'POST', body: update })); }
  catch {
    // A timed-out mutation may already have committed. Never retry or expose the response body.
    throw new Error('Сохранение не подтверждено. Проверьте локальную страницу /settings перед повторным запуском; автоматического повтора нет.');
  }
  if (!after.configured || !after.enabled || after.mode !== 'uncertain' || after.model !== DEFAULT_MODEL || after.used < before.used) {
    throw new Error('Сервер не подтвердил ожидаемые настройки. Проверьте локальную страницу /settings.');
  }
  return { imported, active: after.active, used: after.used, limit: after.limit, remaining: after.remaining, mode: after.mode, model: after.model };
}

export const CONFIGURE_HELP = `Подключение ключа команды к уже запущенному локальному Basqar:
  npm run ai:configure -- --key-file .dev.vars --port 8787
Значения по умолчанию: .dev.vars и 8787. Файл содержит OPENAI_API_KEY=… .
Сохранённый ключ используется повторно. Для явной замены добавьте --replace-key.
Команда включает uncertain / gpt-6-luna; общий счётчик 100 сохраняется.
Внешних API-запросов нет. Не передавайте ключ в аргументах команды.`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseConfigureArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${CONFIGURE_HELP}\n`);
    else {
      const result = await configureLocalAi(options);
      process.stdout.write(`${result.imported ? 'Ключ сохранён в зашифрованных настройках.' : 'Используется ранее сохранённый ключ; для замены нужен --replace-key.'}\nИИ: ${result.active ? 'включён' : 'лимит исчерпан'}, ${result.mode}, ${result.model}. Использовано ${result.used}/${result.limit}; осталось ${result.remaining}. Платных проверочных запросов не было.\n`);
    }
  } catch (error) {
    process.stderr.write(`Не удалось настроить ИИ: ${error.message}\n`);
    process.exitCode = 1;
  }
}
