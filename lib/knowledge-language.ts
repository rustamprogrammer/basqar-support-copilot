// Curated forms for glossary lookup only. Never stem arbitrary text or use edit
// distance on short codes: ДМ and ДБ are distinct concepts.
const families: [string[], string[]][] = [
  [['дм', 'dm'], ['дмить', 'дмит', 'дмят', 'дмил', 'дмила', 'дмили', 'дмлю', 'дмишь', 'дмити', 'дмлять', 'dmit', 'dmitj', 'dmitь']],
  [['дб', 'db'], ['дбшить', 'дбшит', 'дбшат', 'дбшут', 'дбшил', 'дбшили', 'дбить', 'дбити', 'дбшити', 'dbshit', 'dbshить']],
  [['ск', 'sk'], ['скшить', 'скшит', 'скшат', 'скшил', 'скшили', 'скить', 'скшити', 'skshit']],
  [['тк', 'tk'], ['ткшить', 'ткшит', 'ткшат', 'ткшил', 'ткшили', 'ткашить', 'ткшити', 'tkshit']],
  [['рк', 'rk'], ['ркшить', 'ркшит', 'ркшат', 'ркшил', 'ркшили', 'ркашить', 'ркшити', 'rkshit']],
  [['мг', 'mg'], ['мгшить', 'мгшит', 'мгшат', 'мгшил', 'мгшили', 'метагеймить', 'мгшити', 'mgshit']],
  [['пг', 'pg'], ['пгшить', 'пгшит', 'пгшат', 'пгшил', 'пгшили', 'пгшити', 'pgshit']],
  [['рп', 'rp'], ['рпшить', 'рпшит', 'рпшат', 'рпшили', 'рпшити', 'rpshit', 'ролеплеить']],
  [['афк', 'afk'], ['афкшить', 'афкашить', 'афкать', 'афкает', 'афкшити', 'afkshit']],
  [['флуд', 'flood'], ['флудить', 'флудит', 'флудят', 'флудил', 'флудили', 'флудити', 'fludit']],
  [['скам', 'scam'], ['скамить', 'скамит', 'скамят', 'заскамить', 'заскамил', 'заскамили', 'скамити', 'skamit']],
  [['багоюз', 'багюз'], ['багоюзить', 'багоюзит', 'багоюзят', 'багюзить', 'багоюзити', 'bagoyuzit']],
  [['чит', 'читы', 'cheat'], ['читерить', 'читерит', 'читерят', 'читерили', 'читерити', 'chiterit']],
];

const actionCodes = new Set(['дм', 'dm', 'дб', 'db', 'ск', 'sk', 'тк', 'tk', 'рк', 'rk', 'мг', 'mg', 'пг', 'pg', 'рп', 'rp']);

export function definitionAliasForms(alias: string): string[] {
  const normalized = alias.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').trim();
  const family = families.find(([codes]) => codes.includes(normalized));
  const codes = family?.[0] ?? [normalized];
  const forms = [normalized, ...codes, ...(family?.[1] ?? [])];
  for (const code of codes) if (actionCodes.has(code)) {
    forms.push(`${code} qilish`, `${code} qilmoq`, `${code} жасау`, `${code} істеу`);
    // Mixed Latin code + Cyrillic suffix, as players actually type it.
    if (/^[a-z]+$/u.test(code)) forms.push(`${code}ить`, `${code}ят`, `${code}шить`, `${code}шит`);
  }
  return [...new Set(forms)];
}

// A word such as «дмят» can be the subject of a definition. It is not by itself
// evidence of a personal incident; the whole-question matcher still rejects
// extra clauses, participants, requests for intervention and permission.
export const definitionActionWords = new Set(families.flatMap(([, words]) => words));
