import { atWord } from "./game-language.ts";
import { inspectMultilingualAbuse, normalizeAbuseForms } from "./multilingual-moderation.ts";

// The analysis copy is separate from the original shown to the administrator.
// These are curated word families, not substring bans or an inferred probability.
const insult = "дурак(?:и|а|у|ом|ов)?|дур(?:а|ы|ой|у)|идиот(?:ка|ки|ку|ке|ы|а|у|ом|ов)?|дебил(?:ка|ки|ку|ы|а|у|ом|ов)?|мудак(?:и|а|у|ом|ов)?|мраз(?:ь|и|ью)|твар(?:ь|и|ью)|ублюд(?:ок|ки|ка|ку|ком)|сволоч(?:ь|и|ью)|сук(?:а|и|у|ой)|сучк(?:а|и|у|ой)|туп(?:ой|ая|ые|ого|ых|ому|ую)|кончен(?:ый|ая|ые|ого|ую)|ебл(?:ивый|ивая|ивые|ивую|ан|аны|ана|ану)|д[оа]лб[оа]еб(?:ы|а|у|ом|ов)?|пид(?:ор|оры|ора|ору|орас|орасы|ораса|орасу|орыв|р)|пизд[ао]бол(?:ка|ки|ку|ы|а)?|шлюх(?:а|и|у|ой)|сын\\s+шлюхи|недоум(?:ок|ки|ка|ку)|уеб(?:ок|ки|ка|ку)|лох(?:и|а|у|ом)?|хуесос(?:ы|а|у|ом)?|нищееб(?:ы|а|у)?|хуйланы";
// «хачу» is a frequent misspelling of «хочу»; do not treat it as a slur form.
const hateSlur = "хач(?:и|а|онок)?|черножоп(?:ый|ая|ые|ого)";
const familyDismissal = "(?:(?:твою|вашу)\\s+(?:мать|маму)|(?:мать|маму)\\s+(?:твою|вашу))\\s+ебал|ебал\\s+(?:(?:я\\s+)?(?:твою|вашу)\\s+(?:мать|маму)|(?:я\\s+)?(?:вас|тебя))";
const dismissal = `(?:пошел|пошла|пошли|иди|идите)\\s+(?:(?:ты|вы|все)\\s+){0,2}(?:на\\s+хуй|нахуй)|${familyDismissal}`;
const frustration = "заебал(?:а|и)?";
// These expressions need their whole hostile construction. Ordinary words such
// as «слабый», «школьник» and «умер» are not standalone moderation triggers.
const deathWish = "(?:чтоб(?:ы)?\\s+(?:ты|вы)\\s+(?:сдох(?:ли|ла)?|умер(?:ли|ла)?|помер(?:ли|ла)?))|(?:ты\\s+сдохнешь|вы\\s+сдохнете)\\s+в\\s+муках|(?:сдохни(?:те)?|умри(?:те)?)\\s+(?:в\\s+муках|мучительно)";
const realThreat = "(?:(?:я\\s+)?(?:тебя|вас)\\s+убью|(?:я\\s+)?убью\\s+(?:тебя|вас))\\s+(?:в\\s+реале|в\\s+реальной\\s+жизни)|(?:я\\s+)?(?:тебе|вам)\\s+(?:сломаю\\s+(?:руки|ноги|шею)|перережу\\s+горло)";
const humiliatingDescription = "(?:слаб(?:ый|ая|ые)\\s+труслив(?:ый|ая|ые)|труслив(?:ый|ая|ые)\\s+слаб(?:ый|ая|ые))\\s+(?:школьник(?:и)?|школьница|девочка|мальчик)|(?:ебало|рожа)\\s*[,—:-]?\\s*(?:страшн(?:ое|ая)\\s+(?:и\\s+)?уродлив(?:ое|ая)|уродлив(?:ое|ая)\\s+(?:и\\s+)?страшн(?:ое|ая))|позор(?:е|ом)?\\s+высранн(?:ый|ом)|бичи\\s+ебаные";
const additionalInsult = "шалав(?:а|ы|у|ой)|придур(?:ок|ки|ка|ку|ком)|ебанут(?:ый|ая|ые|ого)|урод(?:ы|а|у|ом)?|ебан(?:ый|ая|ые)\\s+(?:клоун|морда|скотина)";
const role = "адм|админ(?:ы|истратор(?:ы)?)?|модератор(?:ы)?";
const second = "ты|вы|тебя|тебе|тобой|вас|вам|вами|твой|твоя|твое|твои|твою|ваш|ваша|ваше|ваши|вашу";
const third = "он|она|они|этот|эта|эти|этого|игрок(?:и|а)?|человек|чел";
const filler = "совсем|полный|полная|полные|полного|просто|реально|все|такой|такая|такие|ну|же|да|ебаный|ебаная|ебаные|опять";
const incident = atWord("заебал[а-я]*|задолбал[а-я]*|достал[а-я]*|меша[а-я]*|дм[а-я]*|дб[а-я]*|убил[а-я]*|убива[а-я]*|сбил|бьет|бьют|стреля[а-я]*|украл[а-я]*|обман[а-я]*|наказал[а-я]*|забанил[а-я]*|выдал[а-я]*|дал|посадил[а-я]*|угрожа[а-я]*|оскорбля[а-я]*");
const affected = atWord("меня|мне|нам|нас|мой|моя|мои|мою|нашу|наш|игрок(?:а|ов)?|всех");
const speech = atWord("(?:написа|писа|сказа|скза|говори|назва|обозва|цитирова|оскорби)[а-я]*|(?:называ|обзыва|пиш|говор|цитиру|оскорбля)[а-я]*", "gu");
const meta = atWord("что\\s+(?:значит|означает|такое)|можно\\s+ли|(?:не|нельзя)\\s+(?:говорить|писать|называть)|не\\s+называй|(?:не|нет)\\s+оскорблени[а-я]*|слово|словом|фраза|фразой|цитата|цитирую|за\\s+слова|за\\s+оскорбление");
const imperatives = atWord("кидай|киньте|кинь|отправь|отправьте|иди|идите|пошел|пошла|пошли|сиди|смотрите|смотри|замолчи|заткнись|отвали|прекрати|перестань|отвечай");
const secondPersonVerb = atWord("пишешь|говоришь|думаешь|лезешь|копируешь|обижаешь|обзываешь|считаешь|читаешь|врешь|можешь|плачешься|хнычешь|ноешь|вывозишь");
const personDescription = atWord("мусульманск[а-я]*|мусульман(?:ин|е)?|казахск[а-я]*|узбекск[а-я]*|русск[а-я]*");
const objectAfter = new RegExp(`^[\\s,:—-]+(?:этот\\s+)?${atWord("баг[а-я]*|лаг[а-я]*|сервер[а-я]*|сервак[а-я]*|клиент[а-я]*|интерфейс[а-я]*|сайт[а-я]*|вопрос[а-я]*|бот[а-я]*|ошибк[а-я]*|игра|игру|программ[а-я]*|кнопк[а-я]*").source}`, "u");
const allInsults = atWord(`${insult}|${hateSlur}`);
const candidates = () => atWord(`${deathWish}|${realThreat}|${humiliatingDescription}|${additionalInsult}|${dismissal}|${insult}|${hateSlur}|${frustration}`, "gu");

