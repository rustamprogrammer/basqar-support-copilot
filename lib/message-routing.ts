import {atWord, contextText} from "./game-language.ts";
import {classifyMessage, type Decision} from "./message-classification.ts";
import {analyzeRequest} from "./request-analysis.ts";
import type {MessageRoute} from "./message-types.ts";
import {inspectRoutingEvidence} from "./routing-evidence.ts";
import {isSocialOnly} from "./message-trash.ts";
import {inspectSettingsQuestion} from "./settings-question.ts";
import {inspectMultilingualIntent} from "./multilingual-routing.ts";

export type RoutingDecision = Decision & {route: MessageRoute | null; needsClarification: boolean; missingDetails: string[]};
const match = (text: string, expression: string) => atWord(expression).test(text);

// Match the requested outcome across the whole message, before legacy subtopics.
export function routeMessage(original: string, corrected: string, understood: string): RoutingDecision {
  const legacy = classifyMessage(original, corrected, understood);
  const analysis = analyzeRequest(original, understood);
  const text = contextText(understood).toLowerCase().replaceAll("ё", "е");
  const has = (expression: string) => match(text, expression);
  const choose = (route: MessageRoute | null, ruleId: string, reason: string): RoutingDecision => {
    const followUp = route === null ? legacy.followUp || "Что вы хотите узнать или какую помощь получить?" : route === "help" ? legacy.followUp : undefined;
    return {...legacy, route, status: route === "trash" ? "trash" : "pending",
      classification: route === "trash" ? "trash" : route === null ? "clarify" : "report",
      topic: route === "question" ? "Вопрос по игре" : route === null ? "Нужно уточнение" : route === "trash" ? "Мусор" : legacy.classification === "report" && legacy.topic !== "Вопрос по игре" ? legacy.topic : "Помощь в игре",
      ruleId, reason, followUp, needsClarification: !!followUp, missingDetails: followUp ? [route === null ? "purpose" : "incident-details"] : []};
  };
  if (legacy.classification === "trash") return choose("trash", legacy.ruleId!, legacy.reason);
  if (isSocialOnly(original)) return choose("trash", "route.social-only", "В сообщении только приветствие или посторонняя реплика, без вопроса или просьбы о помощи.");
  const settings = inspectSettingsQuestion(text);
  if (settings.intervention) return choose("help", "route.settings-problem", "Описана неполадка настройки или запрошено действие администратора.");

  const requestedSanction=has("(?:требую|прошу)\\s+(?:чтобы\\s+)?(?:(?:ему|ей|игроку|данному\\s+игроку)\\s+)?(?:дали|дать|выдать|применить|назначить|наказали|наказать)|расс?мотрите\\s+(?:жб|жалоб[а-я]*)");
  const currentObstacle=has("что\\s+делать") && (has("сайт.{0,40}не\\s+работает") || (has("наручники|связали")&&has("ушли|бросили|уже|второй\\s+раз")));
  const rhetoricalIncident=analysis.hasPositiveIncident && has("каким\\s+образом\\s+(?:это\\s+)?происходит|и\\s+(?:потом|еще)\\s+(?:можете|скажите|сколько)");
  if(requestedSanction||currentObstacle||rhetoricalIncident)return choose("help","route.case-before-information","Есть самостоятельная просьба вмешаться или текущая проблема; вопрос внутри обращения не отменяет её.");

  const review = has("не\\s*соглас[а-я]*|не\\s+согл|обжалую|пересмотрите|прошу\\s+пересмотр|не\\s*правильн[а-я]*\\s+выдач[а-я]*|(?:мои|мое)\\s+(?:активные\\s+)?наказани[а-я]*|где\\s+(?:тут\\s+(?:дм|дб|сбив|софт|\\d+\\.\\d+)|вы\\s+увидели|я\\s+софтер)|какой\\s+(?:дм|дб|сбив|бв)|причем\\s+тут\\s+я");
  if (review) return choose("help", "route.review-request", "Автор оспаривает конкретное решение или просит проверить свою ситуацию.");
  const intervention = has("(?:можете|можешь|можно|сможете|прошу)\\s+(?:(?:вы|вы\\s+мне|мне|меня|пожалуйста|у\\s+меня|пж)\\s+){0,3}(?:убрать|снять|телепортировать|проследить|наказать|починить|вытащить|освободить|разбанить|разблокировать)|(?:можете|прошу)\\s+(?:мне\\s+)?вернуть|можно\\s+(?:мне\\s+)?(?:адвоката|лицензию)|(?:вытащите|спек|следите|ко\\s+мне)\\s+(?:пж|срочно)|на\\s+(?:колеса|сушу)\\s+(?:пожалуйста|с\\s+машиной)|админ[а-я]*\\s+(?:сюда|суда|приди)");
  if (intervention) return choose("help", "route.intervention", "Запрошено действие администратора, а не инструкция.");
  const begging = has("дайте|подари[а-я]*") && has("на\\s+мечту|хочу\\s+(?:лям|миллион)|\\d+\\s*(?:кк|миллион[а-я]*)") && !has("пропал[а-я]*|украл[а-я]*|обман[а-я]*|верни[а-я]*|не\\s+приш[а-я]*");
  if (begging) return choose("trash", "route.unsupported-request", "Запрошен подарок, без сообщения о проблеме или вопроса по игре.");

  let informationCommand = false;
  const actionText = text.replace(atWord("(?:дайте|пришлите|покажите)\\s+(?:(?:мне|нам|пожалуйста|пж)\\s+){0,2}(?:ссылку\\s+на\\s+(?:форум|правила)|правило|правила|определение|инструкцию|совет|объяснение|ответ)", "gu"), (command, offset: number) => {
    const tail = text.slice(offset + command.length).split(/[.!?;\n]/u)[0];
    if (atWord("(?:по\\s+которому|на\\s+основании\\s+которого).{0,60}(?:меня|мне).{0,40}(?:бан[а-я]*|забан[а-я]*|наказ[а-я]*|мут[а-я]*)").test(tail)) return command;
    informationCommand = true;
    return " ";
  });

  const procedure = has("(?:как|где)\\s+(?:(?:мне|нам|можно|надо|нужно|правильно|его|ее|это|самому|самостоятельно)\\s+){0,3}(?:[а-я]{3,}(?:ть|ться)|[а-я]{3,}ить)|как\\s+(?:узнать|подать|написать|отправить|создать|оформить|восстановить)|каким\\s+образом|порядок\\s+(?:подачи|восстановления)");
  const definition = has("что\\s+(?:такое|значит|означает|обозначает)|что\\s+за\\s+(?:команда|правило|термин)|значени[а-я]*\\s+(?:слова|термина)");
  const rulesQuestion = has("(?:можно|разрешено|запрещено)\\s+ли|имеет\\s+ли\\s+право|(?:за\\s+что|когда)\\s+(?:дают|выдают|выдается|полагается)|(?:какой|какие|какую|каком|какому)\\s+(?:пункт[а-я]*|правил[а-я]*|срок[а-я]*|уров[а-я]*|наказани[а-я]*)|сколько\\s+(?:длится|дают|дней|минут)|(?:бан|мут|варн)\\s+или\\s+(?:бан|мут|варн)");
  const locationQuestion = has("где\\s+(?:(?:можно|мне|тут|здесь)\\s+)?(?:найти|взять|забрать|купить|работать|находится|посмотреть|получить|менять)|когда\\s+(?:будет|начинается|заканчивается|открывается)|во\\s+сколько|сколько\\s+(?:стоит|нужно)");
  const conceptual = has("где\\s+(?:написано|указано)|(?<!за\\s)(?:это|ето)\\s+(?:варн|бан|мут)|отгадать\\s+(?:слово|загадку)") || (has("если") && has("значит") && /\?/u.test(text));
  const reportedQuestion = has("(?:я|он|она)\\s+спросил[а-я]*") && (analysis.hasPositiveIncident || has("он\\s+сказал|оск"));
  const information = !reportedQuestion && (informationCommand || procedure || definition || rulesQuestion || locationQuestion || settings.informational || conceptual || has("что\\s+делать|можно\\s+вернуть\\s+как[- ]то"));
  const personalLookup = has("(?:кто|почему|зачем|за\\s+что)\\s+(?:(?:же|именно|мне|меня|вы|он|она|админ[а-я]*)\\s+){0,3}(?:дал[аи]?|выдал[а-я]*|забанил[а-я]*|наказал[а-я]*|замутил[а-я]*|посадил[а-я]*|откинул[а-я]*)|(?:до\\s+какого|когда\\s+(?:закончится|снимут|снимется))\\s+(?:числа\\s+)?(?:мой\\s+)?(?:бан|мут|варн)|за\\s+что\\s+(?:мне|меня)\\s+(?:бан|мут|варн)|кто\\s+(?:меня\\s+)?забанил");
  const instructionalLookup = procedure && has("как\\s+(?:(?:мне|можно)\\s+)?(?:узнать|посмотреть|проверить)");
  const explicitAction = match(actionText.replace(atWord("вытащить|починить", "gu"), " "), "разберитесь|проверьте|пересмотрите|разбаньте|разбанте|снимите|снемите|сними|уберите|вытащи[а-я]*|достань[а-я]*|достаньте|достанте|верни[а-я]*|верните|почини[а-я]*|переверни[а-я]*|телепортируйте|тепните|тпхни|тпхните|тепехните|перенесите|восстановите|разблокируйте|откройте|освободите|накажите|забаньте|понаблюдайте|следите[е]*|проследите|предоставьте|покажите|дайте|выдайте|измените|смените|поменяйте|меняйте|выпусти[а-я]*|найдите|посмотрите|рассмотрите|обоснуй[а-я]*|примите\\s+меры|прочитайте|пришлите|одобрите|почистите|зовите|заспавньте");
  const actionNegatedOnly = !analysis.hasPositiveIncident && has("(?:не|не\\s+надо|не\\s+нужно)\\s+(?:меня\\s+)?(?:банить|наказывать|помогать|телепортировать|менять|снимать)") && !has("почините|вытащите|верните|проверьте|разбаньте|переверните");
  const plea = has("помогите|помоги|помощь|помочь|хелп|help|sos|сос|спасите");
  const ongoing = has("меня\\s+(?:сейчас\\s+)?(?:убива[а-я]*|дм[а-я]*|бь[её]т|бьют|держат|связали|дб[а-я]*)|(?:убива[а-я]*|дм[а-я]*|бьют|держат)\\s+(?:меня|нас)|застря[а-я]*|не\\s+дает\\s+(?:мне\\s+)?(?:сесть|встать|выйти)");
  const conditional = has("если|допустим|например") && !has("прямо\\s+сейчас|разберитесь|проверьте|вытащите");
  if (explicitAction && !actionNegatedOnly) {
    return choose("help", "route.request-action", "Автор просит действие или разбор конкретной ситуации. Справочная часть не отменяет эту просьбу.");
  }
  if (personalLookup && !instructionalLookup) return choose("help", "route.personal-record", "Для ответа нужны сведения конкретного наказания или действия администратора.");
  if (ongoing && !conditional && (plea || !procedure)) return choose("help", "route.ongoing-problem", "Описана текущая проблема, требующая помощи администратора.");
  const nativeIntent = reportedQuestion ? null : inspectMultilingualIntent(original, corrected);
  if (nativeIntent) return choose(nativeIntent.route, "route.multilingual-purpose", nativeIntent.reason);
  if (information) return choose("question", "route.information", "Автор запрашивает объяснение, правило или инструкцию; самостоятельная просьба о вмешательстве не обнаружена.");
  // A translated failure should retain its purpose even without a generic plea.
  // Keep instructions/hypothetical questions and negated reports out of this rule.
  const currentFailure = has("не\\s+могу\\s+(?:писать|выйти|держать|спустить|закончить)|(?:кнопка|дверь|меню)\\s+не\\s+(?:нажимается|открывается)|(?:деньги|бонус|покупка)\\s+не\\s+(?:зачислились|пришел|отображается)|(?:снова\\s+)?(?:выкидывает|выбрасывает\\s+в\\s+главное\\s+меню)|(?:пароль\\s+неверный|неверный\\s+пароль)");
  const describedOnly = has("не\\s+(?:говорил|писал|утверждал)|что\\s+(?:означает|значит)|например|допустим");
  if (currentFailure && !conditional && !describedOnly) return choose("help", "route.current-failure", "Описана конкретная неполадка или невозможность выполнить действие.");
  if (plea && !has("не\\s+нужна|не\\s+нужна\\s+помощь|помощь\\s+не\\s+нужна")) return choose("help", "route.help-request", "Просьба о помощи уже понятна. Недостающие обстоятельства уточняются отдельно.");
  const evidence = inspectRoutingEvidence(original);
  if (evidence.helpHint || inspectRoutingEvidence(corrected).helpHint) return choose("help", "route.anchored-incident", "Код происшествия связан с игроком или ссылкой на доказательство. Содержимое ссылки и ника не считается словами автора.");
  if (evidence.participants.length && has("спек|проследите|следите")) return choose("help", "route.observe-player", "Указан игрок, за которым просят понаблюдать.");
  if (/^\s*(?:дм|дб|тк|ск|рк|оск|нрп)[\s!?.,]*$/u.test(text) && !/\d/u.test(original)) return choose(null, "route.bare-term", "Указан только термин: неизвестно, требуется его объяснение или помощь с происшествием.");
  if (legacy.classification === "report") return choose(legacy.topic === "Вопрос по игре" ? "question" : "help", "route.legacy-supported", legacy.reason);
  const caseRecord = has("(?:без\\s+причины|просто\\s+так)\\s+(?:садят|посадил[а-я]*|забанил[а-я]*)|(?:посадил[а-я]*|садит|связали|свезали|выдали|заспавнили|заблокировал[а-я]*|кинули\\s+мут|дали\\s+бан)|почему.*(?:забанили|добавили)|(?:мне|меня)\\s+.{0,40}(?:тюрьму|варн|мут|бан|предупреждени[а-я]*)|(?:веревк[а-я]*|верев)\\s+в\\s+зз|(?:машина|тс)\\s+в\\s+(?:текстуре|тестуре)|жду\\s+ник\\s+админа");
  const ruleIncident = has("\\d+\\.\\d+\\s*(?:оп|пго|gz|гз)") && (/(?:^|\s)\d{1,4}\s+\d+\./u.test(text) || has("игрок|нарушени[а-я]*|без\\s+причины|урон|оск|в\\s+ooc|бот") || /[\p{L}]+_[\p{L}\p{N}_]+/u.test(original));
  const conduct = has("хочу\\s+пожаловаться|игрок\\s+\\d+\\s+нарушает|использует\\s+запрещенное\\s+по|нарушение\\s+пункта\\s+правил|не\\s*адекватное\\s+общение|заблуждает\\s+администрацию|не\\s+дал\\s+шанс\\s+на\\s+адвоката|мне\\s+мешаю[а-я]*|(?:кричит|сказал|говорит)\\s+что\\s+(?:я|мою\\s+маму|маму)|(?:оск|упом|упор)\\s+родни|сбив\\s+аним[а-я]*|крупный\\s+сбив|(?:18\\+|порнуха)\\s+(?:объявы|номерные)|взял\\s+без\\s+разрешения|притворяется\\s+фсб|рп\\s+порнуха|без\\s+собеседования|номера\\s+видно\\s+написано");
  if (caseRecord || ruleIncident || conduct || reportedQuestion) return choose("help", "route.case-evidence", "Описан конкретный случай, который должен рассмотреть администратор.");
  if (has("прошу|жду\\s+(?:разбан[а-я]*|сняти[а-я]*|провер[а-я]*|ответ[а-я]*)|обжалую|не\\s+согл[а-я]*|не\\s*соглас[а-я]*|сняти[а-я]*\\s+(?:бана|мута)|восстановлени[а-я]*\\s+доступа")) return choose("help", "route.review-request", "Есть просьба о рассмотрении, восстановлении или ответе по конкретной ситуации.");
  return choose(null, "route.undetermined", "Недостаточно оснований выбрать между вопросом и помощью. Сообщение сохранено для администратора.");
}
