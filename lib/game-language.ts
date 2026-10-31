// Curated display forms, not definitions: keep the vocabulary administrators use.
// Do not fuzzy-match short codes: DM and DB differ by one letter but mean different things.
const forms: [string, string][] = [
  ["ДМ", "дм dm дm dм deathmatch"], ["ДБ", "дб db driveby"],
  ["СК", "ск sk spawnkill"], ["ТК", "тк tk teamkill"], ["РК", "рк rk"],
  ["РП", "рп rp рp pп roleplay"], ["НРП", "нрп нонрп nrp nonrp"], ["УРП", "урп"],
  ["МГ", "мг mg metagaming"], ["ПГ", "пг pg powergaming"],
  ["IC", "ic иц"], ["OOC", "ooc оос"], ["ГЗ", "гз gz greenzone"], ["ЗЗ", "зз"],
  ["АФК", "афк afk"], ["ТП", "тп tp"], ["ХП", "хп hp"], ["PvP", "пвп pvp"],
  ["ФВ", "фв fw"], ["БВ", "бв bw"], ["ОП", "оп op"], ["ЖБ", "жб"],
  ["ДМГ", "дмг дмрг"],
  ["ОПГ", "опг"], ["МВД", "мвд"], ["ФСБ", "фсб"], ["МЗ", "мз"], ["СМИ", "сми"],
  ["ВЧ", "вч"], ["ГА", "га"], ["ЗГА", "зга"], ["ГС", "гс"], ["ЗГС", "згс"],
  ["ЛД", "лд"], ["КПЗ", "кпз"], ["ЧС", "чс"], ["ТС", "тс"], ["НПС", "нпс npc"],
  ["ДМит", "дмит деемит"], ["ДМят", "дмят деемят"], ["ДМить", "дмить"], ["ДМил", "дмил"],
  ["ДМили", "дмили"], ["ДМила", "дмила"], ["ДМлю", "дмлю"], ["ДМишь", "дмишь"],
  ["ДБшит", "дбшит дбешит"], ["ДБшат", "дбшат дбшут"], ["ДБшил", "дбшил дбешил"],
  ["ДБшили", "дбшили"], ["ДБшить", "дбшить"], ["РКшил", "ркшил ркашил"], ["ТКшит", "ткшит ткашит"],
];
const aliases = new Map(forms.flatMap(([display, variants]) => variants.split(" ").map(variant => [variant, display] as const)));
const ordinary: Record<string, string> = {
  osk: "оск", ock: "оск", osc: "оск", "оcк": "оск", "oск": "оск", "ocк": "оск",
  fraps: "фрапс", soft: "софт", ban: "бан", mute: "мут", warn: "варн", jail: "джаил",
  spec: "спек", scam: "скам", help: "хелп", "хэлп": "хелп", cop: "коп", nonrpcop: "НРП коп",
};
export const atWord = (pattern: string, flags = "iu") => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, flags);

