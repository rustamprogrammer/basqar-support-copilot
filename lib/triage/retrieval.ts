import type { Corpus, RuleChunk, Category } from './types.ts';

export function validateCorpus(value: unknown): Corpus {
  const c = value as Corpus;
  if (!c || typeof c.version !== 'string' || typeof c.source !== 'string' || !Array.isArray(c.chunks)) throw new Error('Invalid rules corpus.');
  const ids = new Set<string>();
  for (const item of c.chunks) {
    if (!item || !['id', 'section', 'ref', 'text'].every(key => typeof item[key as keyof RuleChunk] === 'string' && item[key as keyof RuleChunk].trim()) || ids.has(item.id)) throw new Error('Invalid or duplicate rule ID.');
    ids.add(item.id);
  }
  return c;
}

const topicQueries: Partial<Record<Category, string>> = {
  'complaint.insult': 'оскорбление личности родственников', 'complaint.cheat': 'стороннего программного обеспечения читы',
  'complaint.dm': 'DeathMatch убийство урон', 'complaint.scam': 'мошенничество махинации имуществом',
  'complaint.rmt_ads': 'реклама реальные деньги', 'complaint.admin': 'жалобы администраторов',
  'report.account': 'сохранность аккаунта имущества', 'report.help': 'администрации помощь',
};
const words = (text: string) => text.toLowerCase().replaceAll('ё', 'е').match(/[\p{L}]{3,}/gu)?.map(s => s.length > 6 ? s.slice(0, -2) : s) ?? [];
export function retrieveRules(text: string, category: Category, corpus: Corpus, limit = 3): RuleChunk[] {
  if (category === 'report.offtopic' || category === 'report.payment' || category === 'report.question') return [];
  // Lexical similarity alone pulled event-specific rules into ordinary reports.
  // Restrict candidates by section and actual rule content before ranking.
  const source = text.toLowerCase();
  const candidates = corpus.chunks.filter(chunk => {
    const general = /общие правила|тестов/iu.test(chunk.section);
    const body = chunk.text.toLowerCase();
    if (category === 'complaint.insult') return general && (/расизм|дискримин/iu.test(source) ? /дискримин|национальн|расизм/iu.test(body) : /оскорблен|оскорбля/iu.test(body));
    if (category === 'complaint.cheat') return general && /стороннее программное|стороннего программного|читы/iu.test(body);
    if (category === 'report.account') return general && /сохранность|сохранност/iu.test(body);
    if (category === 'complaint.scam') return general && (/вымога|угрож/iu.test(source) ? /вымогательств/iu.test(body) : /мошенничеств/iu.test(body));
    if (category === 'complaint.rmt_ads') return general && (/за реал|rmt|реальн/iu.test(source) ? /реальные деньги/iu.test(body) : /реклам/iu.test(body));
    if (category === 'complaint.admin') return general && /жалобы на администраторов/iu.test(body);
    if (category === 'complaint.dm') {
      if (/RP термины/iu.test(chunk.section)) {
        const code = /(?:^|\W)(?:дб\p{L}*|db)(?:$|\W)|машин.{0,20}дав/iu.test(source) ? 'DriveBy' : /(?:^|\W)(?:тк|tk)(?:$|\W)/iu.test(source) ? 'Team Kill' : /(?:^|\W)(?:ск|sk)(?:$|\W)/iu.test(source) ? 'Spawn Kill' : 'DeathMatch';
        return body.startsWith(code.toLowerCase()) && !/massive/iu.test(body);
      }
      return /зел[её]ной зоне/iu.test(chunk.section) && /(?:зз|гз|green zone|gz)/iu.test(source) && /убийств|урон|нападен|стрельб/iu.test(body);
    }
    // Unknown situations abstain rather than receive an unrelated sanction.
    return false;
  });
  const query = new Set(words(text + ' ' + (topicQueries[category] ?? '')));
  const ranked = candidates.map(chunk => {
    const body = new Set(words(chunk.text));
    const overlap = [...query].filter(token => body.has(token));
    return { chunk, score: overlap.length / Math.sqrt(Math.max(body.size, 1)) };
  }).sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
  return ranked.slice(0, limit).map(x => x.chunk);
}

// Contract citations retain original refs. Internal IDs and metadata disambiguate
// sections; ambiguous refs are not accepted as independently verified citations.
export function citationsExist(ids: string[], allowed: readonly RuleChunk[]) {
  return ids.every(id => allowed.filter(rule => rule.ref === id).length === 1);
}
