import { atWord, contextText, mapEditableParts, normalizeGameText } from "./game-language.ts";
import { normalizeInputScripts } from "./input-script-normalization.ts";

export type HelpUrgency = {
  level: "now" | "high" | "normal";
  eventTime: "ongoing" | "past" | "unknown";
  uncertain: boolean;
  reason: string;
  evidence: string[];
  needsLiveObservation: boolean;
  followUp?: string;
};

const L = "[\\p{L}]*";
const current = String.raw`сейчас|прямо\s+теперь|до\s+сих\s+пор|все\s+еще|продолжа${L}|зараз|доси|дотепер|тривае|продовжу${L}|казир|али\s+де|hozir|hali\s+ham|davom\s+et${L}`;
const past = String.raw`вчера|вчерашн${L}|позавчера|раньше|тогда|неделю\s+назад|час\s+назад|минут${L}\s+назад|только\s+что|уже\s+убили|вчора|вчорашн${L}|позавчора|ранише|щойно|кеше|бурын|жана\s+гана|кеча|kecha|avval|oldin|boya`;
const hypothetical = String.raw`если|допустим|например|на\s+будущее|якщо|припустимо|наприклад|егер|мысалы|agar|masalan`;
const meta = String.raw`что\s+(?:такое|значит|означает)|что\s+означают|как\s+перевести|переведите|объясни${L}\s+(?:слово|фразу|термин)|що\s+(?:таке|означае)|як\s+перекласти|деген\s+не|нени\s+билдир${L}|nima\s+degani|nimani\s+anglat${L}|qanday\s+tarjima`;
const liveAction = String.raw`убива(?:ет|ют|ете|ем|ешь|ю)|бьют|бьет|избива(?:ет|ют)|стреля(?:ет|ют)|расстрелива(?:ет|ют)|давит|давят|дмит|дмят|дбшит|дбшат|ткшит|таранит|таранят|топят|топит|режет|режут|вбива(?:е|ють|ете|еш|емо|ю)|б'ють|бие|б'е|стриля(?:е|ють)|давлять|таранять|аткылап\s+жатыр|аткылайды|атып\s+жатыр|урып\s+жат(?:ы)?р|олтирип\s+жат(?:ы)?р|согып\s+жатыр|ur(?:yapti|ishyapti)|urib\s+(?:turibdi|yuribdi)|o'ldir(?:yapti|ishyapti)|ot(?:yapti|ishyapti)|otib\s+(?:yuribdi|turibdi)|оскорбля(?:ет|ют)|угрожа(?:ет|ют)|обража(?:е|ють)|погрожу(?:е|ють)|корлап\s+жатыр|коркытып\s+жатыр|haqorat\s+qil(?:yapti|ishyapti)|so'k(?:yapti|ishyapti)|tahdid\s+qil(?:yapti|ishyapti)`;
const completedAction = String.raw`убил(?:и|а)?|убивал(?:и|а)?|избивал(?:и|а)?|стрелял(?:и|а)?|застрелил${L}|избил${L}|задавил${L}|дмил${L}|дбшил${L}|оскорбил${L}|вбив|вбили|вбивав|вбивали|застрелив${L}|образив${L}|олтирди|олтирген|урды|аткан|o'ldirdi|urdi|otdi|haqorat\s+qildi`;
const liveObservation = String.raw`читер${L}|аимбот|телепортируется|летает\s+(?:по\s+воздуху|над)|стреля${L}\s+(?:через|сквозь)\s+стен${L}|читы|чити|чит\s+колдан${L}|чит\s+пайдалан${L}|читер|читти|cheat|chit|чит|devordan\s+(?:ot${L}|o't${L})`;
const ongoingSecurity = String.raw`взламыва(?:ет|ют)|уводят\s+(?:аккаунт|деньги)|(?:снимают|переводят|сливают|выводят)\s+(?:мои\s+)?(?:деньги|имущество)|зламу(?:е|ють)|виводять\s+(?:мои\s+)?(?:гроши|кошти)|аккаунт${L}\s+бузып\s+жатыр|акша${L}\s+(?:алып|шыгарып)\s+жатыр|akkaunt${L}\s+buz(?:yapti|ishyapti)|pul${L}\s+(?:yech|ol|o'tkaz)(?:yapti|ishyapti)`;
const blockingState = String.raw`застря${L}|застряг${L}|завис(?:ла|ло)?|(?:не\s+(?:могу|можу|получается)|неможливо)\s+(?:(?:вообще|никак|больше)\s+)?(?:войти|зайти|выйти|играть|двигаться|зайти|увийти|вийти|грати|рухатись)|не\s+(?:пускает|впускает|выпускает|отпускает|дают\s+выйти)|держат|утриму${L}|(?:связали|наручники)\s+.{0,35}(?:бросили|ушли|оставили)|провалил${L}\s+(?:под|в)\s+(?:карту|текстур${L})|текстур${L}\s+(?:застря${L}|калды${L})|кире\s+алмай${L}|шыга\s+алмай${L}|козгала\s+алмай${L}|ойнай\s+алмай${L}|тусип\s+кеттим|kir(?:a\s+olmay${L}|olmay${L})|chiq(?:a\s+olmay${L}|olmay${L})|qotib\s+qol${L}|tiqilib\s+qol${L}|o'ynay\s+olmay${L}`;
const unresolvedLoss = String.raw`взломали|взломан${L}|потерял${L}\s+доступ|украли\s+(?:аккаунт|машину|имущество)|пропал${L}\s+(?:машин${L}|имущество|деньги)|(?:донат|платеж|покупка|деньги)\s+не\s+(?:приш${L}|поступ${L}|зачисл${L})|не\s+(?:приш${L}|поступ${L}|зачисл${L})\s+(?:донат|платеж|покупка|деньги)|зламали|втратив\s+доступ|зник${L}\s+(?:машин${L}|гроши|майно)|аккаунт${L}\s+(?:бузылды|урлады)|акша${L}\s+жогал${L}|akkaunt${L}\s+buzishdi|pul${L}\s+yo'qol${L}|donat\s+(?:kelmadi|tushmadi)`;
const ended = String.raw`(?:уже|теперь|сейчас)\s+(?:все\s+)?(?:закончил${L}|прекратил${L}|решен${L}|решил${L}|отпустили|освободили|выбрался|вышел|вернули)|больше\s+не\s+(?:бьют|стреляют|убивают|мешают)|(?:все|нападение|событие|нарушение)\s+(?:закончил${L}|прекратил${L})|помощь\s+(?:больше\s+)?не\s+нужна|вже\s+(?:закiнчил${L}|закинчил${L}|закiнчи${L}|закинчи${L}|минуло|випустили|повернули)|бильше\s+не\s+(?:б'ють|вбивають)|допомога\s+не\s+потрибна|бари\s+битти|токтады|комек\s+керек\s+емес|тузетилди|tugadi|to'xtadi|hal\s+bo'ldi|yordam\s+kerak\s+emas`;

