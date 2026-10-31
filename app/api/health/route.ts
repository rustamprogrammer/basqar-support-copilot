import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { publicDemoEnabled } from '@/lib/access';
import { publicAiSettings, readAiSettings, validSettingsSecret } from '@/lib/ai-settings';
import { BUILD_INFO } from '@/lib/build-info';

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await getDb().$client.prepare("SELECT owner_hash, service FROM messages LIMIT 1").first();
    await getDb().$client.prepare("SELECT id FROM knowledge_entries LIMIT 1").first();
    await getDb().$client.prepare("SELECT ticket_id, reporter, signature, event_at, stored_at FROM triage_history LIMIT 1").first();
    await getDb().$client.prepare("SELECT bucket, used, expires_at, token FROM ai_rate_limits LIMIT 1").first();
    const publicDemo = publicDemoEnabled(env.SUPPORT_DEMO_MODE);
    const ai = publicAiSettings(await readAiSettings(getDb().$client), validSettingsSecret(env.SUPPORT_SETTINGS_SECRET));
    return Response.json({ service: 'basqar', ok: true, build: BUILD_INFO, processingMode: ai.active ? 'rules+ai' : 'rules', aiReviewEnabled: ai.active, aiMode: ai.mode, aiUsed: ai.used, aiLimit: ai.limit, adminConfigured: publicDemo || !!env.SUPPORT_ADMIN_PASSWORD, publicDemo }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ service: 'basqar', ok: false, build: BUILD_INFO }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
