import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { publicDemoEnabled } from '@/lib/access';

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await getDb().$client.prepare("SELECT owner_hash, service FROM messages LIMIT 1").first();
    await getDb().$client.prepare("SELECT id FROM knowledge_entries LIMIT 1").first();
    const publicDemo = publicDemoEnabled(env.SUPPORT_DEMO_MODE);
    return Response.json({ ok: true, processingMode: 'rules', aiReviewEnabled: false, adminConfigured: publicDemo || !!env.SUPPORT_ADMIN_PASSWORD, publicDemo }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
