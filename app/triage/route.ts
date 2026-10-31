import { handleTriageRequest } from '@/lib/triage/http';
import { ruleCorpus } from '@/lib/triage/runtime';
import { runServerTriage } from '@/lib/triage/server';
import { visitor } from '@/lib/access';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const owner = await visitor(request, true);
  const response = await handleTriageRequest(request, ruleCorpus, ticket => runServerTriage(ticket, owner.hash!));
  if (owner.cookie) response.headers.set('Set-Cookie', owner.cookie);
  return response;
}