const nativeLive = String.raw`дмлять|дбшать|давять|розстрилю(?:е|ють)|(?:дм|дб|dm|db)\s+(?:жасап\s+жатыр|qil(?:yapti|ishyapti))|басып\s+жатыр|bos(?:yapti|ishyapti)`;
const restraints = String.raw`связал${L}|связан${L}|наручник${L}|похити${L}|зв'язал${L}|кайдан${L}|байлап|байланган|bog'lab|bog'langan|kishan${L}`;
const transporting = String.raw`везут|увозят|тащат|везуть|вивозять|алып\s+(?:бара|кетип)\s+жатыр|olib\s+ket(?:yapti|ishyapti)`;
const property = String.raw`инвентар${L}|вещ${L}|предмет${L}|имущество|машин${L}|деньги|покупк${L}|товар${L}|донат${L}|аккаунт${L}|акаунт${L}|речи|майно|гроши|кошти|зат${L}|тауар${L}|колик${L}|акша${L}|buyum${L}|inventar${L}|mashina${L}|pul${L}|xarid${L}|donat${L}`;
const missingProperty = String.raw`пропал${L}|исчез${L}|украл${L}|зник${L}|жогал${L}|yo'qol${L}|(?:не\s+(?:приш${L}|прийш${L}|поступ${L}|зачисл${L}))|келмеди|туспеди|kelmadi|tushmadi`;
const gameBlock = String.raw`вылета${L}|не\s+запуска${L}|вилита${L}|не\s+пускае|kiritmay${L}|жабылып\s+кала${L}|yopilib\s+qol${L}|(?:не\s+(?:двигается|рухаеться))|козгалмай${L}|катып\s+калды|qimirlamay${L}|шыга\s+алмай${L}|chiqib\s+bo'lmay${L}|(?:войти|зайти|выйти|увийти|вийти|играть|грати)\s+не\s+(?:могу|можу)|(?:выйти|вийти)\s+.{0,25}(?:невозможно|неможливо)`;

