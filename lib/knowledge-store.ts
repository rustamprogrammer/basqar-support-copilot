import { getDb } from '@/db';
import { knowledgeEntries } from '@/db/schema';
import { KNOWLEDGE_ENTRIES, type KnowledgeEntry } from './knowledge-base.ts';
export async function loadKnowledge(): Promise<KnowledgeEntry[]> {
  const entries = new Map<string, KnowledgeEntry>(KNOWLEDGE_ENTRIES.map(entry => [entry.id, entry]));
  const overrides = await getDb().select().from(knowledgeEntries);
  for (const row of overrides) entries.set(row.id, row.entry as KnowledgeEntry);
  return [...entries.values()];
}
export function validateKnowledge(value: unknown): KnowledgeEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as KnowledgeEntry;
  const string = (x: unknown, max: number) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
  const words = (x: unknown, required = false) => Array.isArray(x) && x.length <= 80 && (!required || x.length > 0) && x.every(v => string(v, 300));
  if (!string(entry.id, 80) || !/^[a-z0-9-]+$/.test(entry.id) || !string(entry.title, 160) || !string(entry.answer, 4000)
    || !words(entry.aliases, true) || (entry.requiredTerms !== undefined && !words(entry.requiredTerms)) || (entry.excludedTerms !== undefined && !words(entry.excludedTerms))
    || !['published', 'draft', 'retired'].includes(entry.status) || !entry.source
    || typeof entry.source.title !== 'string' || entry.source.title.length > 300 || typeof entry.source.version !== 'string' || entry.source.version.length > 100
    || (entry.status === 'published' && (!string(entry.source.title, 300) || !string(entry.source.version, 100)))
    || (entry.source.ref !== undefined && !string(entry.source.ref, 160))) return null;
  return { id: entry.id, version: `${new Date().toISOString()}-${crypto.randomUUID().slice(0, 8)}`, title: entry.title.trim(), answer: entry.answer.trim(), aliases: entry.aliases.map(s => s.trim()),
    requiredTerms: entry.requiredTerms ?? [], excludedTerms: entry.excludedTerms ?? [], status: entry.status,
    ...(entry.questionKind === 'definition' || entry.questionKind === 'permission' ? { questionKind: entry.questionKind } : {}),
    source: { title: entry.source.title.trim(), version: entry.source.version.trim(), ...(entry.source.ref ? { ref: entry.source.ref.trim() } : {}) } };
}
