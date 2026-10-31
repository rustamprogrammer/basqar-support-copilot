import { env } from "cloudflare:workers";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await getDb().$client.prepare("SELECT 1 FROM messages LIMIT 1").first();
    return Response.json({ ok: true, aiReviewEnabled: env.AI_REVIEW_ENABLED === "true" && !!env.OPENAI_API_KEY }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