export type ModerationResult = { kind: "violation" | "complaint" | "reported" | "none"; match?: string; reason: string; topic?: string };

const transliterations: Record<string, string> = { pidor: "пидор", pidory: "пидоры", pidoras: "пидорас", debil: "дебил", idiot: "идиот", dolboeb: "долбоеб", dalbaeb: "долбоеб" };
const maskedForms = ["дурак", "идиот", "дебил", "мудак", "мразь", "тварь", "еблан", "долбоеб", "пидор", "пидорас", "пиздабол", "сучка", "уебок", "хуесос"];
function normalizeWord(word: string) {
  if (transliterations[word]) return transliterations[word];
  const map: Record<string, string> = { a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", k: "к", m: "м", t: "т", i: "и", "0": "о", "1": "и", "3": "з", "6": "б", "@": "а" };
  const candidate = word.replace(/[aceopxykmti0136@]/g, char => map[char]).replace(/(.)\1{2,}/gu, "$1");
  if (allInsults.test(candidate) && new RegExp(`^(?:${insult}|${hateSlur})$`, "u").test(candidate)) return candidate;
  // Only one mask in a known complete word, with at least four actual letters.
  // Nicknames/links have already been removed; short codes are never fuzzily matched.
  if (/^[\p{L}*#]+$/u.test(candidate) && (candidate.match(/[*#]/g)?.length === 1) && candidate.replace(/[*#]/g, "").length >= 4) {
    const match = maskedForms.filter(form => form.length === candidate.length && [...candidate].every((letter, index) => letter === "*" || letter === "#" || letter === form[index]));
    if (match.length === 1) return match[0];
  }
  return word;
}

function isReported(before: string) {
  const authoredSpeech = atWord("я\\s+(?:называю|обзываю|говорю|пишу|отвечаю)|(?:я\\s+)?(?:называю|обзываю)\\s+(?:тебя|вас)").test(before)
    && !atWord("не\\s+(?:называю|обзываю|говорю|пишу|отвечаю)").test(before);
  if (meta.test(before) && !authoredSpeech) return true;
  const hits = [...before.matchAll(speech)].filter(hit => {
    // «Не говоря о ...» means "not to mention", not attribution to a speaker.
    return !(hit[0] === "говоря" && /(?:^|\s)не\s*$/u.test(before.slice(0, hit.index))
      && /^\s+о(?:б)?\s/u.test(before.slice(hit.index! + hit[0].length)));
  });
  const last = hits.at(-1);
  if (!last) return false;
  if (authoredSpeech && /^(?:называю|обзываю|говорю|пишу|отвечаю)$/u.test(last[0])) return false;
  const prefix = before.slice(0, last.index);
  const tail = before.slice(last.index! + last[0].length);
  // Present-tense self-authored speech is not automatically a quotation of someone else.
  if (/(?:^|\s)я\s+(?:сейчас\s+|тебе\s+|вам\s+)?$/u.test(prefix) && /^(?:говорю|пишу|отвечаю)$/u.test(last[0]) && !atWord("не").test(prefix)) return false;
  // Writing a complaint is an action, not a scope protecting every later insult.
  if (atWord("жалоб[а-я]*|заявк[а-я]*|апелляци[а-я]*|тикет[а-я]*").test(tail) && !/:|со\s+словами|следующее/u.test(tail)) return false;
  return true;
}

function ownQuote(prefix: string) {
  const local = prefix.split(/[.!?;\n]|,\s*(?:а|но)\s+/u).at(-1)!;
  if (isReported(local) || atWord("не\\s+(?:сказал|говорил|писал)").test(local)) return false;
  return atWord(`(?:я\\s+)?(?:говорю|пишу|отвечаю)\\s+(?:тебе|вам)|я\\s+(?:говорю|пишу|отвечаю)`).test(local)
    || new RegExp(`(?:^|[,;])\\s*${atWord("ты|вы|тебе|вам").source}[\\s,:—-]*$`, "u").test(local)
    || new RegExp(`(?:^|,)\\s*${atWord(role).source}[\\s,:—-]*$`, "u").test(local);
}

function reportedAfter(suffix: string) {
  // Attribution must immediately follow this quotation/phrase. A later report
  // or mention of a nickname must not erase the author's own earlier attack.
  const local = suffix.split(/[.!?;\n]/u)[0];
  const speechAfter = "(?:написал[а-я]*|писал[а-я]*|сказал[а-я]*|говорил[а-я]*|пишет|говорит|прислал[а-я]*|отправил[а-я]*)";
  const speaker = "(?:он|она|они|игрок[а-я]*|админ[а-я]*)";
  const recipient = "(?:мне|нам|тебе|вам)";
  return new RegExp(`^[\\s,:—–-]*(?:(?:это|так)\\s+)?(?:${recipient}\\s+${speechAfter}|${speaker}\\s+(?:${recipient}\\s+)?${speechAfter}|${speechAfter}\\s+(?:${recipient}|${speaker})(?![\\p{L}\\p{N}_])|цитата|(?:его|ее|их)\\s+слова|(?:сообщение|слова|цитата)\\s+от\\s+(?:игрок[а-я]*|админ[а-я]*|него|нее|них))`, "u").test(local)
    || /^[\s,:—–-]*(?:это\s+(?:(?:мой|его|ее|их|твой|ваш)\s+)?)?(?:ник|никнейм)(?![\p{L}\p{N}_])/u.test(local)
    || /^[\s,:—–-]*(?:мой|его|ее|их|твой|ваш)\s+(?:ник|никнейм)(?:\s+в\s+игре)?\s*$/u.test(local);
}

function nonAuthoredThreat(before: string, match: string) {
  // A subordinate «чтобы ты умер» may describe prevention, fear or somebody
  // else's intention. Only a standalone wish or a local authored wish is clear.
  const wishHasAuthor = !before.trim()
    || /(?:^|\s)(?:хочу|желаю|мечтаю)(?:\s+(?:тебе|вам))?[\s,:—-]*$/u.test(before)
    || adjacent(role, before, "");
  return (/^чтоб/u.test(match) && !wishHasAuthor)
    || /(?:^|\s)не\s+(?:хочу|желаю|говорю|прошу)\s*$/u.test(before)
    || /(?:^|\s)(?:боюсь|страшно|опасаюсь|переживаю)\s+(?:что|как)\s*$/u.test(before)
    || atWord("(?:он|она|они|игрок[а-я]*|админ[а-я]*)\\s+(?:(?:мне|нам|тебе|вам)\\s+)?(?:угрожал[а-я]*|угрожает|пожелал[а-я]*|желает)|(?:мне|нам)\\s+(?:угрожали|пожелали)").test(before);
}

function analysisParts(original: string) {
  const ownedQuotes: string[] = [];
  let text = normalizeAbuseForms(original).replace(/\d+(?:\.\d+)+/gu, " ");
  // Protect only a parenthesized retrospective charge, never the whole appeal.
  text = text.replace(/\([^()\n]{1,180}\)/gu, (phrase: string, offset: number, source: string) => {
    const before=source.slice(0,offset).split(/[.!?;\n]/u).at(-1)!;
    const charge=/(?:из[- ]?за|иза|за)\s+(?:[а-я]+\s+){0,4}(?:оскорблени[ея]|слова)\s*$/u.test(before);
    const punishment=atWord("бан[а-я]*|забан[а-я]*|мут[а-я]*|варн[а-я]*|наказани[а-я]*").test(before);
    return charge&&punishment ? " " : phrase;
  });
  // Code, URLs and user identifiers are evidence, not author speech.
  text = text.replace(/```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)|https?:\/\/[^\s]+|www\.[^\s]+|\/[\p{L}\p{N}][\p{L}\p{N}_]*|[\p{L}\p{N}_.+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|@[\p{L}\p{N}_]+|[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+|<[^>]+>/giu, " ");
  text = text.replace(/«([^»]*)(?:»|$)|"([^"]*)(?:"|$)|“([^”]*)(?:”|$)/gu, (quote: string, angle: string, straight: string, curly: string, offset: number, source: string) => {
    const suffix = source.slice(offset + quote.length).split(/[.!?;\n]/u)[0];
    const addressedAfter = new RegExp(`^[\\s,:—-]*(?:это\\s+)?(?:тебе|вам)[\\s,:—-]*(?:${role})?[\\s.!]*$`, "u").test(source.slice(offset + quote.length));
    if (!reportedAfter(suffix) && (ownQuote(source.slice(0, offset)) || addressedAfter)) ownedQuotes.push(angle ?? straight ?? curly);
    return " ";
  });
  const normalize = (part: string) => part.replace(/[\p{L}\p{N}*#@]+/gu, normalizeWord).replace(/[\p{L}\p{N}_-]*\d[\p{L}\p{N}_-]*/gu, " ");
  return [normalize(text), ...ownedQuotes.map(normalize)];
}

function splitClaims(text: string) {
  // Keep question marks so that «это шутка?» cannot become an author's excuse.
  // A comma introducing somebody else's speech is not an independent address.
  const scoped = text.replace(/,\s*(?=(?:ты|вы|я|этот|эта|эти|он|она|они|админ)(?![\p{L}\p{N}_]))/gu, (separator, offset: number) => {
    const before = text.slice(0, offset).split(/[.!?;\n]|,\s*(?:а|но|зато|однако)\s+/u).at(-1)!;
    return isReported(before) && [...before.matchAll(speech)].length > 0 ? separator : "\n";
  });
  return scoped.split(/(?<=[.!?;])\s*|\n+|,\s*(?:а|но|зато|однако)\s+|\s+(?:потому\s+что|поскольку)\s+/u).map(claim => claim.trim()).filter(Boolean);
}

function standaloneJoke(text: string) {
  if (text.includes("?")) return false;
  const clean = text.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "");
  return /^(?:(?:это\s+(?:была\s+)?)|(?:я\s+))?(?:просто\s+)?(?:шутка|шутки|шучу|пошутил(?:а)?|рофл|рофлю|пранк)$/u.test(clean);
}
function localJoke(after: string, next: string | undefined) {
  return standaloneJoke(after.split(",").at(-1)!) || (next !== undefined && standaloneJoke(next));
}
function adjacent(words: string, before: string, after: string) {
  return new RegExp(`(?:${atWord(words).source})[\\s,:—-]+(?:(?:${filler})[\\s,:—-]+)*$`, "u").test(before)
    || new RegExp(`^[\\s,:—-]+(?:(?:${filler})[\\s,:—-]+)*(?:${atWord(words).source})`, "u").test(after);
}
function isNegated(before: string) {
  return /(?:^|\s)не\s+(?:(?:такой|такая|такие|какой-то|какая-то|совсем|полный|полная)\s+)?$/u.test(before)
    || new RegExp(`(?:^|\\s)не\\s+(?:ты|вы|я|он|она)\\s+(?:(?:${filler})\\s+)*$`, "u").test(before);
}

function inspectMockingSpam(text: string): ModerationResult | null {
  // Require both repeated mocking symbols and authored taunting/addressing.
  // Flags, disability symbols and ordinary emotional emojis are never triggers.
  const runs = /(?:[🐷🐖🤡]\uFE0F?[ \t,]*){3,}/gu;
  for (const hit of text.matchAll(runs)) {
    const before = text.slice(0, hit.index).split(/[.!;\n]/u).at(-1)!;
    const after = text.slice(hit.index! + hit[0].length).split(/[.!;\n]/u)[0];
    if (isReported(before) || meta.test(before) || reportedAfter(after)) continue;
    const directlyAddressed = new RegExp(`^\\s*(?:эй[\\s,]+)?(?:${role}|ты|вы)[\\s,:?—-]*$`, "u").test(before);
    const words = (before + " " + after).match(/[\p{L}\p{N}]+/gu) ?? [];
    const fillerOnly = words.every(word => /^(?:не|согл|согласен|согласна|крч|короче|пон|понял|поняли|понятно|плачь|плачьте|рофл|рофлю|шутка|шучу|ну|да|ага|это|просто|ты|вы|адм|админ|админы|ахах[ах]*)$/u.test(word));
    const taunt = atWord("пон|понял|поняли|плачь|плачьте|рофл|рофлю|шутка|шучу").test(before);
    if (directlyAddressed || (fillerOnly && taunt)) {
      return { kind: "violation", match: (before.trim() + " " + hit[0].trim()).trim(), topic: "Провокационный спам", reason: "Насмешливое обращение сопровождается серией уничижительных эмодзи. Это провокационный спам, а не содержательный вопрос или описание происшествия." };
    }
  }
  return null;
}

export function inspectModeration(original: string): ModerationResult {
  let result: ModerationResult = { kind: "none", reason: "Однозначное оскорбление автора не найдено. Сложные случаи требуют проверки администратора." };
  for (const text of analysisParts(original)) {
    const mocking = inspectMockingSpam(text);
    if (mocking) return mocking;
    const claims = splitClaims(text);
    for (const [index, claim] of claims.entries()) {
      for (const hit of claim.matchAll(candidates())) {
        const before = claim.slice(0, hit.index);
        const after = claim.slice(hit.index! + hit[0].length);
        if (/^(?:туп|кончен|еблив)/u.test(hit[0]) && objectAfter.test(after)) continue;
        const isThreat = atWord(`${deathWish}|${realThreat}`).test(hit[0]);
        if (isReported(before) || isNegated(before) || reportedAfter(after) || (isThreat && nonAuthoredThreat(before, hit[0])) || /^\s+это\s+оскорбление\s*\?/u.test(after)) {
          if (result.kind === "none") result = { kind: "reported", reason: "Найден пересказ, обсуждение или отрицание оскорбления. Автору обращения оно автоматически не приписывается." };
          continue;
        }
        const isDismissal = atWord(dismissal).test(hit[0]);
        const thirdNearby = adjacent(third, before, after) || new RegExp(`${atWord(third).source}\\s+${atWord(role).source}\\s*$`, "u").test(before);
        const explicitSecond = adjacent(second, before, after) || (!thirdNearby && !atWord(third).test(claim) && (atWord(second).test(claim) || secondPersonVerb.test(claim)));
        // Postposed «я» only identifies a self-description when it closes that
        // description. «Мразь я тебе ...» starts a new claim, not «я мразь».
        const self = !isDismissal && ((adjacent("я", before, "") && !adjacent(second, before, after)) || (!explicitSecond && /^[\s,:—-]+я(?:\s*[,.!?;:]|$)/u.test(after)));
        if (self) continue;
        const joke = localJoke(after, claims[index + 1]) && !atWord(frustration).test(hit[0]) && (hit[0] !== "сука" || thirdNearby || explicitSecond);
        const addressedCommand = !thirdNearby && (imperatives.test(before) || /(?:^|\s)(?:эй|слышь)\s*$/u.test(before) || /^\s+(?:хотя\s*бы|лучше\s+бы)\s+(?:написал[аи]?|прочитал[аи]?|подумал[аи]?)(?![\p{L}\p{N}_])/u.test(after)) && !isReported(before);
        const tauntedComplainant = !incident.test(claim) && !affected.test(claim)
          && atWord("жбшник[а-я]*|жалобщик[а-я]*").test(claim)
          && atWord("пожаловал(?:ся|ась)|обиженн?[а-я]*").test(claim);
        if (isDismissal || explicitSecond || addressedCommand || joke || tauntedComplainant || isThreat) {
          return { kind: "violation", match: hit[0], reason: joke ? "Оскорбление сопровождается оправданием «шутка» или похожим выражением. Это не отменяет нарушение." : isThreat ? "Найдена собственная адресная угроза или пожелание смерти. Просьба о помощи не отменяет его." : "Оскорбление обращено к собеседнику. Просьба о помощи не отменяет его." };
        }
        // A description of somebody's actions remains a complaint. Independent claims
        // were split above, so a different incident cannot cancel an admin-directed insult.
        const personalPunishment = atWord("я|меня|мне|нас|нам").test(claim)
          && atWord("получил[а-я]*|выдал[а-я]*|дал|дали|посадил[а-я]*").test(claim)
          && atWord("бан[а-я]*|мут[а-я]*|варн[а-я]*|деморган|дмг|наказани[а-я]*").test(claim);
        if (((incident.test(claim) && affected.test(claim)) || personalPunishment) && (thirdNearby || atWord(`${third}|${role}`).test(claim) || allInsults.test(hit[0]))) {
          result = { kind: "complaint", reason: "Ругань связана с описанием действий другого человека. Это возможная жалоба; одного мата и упоминания администратора недостаточно для автоматического нарушения." };
          continue;
        }
        const remainder = claim.replace(candidates(), " ").replace(atWord(`${filler}|ебан(?:ый|ая|ые)|гребан(?:ый|ая|ые)`, "gu"), " ");
        const onlyInsults = !/[\p{L}\p{N}]/u.test(remainder) && !/^\s*сука[\s.!]*$/u.test(claim);
        const describedTarget = !/^(?:туп|кончен|еблив)/u.test(hit[0])
          && (atWord(role).test(claim) || atWord("кто|тот|та|те|тому").test(before));
        if (!atWord(frustration).test(hit[0]) && (adjacent(role, before, after) || describedTarget || thirdNearby || onlyInsults || atWord(hateSlur).test(hit[0]) || personDescription.test(before))) {
          return { kind: "violation", match: hit[0], reason: "Найдено оскорбление человека без признаков пересказа или описания происшествия." };
        }
      }
    }
  }
  const multilingual = inspectMultilingualAbuse(original);
  if(multilingual) return {kind:"violation", ...multilingual};
  return result;
}

export function findAuthoredInsult(original: string): string | null {
  const result = inspectModeration(original);
  return result.kind === "violation" ? result.match! : null;
}