// Reviewed *words*, not evaluation sentences. Generate only unambiguous
// transliterations and one omitted letter; preserve short codes and identities.
const urgencyWords = `убивает убивают давят давлять стреляет стреляют оскорбляет потерял связали доступ подменяет летает
  восстановление вылетает вылетают зависло исчезли пропали пришёл товар
  зв'язали втратив відновлення вбивають вбивали рухається вилітає зникли стріляє розстрілюють підміняє
  қазір жатыр атып басып ұрып өлтіріп жасап байлап заттарым жоғалды
  алып бара көлікпен айырбас ауыстырып кіре шыға алмаймын қатып қалды қозғалмайды жабылып
  uryapti bosishyapti qilishyapti qilyapti haqorat yo'qoldi kelmadi bog'lab otyapti uchyapti mashinasiz hozir
  kira chiqib qotib qoldi qimirlamayapti tiklash` .split(/\s+/u);
const urgencyAliases = new Map<string, string | null>();
const cyrToLatin: Record<string, string> = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",ә:"a",ғ:"gh",қ:"q",ң:"ng",ө:"o",ұ:"u",ү:"u",һ:"h",і:"i",ї:"yi",є:"ye",ґ:"g" };
const addAlias = (alias: string, word: string) => {
  if (urgencyAliases.has(alias) && urgencyAliases.get(alias) !== word) urgencyAliases.set(alias, null);
  else urgencyAliases.set(alias, word);
};
for (const word of urgencyWords) {
  addAlias(word, word);
  const latin = [...word].map(c => cyrToLatin[c] ?? c).join("");
  addAlias(latin, word);
  addAlias(latin.replaceAll("gh", "g"), word);
  if (word.length >= 7) for (let i = 1; i < word.length - 1; i++) addAlias(word.slice(0, i) + word.slice(i + 1), word);
}
const joinedSubject = /^(?:меня|мене|нас|нам|мне|мени|meni|menga|игра|гра|игрок|гравець|o'yinchi|(?:аккаунт|акаунт|сервер|инвентар|akkaunt|server|topshiriq|inventar)[\p{L}]{0,7})$/u;

function urgencyNormalize(input: string) {
  return mapEditableParts(input, part => part.replace(/[\p{L}]+(?:['‘’ʻʼ][\p{L}]+)*/gu, token => {
    const key = token.toLowerCase().replace(/[‘’ʻʼ]/gu, "'");
    const known = urgencyAliases.get(key);
    if (known) return known;
    const timeAndEvent = /^(сейчас|зараз|казир|hozir)((?:обмен|сделк|обмин|угод|айырбас|ayirbosh|almash|savdo|bitim)[\p{L}]+)$/u.exec(key);
    if (timeAndEvent) return `${timeAndEvent[1]} ${timeAndEvent[2]}`;
    for (let i = 3; i < key.length - 2; i++) {
      const start = key.slice(0, i), tail = urgencyAliases.get(key.slice(i));
      if (tail && joinedSubject.test(fold(start))) return `${start} ${tail}`;
      const head = urgencyAliases.get(start);
      if (head && tail) return `${head} ${tail}`;
    }
    return token;
  }));
}

function has(text: string, pattern: string) { return atWord(pattern, "u").test(text); }
function fold(text: string) {
  const letters: Record<string, string> = { ё: "е", ә: "а", ғ: "г", қ: "к", ң: "н", ө: "о", ұ: "у", ү: "у", һ: "х", і: "и", ї: "и", є: "е", ґ: "г" };
  return text.normalize("NFKC").toLowerCase().replace(/[‘’ʻʼ`´]/gu, "'").replace(/[ёәғқңөұүһіїєґ]/gu, c => letters[c]).replace(/[\u200b-\u200d\ufeff]/gu, "").replace(/([\p{L}])\1{2,}/gu, "$1").replace(/\s+/gu, " ").trim();
}
function normalized(text: string) { return normalizeGameText(normalizeInputScripts(urgencyNormalize(text)).text); }
function positive(text: string, pattern: string) {
  return [...text.matchAll(atWord(pattern, "gu"))].some(match => {
    const before = text.slice(0, match.index), after = text.slice(match.index! + match[0].length);
    // Negation belongs to this action, not to an earlier incident in the message.
    if (/(?:^|\s)(?:не|ни|не\s+надо|не\s+треба)\s+(?:(?:меня|нас|мне|мене|мени|його|он|они|больше|уже)\s+){0,3}$/u.test(before)) return false;
    if (/^\s*(?:жок|емес|emas)(?![\p{L}\p{N}_])/u.test(after)) return false;
    return true;
  });
}
function deniesCurrentAction(text: string) {
  return (has(text, `${liveAction}|${nativeLive}`) && !positive(text, `${liveAction}|${nativeLive}`))
    || has(text, String.raw`(?:урып|олтирип|аткылап)\s+жаткан\s+жок|urmayapti|o'ldirmayapti|otmayapti|so'kmayapti|haqorat\s+qilmayapti`);
}
function result(level: HelpUrgency["level"], eventTime: HelpUrgency["eventTime"], reason: string, evidence: string[], uncertain = false): HelpUrgency {
  return { level, eventTime, uncertain, reason, evidence: [...new Set(evidence)].slice(0, 3).map(s => s.slice(0, 180)), needsLiveObservation: level === "now", ...(uncertain ? { followUp: "Это происходит сейчас? Укажите место и ID игрока, если он известен." } : {}) };
}

type Analysis = { urgency: HelpUrgency; guarded: boolean; incident: boolean };
function inspect(input: string): Analysis {
  const source = normalized(input);
  let editable = contextText(source);
  // A present-tense report by a witness can carry current evidence. Other quotes,
  // commands, URLs and nicknames remain data, never evidence of a current event.
  for (const quote of source.matchAll(/«([^»]+)»|"([^"\n]+)"|“([^”]+)”/gu)) {
    const before = fold(source.slice(0, quote.index).split(/[.!?;\n]/u).at(-1) ?? "");
    if (has(before, String.raw`пишет|кричит|каже|пише|жазып\s+жатыр|айтып\s+жатыр|yozyapti|aytyapti`) && !has(before, `${past}|${hypothetical}|${meta}`)) editable += `; ${quote[1] || quote[2] || quote[3]}`;
  }
  const text = fold(editable);
  const clauses = text.split(/[.!?;\n]+|\s+(?:но|зато|але|бирак|lekin)\s+|,\s*(?=(?:а\s+)?(?:теперь|сейчас|зараз|казир|hozir))/u).map(s => s.trim()).filter(Boolean);
  const candidates: HelpUrgency[] = [];
  let guarded = /[«“"]/u.test(source), incident = false, hasPast = false, priorRestraint = false;
  for (let clause of clauses) {
    // Courtesy conditionals do not make the reported attack hypothetical.
    clause = clause.replace(atWord(String.raw`если\s+(?:можете|можно)|якщо\s+можете|егер\s+мумкин\s+болса|agar\s+imkon\s+bo'lsa`, "gu"), " ");
    const live = positive(clause, `${liveAction}|${nativeLive}`), observation = positive(clause, liveObservation), security = positive(clause, ongoingSecurity);
    const complete = positive(clause, completedAction), blocked = positive(clause, `${blockingState}|${gameBlock}`);
    const loss = positive(clause, unresolvedLoss) || (has(clause, property) && positive(clause, missingProperty));
    const explicitCurrent = has(clause, current), historical = has(clause, past);
    const carriedRestraint = priorRestraint;
    priorRestraint = positive(clause, restraints) && !has(clause, `${past}|${hypothetical}|${meta}|${ended}`);
    const activeRestraint = (priorRestraint || carriedRestraint) && positive(clause, transporting);
    const liveTrade = explicitCurrent && has(clause, String.raw`сделк${L}|обмен${L}|угод${L}|обмин${L}|айырбас|мамиле${L}|obmen${L}|sdelk${L}|obmin${L}|ugod${L}|almash${L}|ayirbosh${L}|savdo${L}|bitim${L}`) && positive(clause, String.raw`подменя${L}|заменя${L}|пидминя${L}|ауыстырып\s+жатыр|almashtir(?:yapti|ishyapti)`);
    const abnormalFlight = explicitCurrent && positive(clause, String.raw`летает|летают|литае|литають|ушып\s+жатыр|uch(?:yapti|ishyapti)`) && has(clause, String.raw`без\s+(?:машин${L}|транспорт${L}|вертолет${L}|самолет${L}|геликоптер${L})|коликсиз|mashinasiz|transportsiz`);
    incident ||= live || observation || security || complete || blocked || loss || activeRestraint || liveTrade || abnormalFlight || has(clause, "дм|дб|dm|db|нападение|нарушение");
    if (has(clause, meta) || has(clause, hypothetical)) { guarded = true; continue; }
    if (deniesCurrentAction(clause)) guarded = true;
    if (has(clause, ended)) { guarded = true; hasPast = true; continue; }
    if (historical && !explicitCurrent) {
      guarded = true; hasPast = true;
      candidates.push(result("normal", "past", "Описан прошлый эпизод; продолжающаяся опасность не указана.", [clause]));
      continue;
    }
    if (live || security || activeRestraint || liveTrade || abnormalFlight || (observation && (explicitCurrent || has(clause, String.raw`летает|стреля${L}|летить|стриля${L}|спек|проследите|наблюда${L}|тексер${L}|kuzat${L}`)))) {
      candidates.push(result("now", "ongoing", security ? "Описан продолжающийся доступ к аккаунту или вывод имущества; нужно срочное вмешательство." : "Событие продолжается: администратору нужно успеть вмешаться или зафиксировать его.", [clause], has(clause, String.raw`кажется|возможно|похоже|мабуть|здаеться|сиякты|мумкин|balki`)));
    } else if (blocked || loss) {
      candidates.push(result("high", "ongoing", "Описана сохраняющаяся проблема с игрой, доступом или имуществом.", [clause]));
    } else if (complete) {
      hasPast = true;
      candidates.push(result("normal", "past", "Описан завершённый эпизод; обращение остаётся для разбора администратором.", [clause]));
    } else if (has(clause, liveAction) || has(clause, blockingState) || has(clause, ongoingSecurity)) {
      // A translated variant must not turn a denied source event into an attack.
      guarded = true;
    }
  }
  const order = { now: 0, high: 1, normal: 2 };
  candidates.sort((a, b) => order[a.level] - order[b.level]);
  const urgency = candidates[0] ?? (hasPast
    ? result("normal", "past", "Событие завершилось; обращение сохраняется для рассмотрения.", [])
    : result("normal", "unknown", "Нет достаточных признаков срочного текущего события.", [], !guarded));
  return { urgency, guarded, incident };
}

/** Called only for the Help route. Urgency schedules observation; it does not
 * establish that a rule was broken, impose punishment or close a complaint. */
export function assessHelpUrgency(original: string, understood?: string, context?: { answerText: string }): HelpUrgency {
  const source = inspect(original);
  let initial = source.urgency;
  // Original temporal/quotation/negation evidence takes precedence over an
  // incomplete dictionary translation. Translation is only an evidence fallback.
  if (initial.eventTime === "unknown" && !source.guarded && understood && understood !== original) {
    const translated = inspect(understood).urgency;
    if (translated.eventTime !== "unknown") initial = translated;
  }
  if (!context?.answerText.trim()) return initial;
  const answer = inspect(context.answerText), text = fold(contextText(normalized(context.answerText)));
  // Latest explicit facts replace old urgency; irrelevant answers (such as a
  // location or player ID) do not erase the continuing incident.
  if (answer.urgency.level !== "normal") return answer.urgency;
  if (has(text, ended) || answer.urgency.eventTime === "past" || /^(?:нет|ни|жок|yo'q)[.!\s]*$/u.test(text)) {
    return result("normal", "past", "В последнем уточнении указано, что событие закончилось или происходило раньше.", [context.answerText]);
  }
  if (deniesCurrentAction(text) && !has(text, `${hypothetical}|${meta}`)) {
    return result("normal", "past", "Последнее уточнение отрицает продолжающееся событие; жалоба остаётся на рассмотрении.", [context.answerText]);
  }
  if (has(text, current) && !has(text, `${hypothetical}|${meta}`) && (source.incident || initial.level !== "normal")) {
    return result(initial.level === "high" ? "high" : "now", "ongoing", "Последнее уточнение подтверждает, что проблема продолжается.", [context.answerText]);
  }
  return initial;
}
