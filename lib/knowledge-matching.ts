import { normalizeGameText } from "./game-language.ts";
import { normalizeInputScripts } from "./input-script-normalization.ts";
import { KNOWLEDGE_ENTRIES, type KnowledgeEntry } from "./knowledge-base.ts";
import { definitionAliasForms, definitionActionWords } from './knowledge-language.ts';

export type { KnowledgeEntry } from "./knowledge-base.ts";
export type KnowledgeDecision = {
  status: "answered" | "needs_admin" | "not_applicable";
  reason: string;
  entryId?: string;
  entryVersion?: string;
  answer?: string;
  source?: KnowledgeEntry["source"];
};

const fold = (text: string) => text.normalize("NFKC").toLowerCase().replaceAll("ё", "е")
  .replace(/[’‘`ʼʻ]/gu, "'").replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const phraseCache = new Map<string, RegExp>();
const phrase = (text: string, flags = "u") => {
  const key = flags + ':' + text;
  let pattern = phraseCache.get(key);
  if (!pattern) {
    pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escape(text).replaceAll(" ", "\\s+")}(?![\\p{L}\\p{N}_])`, flags);
    if (phraseCache.size >= 1024) phraseCache.clear();
    phraseCache.set(key, pattern);
  }
  return pattern;
};
const aliasCache = new Map<string, string[]>();
function aliasForms(alias: string) {
  let forms = aliasCache.get(alias);
  if (!forms) {
    forms = [...new Set(definitionAliasForms(alias).flatMap(form => [fold(form), fold(normalizeGameText(form))]))];
    if (aliasCache.size >= 512) aliasCache.clear();
    aliasCache.set(alias, forms);
  }
  return forms;
}

// Whole phrases are deliberate: merely finding a glossary word is never enough.
const definitionPhrases = [
  "это что такое", "это что вообще значит", "это что значит", "это что означает", "это как понять", "это что за действие", "это что", "как понять", "как понимать", "как расшифровать", "что обозначает", "что именно означает", "что игроки называют словом", "что называют", "в чем смысл", "объясните что значит", "объясни что значит", "значение глагола",
  "це що таке", "це що", "як зрозуміти", "бұл не", "деген сөз нені білдіреді",
  "что такое", "что это такое", "что означает", "что значит", "что за термин", "что за слово", "как расшифровывается", "расшифруйте", "расшифруй", "объясните значение", "объясни значение", "объясните", "объясни", "значение термина", "значение слова",
  "що таке", "що означає", "що значить", "як розшифровується", "розшифруй", "поясніть значення", "поясни значення", "поясніть", "поясни",
  "дегеніміз не", "деген не", "нені білдіреді", "мағынасы қандай", "қалай түсіндіріледі", "түсіндіріңіз", "түсіндірші",
  "nima degani", "nimani anglatadi", "qanday izohlanadi", "nima", "tushuntiring", "tushuntir", "degani nima",
  "chto takoe", "shto takoe", "chto znachit", "chto oznachaet", "obyasni", "shcho oznachaye", "shcho take", "degen ne", "дегеніміз", "нені білдіреді",
].sort((a, b) => b.length - a.length);
const courtesyPhrases = ["подскажите пожалуйста", "объясни мне", "объясните мне", "скажите пожалуйста", "можете объяснить", "можешь объяснить", "будь ласка", "пожалуйста", "подскажите", "подскажи", "скажите", "скажи", "підкажіть", "айтыңызшы", "aytingchi", "сәлем", "salom", "привет", "здравствуйте", "пж", "пжлст", "плз", "плиз", "будьласка", "iltimos", "өтінем", "өтінемін"];
const scopePhrases = ["в grand mobile", "v grand mobile", "в гранд мобайл", "в игровом чате", "в игровом жаргоне", "в переписке игроков", "в правилах", "этот игровой глагол", "только значение термина", "в игре", "у грі", "в грі", "ойында", "oyinda", "o yinda", "grand mobile", "простыми словами", "простими словами", "қарапайым тілмен", "oddiy qilib ayting", "термин", "термін", "терминді", "терминін", "atamani", "atamasini", "слово", "глагол", "сокращение", "скорочення", "қысқартуы", "qisqartmasi", "sokrashchenie", "skorochennya", "значение", "значення", "мағынасын", "ma nosini", "manosini"];
const novicePhrases = ['я только начал играть', 'я новичок в игре', 'я новичок', 'я новенький', 'я новенькая', 'я новачок', 'мен жаңадан келдім', 'men yangi o yinchiman'];
const introductoryPhrases = [...novicePhrases, 'я не понимаю', 'я не понял', 'я не поняла', 'я не знаю', 'не понимаю', 'не понял', 'не поняла', 'не знаю', 'никак не разберусь', 'а можно узнать', 'можно узнать', 'блин', 'а'];
const grammarPhrases = [...definitionPhrases, ...courtesyPhrases, ...scopePhrases, ...introductoryPhrases.filter(item => item !== 'а')].sort((a, b) => b.length - a.length);
const grammarWords = [...new Set(grammarPhrases.flatMap(item => item.split(" ")).filter(word => word.length >= 6))];

