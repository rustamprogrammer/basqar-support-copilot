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

/** Stable glossary identities; these are lookup keys, never invented rule refs. */
export function glossaryTerms(text: string): string[] {
  const t = text.toLowerCase();
  const found = new Set<string>();
  const aliases: [string, RegExp][] = [
    ['roleplay', /(?<!\p{L})(?:rp|рп|role[ -]?play)(?!\p{L})/iu],
    ['nonroleplay', /(?<!\p{L})(?:non[ -]?rp|нон[ -]?рп|нрп|non[ -]?role[ -]?play)(?!\p{L})/iu],
    ['incharacter', /(?<!\p{L})(?:ic|ис|in[ -]?character)(?!\p{L})/iu],
    ['outofcharacter', /(?<!\p{L})(?:ooc|оос|out[ -]?of[ -]?character)(?!\p{L})/iu],
    ['metagaming', /(?<!\p{L})(?:mg|мг|meta[ -]?g[aа]ming|метагейминг)(?!\p{L})/iu],
    ['powergaming', /(?<!\p{L})(?:pg|пг|power[ -]?gaming|пауэргейминг)(?!\p{L})/iu],
    ['deathmatch', /(?<!\p{L})(?:dm|дм|death[ -]?match)(?!\p{L})/iu],
    ['driveby', /(?<!\p{L})(?:db|дб|drive[ -]?by)(?!\p{L})/iu],
    ['spawnkill', /(?<!\p{L})(?:sk|ск|spawn[ -]?kill)(?!\p{L})/iu],
    ['revengekill', /(?<!\p{L})(?:rk|рк|revenge[ -]?kill)(?!\p{L})/iu],
    ['teamkill', /(?<!\p{L})(?:tk|тк|team[ -]?kill)(?!\p{L})/iu],
  ];
  for (const [term, pattern] of aliases) if (pattern.test(t)) found.add(term);
  // Conceptual multilingual queries need both an external information source
  // and using that knowledge in character. "Discord does not open" is not MG.
  const external = /discord|дискорд|outside (?:the )?game|вне игры|fuera del juego|fora do jogo|ойыннан тыс|o'yindan tashqari|ooc/iu.test(t);
  const knowledge = /информац|узна|сведени|information|learn|heard|informaci[oó]n|informaç|saber|мәлімет|ақпарат|ma'lumot/iu.test(t);
  const character = /персонаж|character|personaje|personagem|кейіпкер|qahramon|(?<!\p{L})ic(?!\p{L})/iu.test(t);
  if (external && knowledge && character) found.add('metagaming');
  const death = /смерт|умер|death|died|muer[ts]|morri|morte|өлген|өлді|o'lg|vafot/iu.test(t);
  const returnOrRevenge = /вернуть|возвра|отомст|месть|return|go back|revenge|volver|regresar|venganza|voltar|vingan|қайта|кек|qayt|qasos/iu.test(t);
  if (death && returnOrRevenge) found.add('revengekill');
  if (found.has('nonroleplay')) found.delete('roleplay');
  return [...found];
}

export function retrieveRules(text: string, category: Category, corpus: Corpus, limit = 3): RuleChunk[] {
  if (category === 'report.offtopic' || category === 'report.payment') return [];
  // Lexical similarity alone pulled event-specific rules into ordinary reports.
  // Restrict candidates by section and actual rule content before ranking.
  const source = text.toLowerCase();
  const terms = glossaryTerms(text);
  const candidates = corpus.chunks.filter(chunk => {
    const general = /общие правила|тестов/iu.test(chunk.section);
    const body = chunk.text.toLowerCase();
    if (category === 'report.question') {
      if (!/RP термины/iu.test(chunk.section)) return false;
      const heading = body.split(/[—–(]/u)[0].replaceAll('а', 'a').replace(/[^a-z]/gu, '');
      return terms.includes(heading);
    }
    if (category === 'complaint.insult') return general && (/расизм|дискримин/iu.test(source) ? /дискримин|национальн|расизм/iu.test(body) : /оскорблен|оскорбля/iu.test(body));
    if (category === 'complaint.cheat') return general && /стороннее программное|стороннего программного|читы/iu.test(body);
    if (category === 'report.account') return general && /сохранность|сохранност/iu.test(body);
    if (category === 'complaint.scam') return general && (/вымога|угрож/iu.test(source) ? /вымогательств/iu.test(body) : /мошенничеств/iu.test(body));
    if (category === 'complaint.rmt_ads') return general && (/за реал|rmt|реальн/iu.test(source) ? /реальные деньги/iu.test(body) : /реклам/iu.test(body));
    if (category === 'complaint.admin') return general && /жалобы на администраторов/iu.test(body);
    if (category === 'complaint.dm') {
      if (/RP термины/iu.test(chunk.section)) {
        const code = /(?<!\p{L})(?:дб\p{L}*|db)(?!\p{L})|машин.{0,20}дав/iu.test(source) ? 'DriveBy' : /(?<!\p{L})(?:тк|tk)(?!\p{L})/iu.test(source) ? 'Team Kill' : /(?<!\p{L})(?:ск|sk)(?!\p{L})/iu.test(source) ? 'Spawn Kill' : 'DeathMatch';
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