export function keepCase(source: string, replacement: string) {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  return source[0] === source[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
}

// Whole-token grammar only: no arbitrary segmentation of names or unfamiliar words.
const action = "дмят|дмили|дмить|дмит|дмил|дмила|дмлю|дмишь|дбшили|дбшить|дбшит|дбшил|дбшат|оскает|оскал|оскнул|скамит|заскамил|дм|dm|дб|db|тк|tk|ск|sk|рк|rk|оск|osk";
const joined = new RegExp(`^(меня|мне|он|она|они|игрок|тут|здесь)?(не)?(${action})(взз|вгз|vgz|вgz|зз|гз|gz|наспавне|безпричины|безрп|родни|родных|родителей|админа)?$`, "iu");
const tails: Record<string, string> = {
  взз: "в ЗЗ", вгз: "в ГЗ", vgz: "в ГЗ", "вgz": "в ГЗ", зз: "ЗЗ", гз: "ГЗ", gz: "ГЗ",
  наспавне: "на спавне", безпричины: "без причины", безрп: "без РП",
  родни: "родни", родных: "родных", родителей: "родителей", админа: "админа",
};
const supportActions = "помогите|помоги|вытащите|вытащи|почините|почини|переверните|переверни|тепните|телепортируйте|спасите";
const joinedSupport = new RegExp(`^(админ|админы)?(${supportActions})(мне|меня|нам|нас)?(пж|пожалуйста)?$`, "iu");
function displayWord(token: string): string {
  const lower = token.toLowerCase();
  const acronym = aliases.get(lower);
  if (acronym) return acronym;
  // Repetition is allowed only for the final letter of an exact two-letter code.
  // Never use edit distance between codes: ДМ and ДБ must remain distinct.
  const repeated = /^(дм{2,6}|дб{2,6}|тк{2,6}|ск{2,6}|рк{2,6}|dm{2,6}|db{2,6}|tk{2,6}|sk{2,6}|rk{2,6})$/iu.exec(token);
  if (repeated) return displayWord(token.slice(0, 2));
  // Only the final repeated letter of these complete pleas is optional.
  if (/^помогите{2,6}$/iu.test(token)) return keepCase(token, "помогите");
  if (/^пж{2,6}$/iu.test(token)) return keepCase(token, "пж");
  if (ordinary[lower]) return keepCase(token, ordinary[lower]);
  const support = joinedSupport.exec(token);
  if (support && (support[1] || support[3] || support[4])) {
    return keepCase(token, support.slice(1).filter(Boolean).join(" ").toLowerCase());
  }
  const nonRp = /^(?:нонрп|нрп|nonrp|nrp)(коп|гос|cop|kop)$/iu.exec(token);
  if (nonRp) return `НРП ${/^(cop|kop)$/iu.test(nonRp[1]) ? "коп" : nonRp[1].toLowerCase()}`;
  const pair = /^(дм|dm|дб|db|тк|tk|ск|sk|рк|rk)(и|плюс)(дм|dm|дб|db|тк|tk|ск|sk|рк|rk)$/iu.exec(token);
  if (pair) return `${displayWord(pair[1])} ${pair[2].toLowerCase()} ${displayWord(pair[3])}`;
  const match = joined.exec(token);
  if (match && (match[1] || match[2] || match[4])) {
    return [match[1]?.toLowerCase(), match[2]?.toLowerCase(), displayWord(match[3]), tails[match[4]?.toLowerCase()]].filter(Boolean).join(" ");
  }
  const plea = /^(.*?)(помогите|помоги|пожалуйста|пж)$/iu.exec(token);
  if (plea && joined.test(plea[1])) {
    const core = displayWord(plea[1]);
    return `${core} ${plea[2].toLowerCase()}`;
  }
  return token;
}

export function normalizeGameText(text: string) {
  // In Uzbek, `db` can abbreviate `deb` ("saying/as"). Do not turn it into drive-by.
  // Scope the hint to the nearby clause, rather than leaking it through the message.
  const source = text.replace(atWord("(?:нон[ \\t-]+рп|non[ \\t-]+rp)", "giu"), "НРП");
  return source.replace(atWord("[\\p{L}]+", "gu"), (token: string, offset: number) => {
    if (token.toLowerCase() === "db") {
      const left = source.slice(0, offset).split(/[.!?;\n]/u).at(-1)!.match(/[\p{L}]+/gu)?.slice(-4).join(" ") ?? "";
      const right = source.slice(offset + token.length).split(/[.!?;\n]/u)[0].match(/[\p{L}]+/gu)?.slice(0, 4).join(" ") ?? "";
      if (/\b(?:qaysi|qoidada|nega|meni|menga|uchun|etgan|berdi|degan|kere|kerak)\b/iu.test(`${left} ${right}`)) return token;
    }
    return displayWord(token);
  });
}

// Only a complete numeric ID followed by an exact, known action is segmented.
// Names, commands, quoted evidence and alphanumeric identifiers stay protected.
export function separateIdAction(text: string) {
  const known = new RegExp(`^(\\d{1,6})(дм|dm|дб|db|тк|tk|ск|sk|рк|rk|дмит|дмят|дбшит|${supportActions}|спек|следите|проследите)(пж|пожалуйста)?$`, "iu");
  return text.split(protectedPattern).map((part, index, parts) => {
    if (index % 2 === 0) return part;
    const match = known.exec(part);
    if (match && /^db$/iu.test(match[2]) && /^\s+(?:etgan|degan|etib)(?![\p{L}\p{N}_])/iu.test(parts[index + 1] || "")) return part;
    return match ? [match[1], displayWord(match[2]), match[3]?.toLowerCase()].filter(Boolean).join(" ") : part;
  }).join("");
}

// Numeric characters usually identify protected names/IDs. The only spelling
// exception is this complete known plea; never replace digits globally.
export function repairKnownMixedWords(text: string) {
  return text.split(protectedPattern).map((part, index) => index % 2 && /^помо6ите$/iu.test(part)
    ? keepCase(part, "помогите") : part).join("");
}

// Protect spelling inside evidence, handles, nicknames and identifiers, even when it looks like slang.
const protectedPattern = /(```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)|https?:\/\/[^\s]+|www\.[^\s]+|\/[\p{L}\p{N}][\p{L}\p{N}_]*|[\p{L}\p{N}_.+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|@[\p{L}\p{N}_]+|«[^»]*(?:»|$)|"[^"]*(?:"|$)|“[^”]*(?:”|$)|<[^>]+>|[\p{L}\p{N}_-]*\d[\p{L}\p{N}_-]*|[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+)/giu;
export function mapEditableParts(text: string, edit: (part: string) => string) {
  return text.split(protectedCommandArguments).map((block, index) => index % 2 ? block
    : block.split(protectedPattern).map((part, partIndex) => partIndex % 2 ? part : edit(part)).join("")).join("");
}
export function contextText(text: string) {
  return text.replace(protectedCommandArguments, " ").replace(protectedPattern, " ").normalize("NFKC");
}
// Values following identity commands are data, even when they resemble vocabulary.
const protectedCommandArguments = /(\/(?:setnick|nick|changename|login|register)[ \t]+[^\s]+)/giu;
