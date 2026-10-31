import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { triage, ticketSignature } from '../lib/triage/engine.ts';
import { parseTicket } from '../lib/triage/types.ts';
import { ruleCorpus } from '../lib/triage/runtime.ts';

const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const source = value('--in'), destination = value('--out');
if (!source || !destination) throw new Error('Usage: node scripts/predict.mjs --in tickets.jsonl --out pred.jsonl');
if (path.resolve(source) === path.resolve(destination)) throw new Error('Input and output must differ.');
// Atomic output: malformed input never leaves a seemingly complete prediction file.
const temp = path.resolve(destination) + '.' + randomUUID() + '.tmp';
const input = await open(source, 'r');
let output, count = 0;
const recent = [], latencies = [];
try {
  output = await open(temp, 'wx');
  for await (const line of input.readLines()) {
    if (!line.trim()) continue;
    count++;
    let ticket;
    try { ticket = parseTicket(JSON.parse(line.replace(/^\uFEFF/u, ''))); } catch (error) { throw new Error(`Invalid input at record ${count}: ${error.message}`); }
    const result = triage(ticket, { corpus: ruleCorpus, recent });
    latencies.push(result.meta.elapsed_ms);
    await output.write(JSON.stringify({ ...(ticket.ticket_id ? { ticket_id: ticket.ticket_id } : {}), ...result }) + '\n');
    if (ticket.reporter_hash && ticket.created_at) recent.push({ id: ticket.ticket_id ?? String(count), reporter: ticket.reporter_hash, time: Date.parse(ticket.created_at), signature: ticketSignature(ticket) });
    if (recent.length > 10000) recent.shift();
  }
  await output.close(); output = undefined;
  await rename(temp, destination);
} catch (error) { await output?.close(); await unlink(temp).catch(() => {}); throw error; }
finally { await input.close(); }
latencies.sort((a, b) => a - b);
console.log(JSON.stringify({ records: count, apiCalls: 0, apiCostUsd: 0, processorP95Ms: latencies[Math.max(0, Math.ceil(count * .95) - 1)] ?? null, mode: 'local', corpusVersion: ruleCorpus.version, note: 'Processor timing excludes HTTP and infrastructure costs.' }));
