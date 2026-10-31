import { atWord, contextText, normalizeGameText } from "./game-language.ts";
import { inspectModeration } from "./message-moderation.ts";

export type RequestEvent = {
  kind: "incident" | "punishment" | "request" | "reported-speech";
  action: string;
  fragment: string;
  actor: "author" | "administrator" | "player" | "unknown";
  target: "author" | "other" | "unknown";
  negated: boolean;
  uncertain?: boolean;
};

export const incidentWords = "дм(?:ит|ят|ил|или|ила|ить|лю|ишь)?|дб(?:шит|шат|шил|шили|шить)?|тк(?:шит)?|рк(?:шил)?|ск|нрп|урп|мг|пг|оск(?:р|ал|ала|али|ает|ают|нул|нула|ать|орб[а-я]*)?|упом|чит(?:ы|ов|ер|еры|ерит|ак)?|софт(?:а|ом|ы|ер|еры)?|багоюз[а-я]*|багаюз[а-я]*|скам[а-я]*|заскам[а-я]*|обман[а-я]*|убил[а-я]*|убива[а-я]*|застрел[а-я]*|задавил[а-я]*|давил[а-я]*|сбил|арестова[а-я]*|задержа[а-я]*|связал[а-я]*|повязал[а-я]*|завязал[а-я]*|бьют|бьет|ударил[а-я]*|стреля[а-я]*|расстреля[а-я]*|подстрелил[а-я]*|ограб[а-я]*|взял[а-я]*\\s+под\\s+стражу|открыл[а-я]*\\s+огонь|обзыва[а-я]*|матер(?:ится|ился|ятся|ил|ит)|расизм|угрожа[а-я]*|угроз[а-я]*|шантаж|спам[а-я]*|флуд[а-я]*|уход(?:ит)?\\s+от\\s+(?:рп|смерти)|(?:надел|надели)\\s+наручники";
export const punishmentWords = "бан(?:а|у|ом)?|мут(?:а|у|ом)?|варн(?:а|у|ом)?|наказани[а-я]*|предупреждени[а-я]*|блокиров[а-я]*|деморган|дмг|джаил|jail|warn";
const extraIncidents = "мат(?:ы|ом|ами)?|оска|оскрб[а-я]*|упоминани[а-я]*\\s+(?:родн[а-я]*|родител[а-я]*)|обозвал[а-я]*|грохнул[а-я]*|таран[а-я]*|расстрел[а-я]*|порнографи[а-я]*|(?:музыка|музыку|сузыка|орет)\\s+(?:в\\s+)?(?:войс|микро|микрофон|чат)|(?:кинули|кинул)\\s+(?:меня\\s+)?на";
const administrator = atWord("адм|админ[а-я]*|адмыны|администрат[а-я]*|administrator|модератор[а-я]*|старшая\\s+администрация");
const ownTarget = atWord("меня|мне|мой|мою|моя|мои|моего|моем|нам|нас");

export function splitStatements(text: string) {
  // Decimal rule numbers are not sentence boundaries. Contrasts and new subjects
  // end the scope of a previous event/negation even when punctuation is missing.
  return text.split(/[!?;\n]+|(?<!\d)\.|\.(?!\d)|,\s*(?=(?:(?:а|но|зато|хотя|потом|затем)\s+)?(?:я|меня|мне|он|она|они|игрок|админ|но|а|хотя)(?![\p{L}\p{N}_]))|\s+(?:но|зато|хотя)\s+/iu)
    .map(value => value.trim()).filter(Boolean);
}

function negates(clause: string, start: number, end: number) {
  const before = clause.slice(0, start), after = clause.slice(end);
  // Only grammatical negation of this event. "Не согласен" is not negation of DM.
  if (/(?:^|\s)(?:не|ne|нет|без)\s+(?:(?:я|он|она|мы|они|было|был|были|совершал|совершала|делал|делала|использую|использовал|использовала|играю|играл|никакого|никаких|какого-либо|с|со)\s+){0,3}$/u.test(before)) return true;
  return /^\s+(?:которого|который|которые)?\s*(?:я\s+)?не\s+(?:совершал|делал|было)(?![\p{L}\p{N}_])/u.test(after);
}

