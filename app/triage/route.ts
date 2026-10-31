import { handleTriageRequest } from '@/lib/triage/http';
import { ruleCorpus } from '@/lib/triage/runtime';
import { runServerTriage } from '@/lib/triage/server';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => handleTriageRequest(request, ruleCorpus, runServerTriage);