function oneMissingLetter(source: string, target: string) {
  if (source.length + 1 !== target.length) return false;
  let left = 0;
  while (left < source.length && source[left] === target[left]) left++;
  return source.slice(left) === target.slice(left + 1);
}

function repairQuestionGrammar(text: string) {
  // Repair the small request vocabulary, never game codes, names or arbitrary words.
  let result = text.replace(phrase('што', 'gu'), 'что').replace(phrase('чо', 'gu'), 'что').replace(phrase('че', 'gu'), 'что').replace(phrase('такоее', 'gu'), 'такое').replace(phrase('значет', 'gu'), 'значит');
  result = result.replace(/[\p{L}]+/gu, token => {
    if (token.length < 5 || grammarWords.includes(token)) return token;
    const candidates = grammarWords.filter(word => oneMissingLetter(token, word));
    return candidates.length === 1 ? candidates[0] : token;
  });
  // Restore spaces only inside a known multiword frame. Unknown suffixes remain
  // in the subject and make the final whole-question match fail.
  for (const item of grammarPhrases) {
    if (!item.includes(" ")) continue;
    result = result.replace(phrase(item.replaceAll(" ", ""), "gu"), item);
  }
  return result;
}

// These cannot become a glossary lookup even if a future alias accidentally includes them.
const personalCase = /(?<![\p{L}\p{N}_])(?:меня|мой|моя|мою|моего|мои|моих|застрял[а-я]*|убивают|бьют|стреляют|дмят|дмит|дбшит|напали|помогите|помоги|спасите|сейчас|вчера|сегодня|накажите|забанили|забаньте|разбаньте|не\s+помогло|все\s+равно|не\s+работает|мене|мені|зараз|вбивають|допоможіть|не\s+працює|meni|menga|hozir|yordam|oldiryapti|o\s+ldiryapti|ishlamayapti|мені|маған|қазір|көмектес[\p{L}]*|атып|өлтіріп)(?![\p{L}\p{N}_])/u;
const reportedOrNegated = /(?<![\p{L}\p{N}_])(?:не|нет|ни|нельзя|без|он|она|они|написал[а-я]*|сказал[а-я]*|спросил[а-я]*|если|допустим|почему|чому|не\s+можу|емес|жоқ|emas|yoq|nega)(?![\p{L}\p{N}_])/u;

function separateKnownQuestionWords(text: string, entries: readonly KnowledgeEntry[]) {
  const vocabulary = new Set([...grammarPhrases.flatMap(item => fold(item).split(" ")),
    ...entries.flatMap(entry => entry.aliases.flatMap(aliasForms).filter(alias => /^[\p{L}]{2,20}$/u.test(alias)))]);
  return text.replace(/[\p{L}]+/gu, token => {
    if (vocabulary.has(token) || token.length < 6 || token.length > 60) return token;
    const solutions: string[][] = [];
    function split(rest: string, parts: string[]) {
      if (solutions.length > 1 || parts.length > 3) return;
      if (parts.length && vocabulary.has(rest)) solutions.push([...parts, rest]);
      if (parts.length === 3) return;
      for (let end = 2; end <= rest.length - 2; end++) {
        const part = rest.slice(0, end);
        if (vocabulary.has(part)) split(rest.slice(end), [...parts, part]);
      }
    }
    split(token, []);
    return solutions.length === 1 ? solutions[0].join(" ") : token;
  });
}

function queryForms(original: string, entries: readonly KnowledgeEntry[]) {
  const normalized = normalizeGameText(normalizeInputScripts(original).text);
  const forms = [fold(original), fold(normalized)];
  // «ZZ» is the exact Latin spelling of «ЗЗ», not a fuzzy neighbouring code.
  return [...new Set([...forms, ...forms.map(repairQuestionGrammar)]
    .map(text => separateKnownQuestionWords(text.replace(phrase("zz", "gu"), "зз"), entries))
    .map(stripIntroduction))];
}

function stripIntroduction(text: string) {
  // Prefixes only. Never strip a negative or personal clause elsewhere.
  let result = text;
  for (let pass = 0; pass < 4; pass++) {
    const prefix = [...courtesyPhrases, ...introductoryPhrases].sort((a, b) => b.length - a.length)
      .find(item => result.startsWith(item + ' ') && !item.startsWith('объясни'));
    if (!prefix) break;
    result = result.slice(prefix.length).trim();
  }
  for (const tail of novicePhrases) if (result.endsWith(' ' + tail)) result = result.slice(0, -tail.length).trim();
  return result;
}

function definitionSubject(text: string): string | null {
  let found = false;
  let result = text;
  // Remove polite framing first, but preserve its definition request when present.
  result = result.replace(phrase("объясни мне", "gu"), "объясни").replace(phrase("объясните мне", "gu"), "объясните");
  for (const item of courtesyPhrases) result = result.replace(phrase(item, "gu"), " ");
  for (const item of definitionPhrases) {
    if (phrase(item).test(result)) { found = true; result = result.replace(phrase(item, "gu"), " "); }
  }
  for (const item of scopePhrases) result = result.replace(phrase(item, "gu"), " ");
  result = result.replace(phrase('слова', 'gu'), ' ').replace(phrase('глагола', 'gu'), ' ');
  return found ? result.replace(/\s+/gu, " ").trim() : null;
}