export function analyzeRequest(original: string, understood: string) {
  const text = contextText(understood).toLowerCase().replaceAll("ё", "е");
  const statements = splitStatements(text);
  const events: RequestEvent[] = [];
  for (const fragment of statements) {
    const actor: RequestEvent["actor"] = administrator.test(fragment) ? "administrator" : atWord("я|мы").test(fragment) ? "author" : atWord("он|она|они|игрок[а-я]*|чел").test(fragment) ? "player" : "unknown";
    const target: RequestEvent["target"] = ownTarget.test(fragment) ? "author" : atWord("ему|ей|его|им|игрок[а-я]*").test(fragment) ? "other" : "unknown";
    for (const match of fragment.matchAll(atWord(`${incidentWords}|${extraIncidents}`, "gu"))) {
      events.push({kind: "incident", action: match[0], fragment, actor, target, negated: negates(fragment, match.index!, match.index! + match[0].length)});
    }
    const custody = fragment.match(atWord("посадил[а-я]*|задержа[а-я]*|наручник[а-я]*"));
    if (custody && atWord("полицейск[а-я]*|полици[а-я]*|коп|копы|мвд|фсб").test(fragment)) events.push({kind:"incident", action:custody[0], fragment, actor:"player", target, negated:negates(fragment, custody.index!, custody.index!+custody[0].length)});
    if (atWord("наручник[а-я]*|конвой|веревк[а-я]*|повязал[а-я]*|отыгровк[а-я]*|отыгрыш[а-я]*").test(fragment) && atWord("без\\s+рп|нет\\s+рп|зз|гз|не\\s+отыграл[а-я]*").test(fragment)) events.push({kind:"incident",action:"действие без РП или в ЗЗ",fragment,actor,target,negated:false});
    const punishment = fragment.match(atWord(punishmentWords));
    if (punishment) events.push({kind: "punishment", action: punishment[0], fragment, actor, target, negated: false});
    const request = fragment.match(atWord("прошу|помогите|помоги|помощь|покажите|покажи|предоставьте|дайте|разберитесь|снимите|снять|обжалую|пересмотрите|верните|проверьте"));
    if (request) events.push({kind:"request", action:request[0], fragment, actor:"author", target:"unknown", negated:false});
  }
  // Quoted evidence remains attributed to another speaker. It may establish a
  // report topic, never an authored violation or an instruction to the system.
  for (const quote of original.matchAll(/«([^»]+)»|"([^"\n]+)"|“([^”]+)”/gu)) {
    const before = original.slice(0, quote.index).split(/[.!?;\n]+/u).at(-1)!.toLowerCase();
    if (atWord("(?:он|она|игрок[а-я]*)\\s+(?:мне\\s+)?(?:написал[а-я]*|сказал[а-я]*)|(?:мне|меня)\\s+(?:написал[а-я]*|обозвал[а-я]*|назвал[а-я]*|оскорбил[а-я]*)|он\\s+пишет").test(before)) {
      const content = normalizeGameText(quote[1] || quote[2] || quote[3]).toLowerCase().replaceAll("ё", "е");
      const relevant = atWord(`${incidentWords}|${extraIncidents}|убью|убьем|оск\\s+родни`).test(content) || inspectModeration(content).kind === "violation";
      events.push({kind:"reported-speech",action:"чужие слова",fragment:quote[0],actor:"player",target:ownTarget.test(before)?"author":"unknown",negated:false, uncertain:!relevant});
    }
  }
  if (atWord("(?:я|мне|меня)\\s+[а-я ]{0,40}(?:дал|передал|отдал|продал|купил)|я\\s+первый\\s+дал|передал[а-я]*\\s+деньги").test(text) && atWord("не\\s+(?:отдал|вернул|перевел|дал|передал|заплатил)|кинули|обманул").test(text)) events.push({kind:"incident",action:"не выполнена сделка",fragment:text.slice(0, 240),actor:"player",target:"author",negated:false});
  for (const event of events) {
    if (event.kind !== "incident" || event.negated) continue;
    const deniedHere = events.some(other => other.kind === "incident" && other.negated && other.fragment === event.fragment);
    // A bare code next to a denial does not establish a second accusation.
    // In incompletely translated reported speech the speaker is still unknown.
    if (deniedHere && (/^(?:дм|дб|тк|ск|рк|оск|упом)$/u.test(event.action) || atWord("deyapti|deyabdi|degan").test(event.fragment))) event.uncertain = true;
  }
  return {text, statements, events, hasPositiveIncident: events.some(e => e.kind === "incident" && !e.negated && !e.uncertain), hasNegatedIncident: events.some(e => e.kind === "incident" && e.negated)};
}

export type RequestAnalysis = ReturnType<typeof analyzeRequest>;
