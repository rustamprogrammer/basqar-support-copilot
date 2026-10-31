import {atWord} from "./game-language.ts";

const subject = atWord("настройк[а-я]*|голосов[а-я]*|войс|чат[а-я]*|звук[а-я]*|громкост[а-я]*|микрофон[а-я]*|радио|музык[а-я]*|график[а-я]*|интерфейс[а-я]*|управлени[а-я]*|чувствительност[а-я]*|яркост[а-я]*|разрешение\\s+экрана");
const change = "(?:включ|выключ|отключ|переключ|настраив|настра|регулир|измен|меня|уменьш|увелич|убира|скрыва|отображ)[а-я]*(?:ется|ются|ить|ать|ять|яться|ться)";
const query = "(?:где|как|(?:в|через)\\s+как(?:ом|ое)\\s+(?:меню|разделе)|какой\\s+кнопкой)";
const question = atWord(`${query}\\s+(?:[а-я]+[ \\t]+){0,8}(?:${change})|где\\s+(?:[а-я]+[ \\t]+){0,4}(?:настройк[а-я]*|ползунок|переключатель)`);
const reported = atWord("(?:он|она|игрок|я)\\s+(?:спросил[а-я]*|спрашивал[а-я]*|сказал[а-я]*|написал[а-я]*)");
const command = atWord("включите|выключите|отключите|настройте|приглушите|убавьте");
const failure = atWord("(?:кнопка|ползунок(?:\\s+громкости)?|переключатель|микрофон|звук|чат|настройка|у\\s+меня\\s+он)\\s+(?:(?:у\\s+меня|вообще|теперь|совсем)\\s+){0,2}не\\s+(?:работает|нажимается|двигается|сохраняется|включается|выключается)|(?:у\\s+меня\\s+)?(?:пропал|перестал\\s+работать)\\s+(?:звук|чат|микрофон)|у\\s+меня\\s+(?:(?:теперь|совсем)\\s+)?черный\\s+экран|я\\s+(?:уже\\s+)?(?:пробовал|нажимал|отключил).{0,70}(?:все\\s+равно|не\\s+помогло)");
const described = atWord("(?:я|он|она|игрок)\\s+(?:не\\s+)?(?:говорил[а-я]*|сказал[а-я]*|писал[а-я]*|написал[а-я]*|утверждал[а-я]*)|в\\s+(?:справке|инструкции|правилах)\\s+(?:написано|сказано|указано)");

export function inspectSettingsQuestion(text: string) {
  // Call with the unquoted analysis copy. Wording/word order may vary, but a
  // question mark by itself never establishes an informational request.
  const clauses = text.split(/[.!?;\n]/u);
  const informational = clauses.some(clause=>subject.test(clause) && question.test(clause) && !reported.test(clause));
  // An instruction in help text or a denied report is not an action request.
  // A separate contrasting clause may still describe the author's real problem.
  const actionClauses = clauses.flatMap(clause=>clause.split(/,\s*(?:а|но)\s+/u));
  const intervention = subject.test(text) && actionClauses.some(clause=>!described.test(clause) &&
    (command.test(clause) || (failure.test(clause) && !atWord("если|допустим|например").test(clause))));
  return {informational, intervention};
}
