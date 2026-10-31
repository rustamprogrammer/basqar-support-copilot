import { triage } from './engine.ts';
import { parseTicket, type Corpus, type Ticket, type TriageResult } from './types.ts';

export async function handleTriageRequest(request: Request, corpus: Corpus, run?: (ticket: Ticket) => Promise<TriageResult>) {
  const started = performance.now();
  if (request.method !== 'POST') return Response.json({ error: 'Use POST /triage.' }, { status: 405, headers: { Allow: 'POST' } });
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return Response.json({ error: 'Expected application/json.' }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: 'Expected a JSON body.' }, { status: 400 });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, raw = '';
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.length;
      if (bytes > 80 * 1024) { await reader.cancel(); return Response.json({ error: 'Maximum body size is 80 KiB.' }, { status: 413 }); }
      raw += decoder.decode(item.value, { stream: true });
    }
    raw += decoder.decode();
  } catch { return Response.json({ error: 'Invalid UTF-8 body.' }, { status: 400 }); }
  finally { reader.releaseLock(); }
  let ticket: Ticket;
  try { ticket = parseTicket(JSON.parse(raw)); }
  catch (error) { return Response.json({ error: error instanceof SyntaxError ? 'Invalid JSON.' : error instanceof Error ? error.message : 'Invalid ticket.' }, { status: 400 }); }
  try {
    const result = run ? await run(ticket) : triage(ticket, { corpus });
    result.meta.elapsed_ms = Math.round((performance.now() - started) * 100) / 100;
    return Response.json(result, { headers: { 'Cache-Control': 'no-store', 'X-Triage-Version': result.meta.version, 'X-Triage-Mode': result.meta.mode } });
  } catch (error) {
    return Response.json({ error: 'Triage is temporarily unavailable. Check database migrations and server logs.' }, { status: 503 });
  }
}