const compactFrames = definitionPhrases.map(item => item.replaceAll(" ", ""));
export function mayAskForDefinition(text: string): boolean {
  const compact = fold(repairQuestionGrammar(fold(text))).replaceAll(' ', '');
  return compactFrames.some(frame => compact.includes(frame));
}
const compactScopes = ["", "в игре", "у грі", "в грі", "ойында", "oyinda", "o yinda"].map(item => item.replaceAll(" ", ""));
function joinedDefinitionSubjects(text: string): string[] {
  // A full known frame + a full known alias may have lost spaces (e.g. a term
  // followed by «дегенне»). Require equality of the whole query, not a substring.
  const compact = text.replaceAll(" ", "");
  if (compact.length > 180) return [];
  const subjects: string[] = [];
  for (const ask of compactFrames) for (const scope of compactScopes) {
    const prefix = scope + ask;
    if (compact.startsWith(prefix)) subjects.push(compact.slice(prefix.length));
    if (compact.startsWith(scope) && compact.endsWith(ask)) subjects.push(compact.slice(scope.length, -ask.length));
    if (scope && compact.startsWith(ask) && compact.endsWith(scope)) subjects.push(compact.slice(ask.length, -scope.length));
  }
  return subjects.filter(Boolean);
}

export function getKnowledgeDecision(
  original: string,
  route: "question" | "help" | "violation" | "trash" | null,
  entries: readonly KnowledgeEntry[] = KNOWLEDGE_ENTRIES,
): KnowledgeDecision {
  if (route !== "question") return { status: "not_applicable", reason: "Готовые справки применяются только к вопросам; обращения за помощью передаются администратору." };
  if (!original.trim() || original.length > 4000) return { status: "needs_admin", reason: "Нужен понятный отдельный вопрос." };
  if (original.includes('🖕')) return { status: 'needs_admin', reason: 'Оскорбительный жест требует проверки обращения; справка автоматически не отправлена.' };
  const forms = queryForms(original, entries);
  // Conditions must still see framing that was removed for intent recognition.
  const conditionForms = [...forms, fold(original), fold(normalizeGameText(normalizeInputScripts(original).text))];
  const hasCondition = (term: string) => aliasForms(term).some(variant => conditionForms.some(text => phrase(variant).test(text)));
  if (forms.some(text => personalCase.test(text.replace(/[\p{L}]+/gu, word => definitionActionWords.has(word) ? ' ' : word)))) return { status: "needs_admin", reason: "В сообщении есть личная ситуация или просьба вмешаться; справка не заменяет помощь администратора." };
  // Kazakh «не» means «what» here, not Russian negation. Mask only the complete
  // known question frame; any separate negative clause remains visible.
  if (forms.some(text => reportedOrNegated.test(text.replace(phrase("деген не", "gu"), " ").replace(phrase("дегеніміз не", "gu"), " ")))) return { status: "needs_admin", reason: "Отрицание, пересказ или условия требуют отдельной проверки смысла." };
  // Every remaining word must belong to ONE approved subject. Extra questions,
  // evidence, abuse and unknown clauses therefore cause abstention, not partial answers.
  const subjects = forms.map(definitionSubject).filter((value): value is string => value !== null && value.length > 0);
  const compactSubjects = new Set(forms.flatMap(joinedDefinitionSubjects));
  const matches = entries.filter(entry => entry.status === "published" && entry.id.trim() && entry.version.trim() && entry.answer.trim()
    && entry.source.title.trim() && entry.source.version.trim()
    && !entry.excludedTerms?.some(hasCondition)
    && (!entry.requiredTerms?.length || entry.requiredTerms.every(hasCondition))
    && entry.aliases.some(alias => {
      const variants = aliasForms(alias);
      const definitionMatch = (!entry.questionKind || entry.questionKind === "definition") && (subjects.some(subject => variants.includes(subject)) || variants.some(alias => compactSubjects.has(alias.replaceAll(" ", ""))));
      // Administrators can publish other FAQ types with complete approved question
      // aliases. No word-overlap fallback: the ENTIRE question must match that alias.
      const completeQuestion = /(?<![\p{L}\p{N}_])(?:как|где|когда|какой|какая|можно\s+ли|як|де|коли|qanday|qayerda|қайда|қалай)(?![\p{L}\p{N}_])/u;
      const exactQuestionMatch = variants.some(variant => completeQuestion.test(variant) && forms.includes(variant));
      return definitionMatch || exactQuestionMatch;
    }));
  if (matches.length !== 1) return { status: "needs_admin", reason: matches.length ? "Подходят несколько ответов; выбор должен проверить администратор." : "Утверждённого ответа на весь вопрос нет: обращение передано администратору." };
  const entry = matches[0];
  return { status: "answered", reason: "Вопрос целиком совпал с одним утверждённым справочным намерением.", entryId: entry.id, entryVersion: entry.version, answer: entry.answer, source: { ...entry.source } };
}
