import { mapEditableParts } from "./game-language.ts";
import { normalizeRobustInput } from "./robust-input-normalization.ts";

export type InputScriptChange = {
  source: string;
  target: string;
  kind: "transliteration" | "keyboard-layout" | "mixed-script" | "spelling" | "spacing" | "repetition";
  language: "ru" | "kk" | "uk" | "uz" | "und";
};
type Entry = Omit<InputScriptChange, "source"> & { contextual?: boolean };
const entries = new Map<string, Entry>();
const canonicalWords = new Map<string, Entry>();
const key = (text: string) => text.toLowerCase().replace(/[ \t]+/gu, " ");
const add = (source: string, entry: Entry) => entries.set(key(source), entry);

// Generate *aliases of known entries*, never a transliteration of arbitrary input.
const ruKeys = "ёйцукенгшщзхъфывапролджэячсмитьбю";
const enKeys = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const keyboard = new Map([...ruKeys].map((letter, i) => [letter, enKeys[i]]));
function layoutAlias(source: string, target: string, language: Entry["language"]) {
  if (!(language === "uk" ? /^[а-яіїєґ \t]+$/u : /^[а-яё \t]+$/u).test(source)) return;
  const ukrainianKeys: Record<string, string> = {і:"s", ї:"]", є:"'", ґ:"\\"};
  const alias = [...source].map(letter => (language === "uk" ? ukrainianKeys[letter] : undefined) ?? keyboard.get(letter) ?? letter).join("");
  add(alias, { target, language, kind: "keyboard-layout", contextual: /[\[\];',.`]/u.test(alias) });
}
function words(language: Entry["language"], rows: [string, string][]) {
  for (const [target, variants] of rows) {
    const entry: Entry = { target, language, kind: "transliteration" };
    for (const source of variants.split("|")) add(source, entry);
    if (/^[\p{L}]+$/u.test(target)) canonicalWords.set(target, entry);
    if (language === "ru" || language === "uk") layoutAlias(target, target, language);
  }
}

words("ru", [
  ["помогите", "pomogite|pomagite|pamagite"], ["помоги", "pomogi|pomagi"],
  ["помощь", "pomoshch|pomosch|pomosh|pomoshh"], ["пожалуйста", "pozhaluysta|pozhaluista|pozaluysta"],
  ["срочно", "srochno"], ["спасите", "spasite"], ["застрял", "zastryal|zastrial"],
  ["застряла", "zastryala|zastriala"], ["вытащите", "vytashchite|vytaschite|vitashite"],
  ["почините", "pochinite"], ["переверните", "perevernite"], ["верните", "vernite"],
  ["телепортируйте", "teleportiruyte|teleportiruite"], ["разбаньте", "razbante"],
  ["проверьте", "proverte"], ["посмотрите", "posmotrite"], ["рассмотрите", "rassmotrite|rasmotrite"],
  ["разберитесь", "razberites"], ["жалоба", "zhaloba|jaloba"], ["жалобу", "zhalobu|jalobu"],
  ["игрок", "igrok"], ["меня", "menya|menia"], ["пароль", "parol"],
  ["ошибка", "oshibka"], ["почему", "pochemu"], ["зачем", "zachem"],
  ["убил", "ubil"], ["убили", "ubili"], ["убивают", "ubivayut|ubivaiut"],
  ["обманули", "obmanuli"], ["стреляет", "strelyaet|streliaet"],
  ["не могу", "ne mogu"], ["не работает", "ne rabotaet"], ["не получается", "ne poluchaetsya|ne poluchaetsia"],
  ["не могу войти", "ne mogu voiti|ne mogu voyti"], ["не могу зайти", "ne mogu zaiti|ne mogu zayti"],
  ["не могу выйти", "ne mogu vyiti|ne mogu vyyti"], ["нужна помощь", "nuzhna pomoshch|nuzhna pomosh|nuzhna pomoshh"],
  ["мне нужна помощь", "mne nuzhna pomoshch|mne nuzhna pomosh"],
  ["у меня", "u menya|u menia"], ["что делать", "chto delat"],
  ["что такое", "chto takoe"], ["что значит", "chto znachit"],
  ["как подать жалобу", "kak podat zhalobu|kak podat jalobu"],
  ["где подать жалобу", "gde podat zhalobu|gde podat jalobu"],
  ["как восстановить пароль", "kak vosstanovit parol"],
  // Attribution and negation are complete phrases, never the English on/he/no.
  ["он написал", "on napisal"], ["она написала", "ona napisala"],
  ["он сказал", "on skazal"], ["она сказала", "ona skazala"],
  ["игрок написал", "igrok napisal"], ["игрок сказал", "igrok skazal"],
  ["это цитата", "eto tsitata|eto citata"], ["не называй", "ne nazyvay|ne nazyvai"],
  ["я не называл", "ya ne nazyval"], ["он не называл", "on ne nazyval"],
  ["он не написал", "on ne napisal"], ["я не оскорблял", "ya ne oskorblyal|ya ne oskorblial"],
  ["не оскорбляй", "ne oskorblyay|ne oskorbliai"], ["не убил", "ne ubil"],
  ["не убивали", "ne ubivali"], ["я не убивал", "ya ne ubival"],
  ["меня не убивали", "menya ne ubivali"], ["не стреляй", "ne strelyay|ne streliai"],
]);

// A recognized positive word must not lose an adjacent transliterated negation.
// This is a finite phrase grammar: bare English/Uzbek `ne` is never rewritten.
for (const [source, entry] of [...entries]) {
  if (entry.language !== "ru" || entry.kind !== "transliteration" || !/^[a-z]+$/u.test(source) || /\s/u.test(entry.target)) continue;
  const target = `не ${entry.target}`;
  add(`ne ${source}`, { ...entry, target });
  layoutAlias(target, target, "ru");
}

words("kk", [
  ["көмек", "komek|kömek|kómek"], ["көмектес", "komektes|kömektes"],
  ["көмектесіңіз", "komektesiniz|kömektesiniz|kömektesiñiz"],
  ["маған көмек керек", "magan komek kerek|maghan komek kerek|mağan kömek kerek"],
  ["маған көмектес", "magan komektes|mağan kömektes"], ["көмек керек", "komek kerek|kömek kerek"],
  ["кіре алмаймын", "kire almaimyn|kire almaymyn|kire almaimin"],
  ["жұмыс істемейді", "zhumys istemeidi|jumys istemeidi|jumys istemeydi"],
  ["тұрып қалдым", "turyp qaldym|turyp kaldym"], ["себепсіз", "sebepsiz|sebepsız"],
  ["мені өлтірді", "meni oltirdi|meni öltirdi"], ["мені ұрып жатыр", "meni uryp jatyr|meni uryp zhatyr"],
  ["мен өлтірмедім", "men oltirmedim|men öltirmedim"],
  ["келіспеймін", "kelispeimin|kelispeimyn|kelispeymyn"],
  ["қайта қараңыз", "qaita qaranyz|qayta qaranyz"],
]);
// Exact Kazakh words typed without national letters. Never infer letters from digits.
for (const [source, target] of [
  ["комек", "көмек"], ["комектес", "көмектес"], ["комектесиниз", "көмектесіңіз"],
  ["маган комек керек", "маған көмек керек"], ["кире алмаймын", "кіре алмаймын"],
  ["жумыс истемейди", "жұмыс істемейді"], ["турып калдым", "тұрып қалдым"],
]) {
  const entry: Entry = { target, language: "kk", kind: "keyboard-layout" };
  add(source, entry);
  if (/^[\p{L}]+$/u.test(source)) canonicalWords.set(source, entry);
  layoutAlias(source, target, "kk");
}
add("komектес", { target: "көмектес", language: "kk", kind: "mixed-script" });
add("komектесиниз", { target: "көмектесіңіз", language: "kk", kind: "mixed-script" });
add("рудз", { target: "хелп", language: "ru", kind: "keyboard-layout" });

words("uk", [
  ["допоможіть", "dopomozhit|dopomozhitʹ|dopomozhitj|dopomozhyt"],
  ["допоможи", "dopomozhy"], ["допомога", "dopomoha|dopomoga"],
  ["не можу зайти", "ne mozhu zaity|ne mozhu zayty"],
  ["не працює", "ne pratsiuie|ne pracyuye|ne pratsyuye"],
  ["будь ласка", "bud laska|budlaska"], ["застряг", "zastriah|zastryag"],
  ["гравець написав", "gravets napysav|hravets napysav"],
  ["він написав", "vin napysav"], ["він сказав", "vin skazav"],
  ["я не ображав", "ya ne obrazhav"], ["не називай", "ne nazyvai"],
]);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[...entries.keys()].sort((a, b) => b.length - a.length).map(source => escape(source).replaceAll(" ", "[ \\t]+")).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
const visualLetters: Record<string, string> = { a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", k: "к", m: "м", t: "т", b: "в", h: "н" };
const recase = (source: string, target: string) => {
  const letters = source.match(/\p{L}/gu) ?? [];
  if (letters.length && letters.every(letter => letter === letter.toUpperCase())) return target.toUpperCase();
  return /^\p{Lu}/u.test(source) ? target[0].toUpperCase() + target.slice(1) : target;
};

export function normalizeInputScripts(text: string): { text: string; changes: InputScriptChange[] } {
  const changes: InputScriptChange[] = [];
  const shortenRepeats = (part: string) => part.replace(/(\p{L})\1{9,}/gu, source => {
    const target = [...source][0].repeat(3);
    changes.push({ source, target, kind: "repetition", language: "und" });
    return target;
  });
  // Pure character flooding must not first enter the identifier/URL patterns,
  // whose repeated scans of a very long token would block a whole batch. Keep
  // all original evidence in the caller's received step; never call this abuse.
  if (/^\s*(\p{L})\1{9,}\s*$/u.test(text)) return { text: shortenRepeats(text), changes };
  // Preserve single-quoted evidence too; a lone apostrophe inside a keyboard word
  // is not a quote. Explicit bare nick/login values are kept as identifiers.
  const protectedExtra = /((?<![\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])|(?<![\p{L}\p{N}_])(?:ник|нік|логин|логін|nickname|nick|nik|login)(?:\s*[:=]\s*|\s+)[\p{L}\p{N}_-]+)/giu;
  const normalized = mapEditableParts(text, part => part.split(protectedExtra).map((editable, index) => {
    if (index % 2) return editable;
    editable = shortenRepeats(editable);
    const candidates: { start: number; end: number; source: string; entry: Entry }[] = [];
    for (const match of editable.matchAll(pattern)) candidates.push({ start: match.index!, end: match.index! + match[0].length, source: match[0], entry: entries.get(key(match[0]))! });
    for (const match of editable.matchAll(/[\p{L}]+/gu)) {
      if (!/[a-z]/iu.test(match[0]) || !/[а-яёәғқңөұүһіїєґ]/iu.test(match[0])) continue;
      const folded = match[0].toLowerCase().replace(/[a-z]/gu, letter => visualLetters[letter] ?? letter);
      const entry = canonicalWords.get(folded);
      if (entry) candidates.push({ start: match.index!, end: match.index! + match[0].length, source: match[0], entry: { ...entry, kind: "mixed-script" } });
    }
    candidates.sort((a, b) => a.start - b.start || b.end - a.end);
    let result = "", end = 0;
    for (const candidate of candidates) {
      if (candidate.start < end) continue;
      if (candidate.entry.contextual) {
        const standalone = /^[\s!?.,;:()]*$/u.test(editable.slice(0, candidate.start) + editable.slice(candidate.end));
        const nearby = candidates.some(other => other !== candidate && !other.entry.contextual && Math.abs(other.start - candidate.start) < 70 && !/[.!?;\n]/u.test(editable.slice(Math.min(other.end, candidate.end), Math.max(other.start, candidate.start))));
        const context = (editable.slice(0, candidate.start).split(/[.!?;\n]/u).at(-1) ?? "").slice(-70) + editable.slice(candidate.end).split(/[.!?;\n]/u)[0].slice(0, 70);
        if (!standalone && !nearby && !/[а-яёәғқңөұүһіїєґ]/iu.test(context)) continue;
      }
      const target = recase(candidate.source, candidate.entry.target);
      result += editable.slice(end, candidate.start) + target;
      changes.push({ source: candidate.source, target, kind: candidate.entry.kind, language: candidate.entry.language });
      end = candidate.end;
    }
    return result + editable.slice(end);
  }).join(""));
  const robust = normalizeRobustInput(normalized);
  return { text: robust.text, changes: [...changes, ...robust.changes] };
}
