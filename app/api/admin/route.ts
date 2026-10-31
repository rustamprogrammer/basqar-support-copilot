import { env } from 'cloudflare:workers';
import { isAdmin, publicDemoEnabled, adminCookie, clearAdminCookie, constantEqual, digest, jsonMutation, rejectMutation, discardRequestBody } from '@/lib/access';
import { readRequestJson } from '@/lib/request-json';
export const dynamic = 'force-dynamic';
const attempts = new Map<string, { count: number; until: number }>();
export async function GET(request: Request) {
  const publicDemo = publicDemoEnabled(env.SUPPORT_DEMO_MODE);
  return Response.json({ authenticated: await isAdmin(request, env.SUPPORT_ADMIN_PASSWORD, publicDemo), configured: publicDemo || !!env.SUPPORT_ADMIN_PASSWORD, publicDemo }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  if (publicDemoEnabled(env.SUPPORT_DEMO_MODE)) {
    await discardRequestBody(request);
    return Response.json({ authenticated: true, configured: true, publicDemo: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (!jsonMutation(request)) return rejectMutation(request, 'Ожидается JSON.', 415);
  if (!env.SUPPORT_ADMIN_PASSWORD) return rejectMutation(request, 'Пароль администратора не настроен. Перезапустите сайт через start-site.cmd.', 503);
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const now = Date.now(), record = attempts.get(ip);
  if (record && record.until > now && record.count >= 10) return rejectMutation(request, 'Слишком много попыток. Повторите через 5 минут.', 429);
  const parsed = await readRequestJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.data as { password?: unknown } | null;
  if (typeof body?.password !== 'string' || body.password.length > 512 || !constantEqual(await digest(body.password), await digest(env.SUPPORT_ADMIN_PASSWORD))) {
    if (attempts.size > 1000) for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    attempts.set(ip, { count: record && record.until > now ? record.count + 1 : 1, until: record && record.until > now ? record.until : now + 300_000 });
    return Response.json({ error: 'Неверный пароль.' }, { status: 401 });
  }
  attempts.delete(ip);
  return Response.json({ authenticated: true }, { headers: { 'Set-Cookie': await adminCookie(request, env.SUPPORT_ADMIN_PASSWORD), 'Cache-Control': 'no-store' } });
}
export async function DELETE(request: Request) {
  if (publicDemoEnabled(env.SUPPORT_DEMO_MODE)) {
    await discardRequestBody(request);
    return Response.json({ authenticated: true, configured: true, publicDemo: true }, { headers: { 'Set-Cookie': clearAdminCookie(request), 'Cache-Control': 'no-store' } });
  }
  if (!jsonMutation(request)) return rejectMutation(request, 'Ожидается JSON.', 415);
  await discardRequestBody(request);
  return Response.json({ authenticated: false }, { headers: { 'Set-Cookie': clearAdminCookie(request), 'Cache-Control': 'no-store' } });
}
