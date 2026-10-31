import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { jsonMutation, rejectMutation } from '@/lib/access';
import { isLocalSettingsOperator, parseAiSettingsUpdate, publicAiSettings, readAiSettings, updateAiSettings, validSettingsSecret } from '@/lib/ai-settings';
import { AI_REVIEW_REFERENCE_DATE } from '@/lib/ai-review-prompt';
import { CONTEST_PROMPT_VERSION } from '@/lib/triage/model';
import { readRequestJson } from '@/lib/request-json';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
function view(request: Request, row: Awaited<ReturnType<typeof readAiSettings>>) {
  return { ...publicAiSettings(row, validSettingsSecret(env.SUPPORT_SETTINGS_SECRET)), canManage: isLocalSettingsOperator(request),
    localUrl: `http://127.0.0.1:${/^\d{2,5}$/u.test(env.SUPPORT_LOCAL_PORT ?? '') ? env.SUPPORT_LOCAL_PORT : '8787'}/settings`,
    policyVersion: CONTEST_PROMPT_VERSION, referenceDate: AI_REVIEW_REFERENCE_DATE };
}
export async function GET(request: Request) {
  try { return Response.json(view(request, await readAiSettings(getDb().$client)), { headers }); }
  catch { return Response.json({ error: 'Настройки недоступны. Обновите базу данных и перезапустите сайт.' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!isLocalSettingsOperator(request, true)) return rejectMutation(request, 'Изменять подключение можно только на ноутбуке через 127.0.0.1.', 403);
  if (!jsonMutation(request)) return rejectMutation(request, 'Ожидается JSON.', 415);
  const parsed = await readRequestJson(request);
  if (parsed.response) return parsed.response;
  const update = parseAiSettingsUpdate(parsed.data);
  if (!update) return Response.json({ error: 'Проверьте ключ, модель и параметры подключения.' }, { status: 400, headers });
  if (!validSettingsSecret(env.SUPPORT_SETTINGS_SECRET)) return Response.json({ error: 'Перезапустите сайт через start-site.cmd для защищённого сохранения ключа.' }, { status: 503, headers });
  try { return Response.json(view(request, await updateAiSettings(getDb().$client, env.SUPPORT_SETTINGS_SECRET, update)), { headers }); }
  catch { return Response.json({ error: 'Не удалось сохранить настройки. Для включения сначала сохраните API-ключ.' }, { status: 400, headers }); }
}
