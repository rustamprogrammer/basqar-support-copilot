import {test} from "node:test";
import assert from "node:assert/strict";
import {processMessageWithTrace} from "./message-processing.ts";

// Expectations were written before running the settings rule. These contrast
// instructions with current problems and quoted/underspecified messages.
const cases = [
  [
    "Где выключается только голосовой чат игроков, чтобы звуки двигателя остались?",
    "question"
  ],
  [
    "Графика на низкую где настраивается?",
    "question"
  ],
  [
    "Уровень громкости двигателя через какое меню настраивается?",
    "question"
  ],
  [
    "Как включается чат организации, если я его раньше скрыл?",
    "question"
  ],
  [
    "Какой кнопкой выключается музыка в машине?",
    "question"
  ],
  [
    "Где в настройках микрофон включается, а громкость радио не меняется?",
    "question"
  ],
  [
    "Не нужен разбор, подскажите, где настраивается дальность прорисовки.",
    "question"
  ],
  [
    "Мне не нравится громкий двигатель. Как выключается только его звук?",
    "question"
  ],
  [
    "Объясните пункт «где включается голосовой чат?» — это про меню звука?",
    "question"
  ],
  [
    "Где выключается голосовой чат? Ползунок не сохраняется после перезапуска, проверьте мой аккаунт.",
    "help"
  ],
  [
    "Кнопка выключения чата не работает, администратор, восстановите её пожалуйста.",
    "help"
  ],
  [
    "Как настраивается графика? После обновления у меня чёрный экран, помогите вернуть изображение.",
    "help"
  ],
  [
    "Игрок пишет «где настраивается графика?», а у меня меню зависло, помогите выйти.",
    "help"
  ],
  [
    "Раньше двигатель было слышно, теперь звук совсем пропал и перезапуск не помог, разберитесь.",
    "help"
  ],
  [
    "Включается, выключается, настраивается.",
    null
  ],
  [
    "Мне прислали «где выключается голосовой чат?».",
    null
  ],
  [
    "Графика чат звук настройки",
    null
  ]
] as const;

for (const [source, expected] of cases) test(`settings purpose: ${source}`, () => {
  const result = processMessageWithTrace(source);
  assert.equal(result.processing.route, expected);
});

// Independent review contrasts: failure must beat an informational opening,
// while reported commands and denied failures must not request intervention.
const reviewCases = [
  ["Где в настройках отключается музыка?", "question"],
  ["Где отключается музыка? Ползунок громкости не двигается, помогите.", "help"],
  ["Как включается микрофон? У меня он вообще не работает.", "help"],
  ["В справке написано включите микрофон, а где он настраивается?", "question"],
  ["Я не говорил, что микрофон не работает; где его включить?", "question"],
  ["Если микрофон не работает, где переключить устройство ввода?", "question"],
  ["Что означает «Включите микрофон» и где меняется громкость?", "question"],
  ["Где регулируется звук? Настройте мне микрофон, пожалуйста.", "help"],
  ["В справке написано включите микрофон, но у меня он вообще не работает.", "help"],
] as const;

for (const [source, expected] of reviewCases) test(`settings context: ${source}`, () => {
  assert.equal(processMessageWithTrace(source).processing.route, expected);
});
