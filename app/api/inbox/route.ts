import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { isAdmin, publicDemoEnabled } from '@/lib/access';
import { inboxResponse, inboxStatement, parseInboxOptions, type InboxSqlRow } from '@/lib/inbox-query';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!await isAdmin(request, env.SUPPORT_ADMIN_PASSWORD, publicDemoEnabled(env.SUPPORT_DEMO_MODE))) return Response.json({ error: 'Войдите как администратор.' }, { status: 401 });
  try {
    const statement = inboxStatement(parseInboxOptions(new URL(request.url).searchParams));
    const row = await getDb().$client.prepare(statement.sql).bind(...statement.params).first<InboxSqlRow>();
    if (!row) throw new Error('Missing inbox result');
    return Response.json(inboxResponse(row), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Не удалось загрузить очередь.' }, { status: 503 });
  }
}
