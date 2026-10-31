import assert from "node:assert/strict";
import {test} from "node:test";
import {inspectModeration} from "./message-moderation.ts";
import {processMessageWithTrace} from "./message-processing.ts";

const violations = [
  "не согл крч Пон?🐷🐷🐷🇺🇦🇺🇦🇺🇦🧑🏻‍🦽‍➡️🪓🪓🪓✅",
  "не согласен, короче пон? 🐷 🐷 🐷",
  "Поняли? 🤡🤡🤡",
  "ну плачь 🐷🐷🐷",
  "это просто шутка 🤡🤡🤡",
  "Админы, 🐷🐷🐷 снимите бан",
  "ты 🤡🤡🤡",
  "Он написал «помоги». Админы, 🤡🤡🤡",
  "Я говорю тебе: «пон? 🐷🐷🐷»",
];
for (const text of violations) test(`mocking spam is terminal: ${text}`, () => {
  const result = processMessageWithTrace(text);
  assert.equal(result.status, "violation");
  assert.equal(result.processing.route, "violation");
  assert.equal(result.processing.needsClarification, false);
  assert.equal(result.processing.topic, "Провокационный спам");
  assert.equal(result.processing.steps.some(step => step.id === "corrected"), false);
  assert.equal(result.processing.steps.at(-1)?.id, "routed");
});

const protectedExamples = [
  "Не согласен с баном, проверьте доказательства 🐷🐷🐷",
  "не согл крч пон?",
  "Пон? 🐷",
  "Пон? 🇺🇦🇺🇦🇺🇦",
  "Пон? 🧑🏻‍🦽‍➡️🧑🏻‍🦽‍➡️🧑🏻‍🦽‍➡️",
  "Меня убили 🪓🪓🪓 помогите",
  "Спасибо админы ❤️❤️❤️",
  "Помогите админы 😭😭😭 не могу зайти",
  "Где купить маску свиньи 🐷🐷🐷?",
  "Как получить скин клоуна 🤡🤡🤡?",
  "Что значит пон 🐷🐷🐷?",
  "Нельзя писать пон 🐷🐷🐷",
  "Игрок написал: пон? 🐷🐷🐷",
  "пон? 🐷🐷🐷 — написал мне игрок",
  "Мне написали «пон? 🐷🐷🐷», накажите игрока",
  "Админы, «пон? 🐷🐷🐷» — это цитата",
  "Игрок с ником «пон? 🐷🐷🐷» меня убил",
  "Этот пидорас заебал меня, damn it, помогите админы",
];
for (const text of protectedExamples) test(`mocking spam preserves context: ${text}`, () => {
  assert.notEqual(inspectModeration(text).kind, "violation");
});
