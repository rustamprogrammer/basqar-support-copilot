import assert from "node:assert/strict";
import { test } from "node:test";
import { processMessageWithTrace as process } from "./message-processing.ts";

// Contrastive policy fixtures: authored independently from runtime decisions.
// No texts from the closed 100-message evaluation set are used here.
const cases = [
  ["incident: another player's DM", "Игрок 27 ДМит меня возле банка", "report", "Жалоба на игрока"],
  ["appeal: DM is the disputed charge", "Меня посадили за ДМ, хотя я никого не убивал. Прошу снять наказание", "report", "Обжалование наказания"],
  ["question: definition of DM", "Что такое ДМ?", "report", "Вопрос по игре"],
  ["help: DB is background for recovery", "Верните мою машину, она застряла после ДБ", "report", "Помощь в игре"],
  ["local denial does not erase the other player's action", "Я не ДМил, меня ДМит игрок 27", "report", "Жалоба на игрока"],
  ["bare denial has no stated request", "Я не ДМил", "clarify", "Нужно уточнение"],
  ["denial of cheats does not negate a separate complaint", "У меня нет читов, но игрок 27 ДМит меня", "report", "Жалоба на игрока"],
  ["denial and own ban identify an appeal", "У меня нет читов, снимите мой бан", "report", "Обжалование наказания"],
  ["negated shooting does not negate a scam", "Он не стрелял, но обманул меня при продаже машины", "report", "Жалоба на игрока"],
  ["negated killing does not negate DB", "Меня не убили, а ДБшат у магазина", "report", "Жалоба на игрока"],
  ["quoted insult belongs to a reported player", "Игрок написал: «ты идиот». Прошу проверить оскорбление", "report", "Жалоба на игрока"],
  ["unattributed quotation is insufficient", "«Я ДМлю»", "clarify", "Нужно уточнение"],
  ["neutral reported speech is not automatically a complaint", "Он написал «помогите»", "clarify", "Нужно уточнение"],
  ["question about an offensive phrase is not authored abuse", "Что означает выражение «сын шлюхи»?", "report", "Вопрос по игре"],
  ["quoted unban request does not override a technical problem", "Машина застряла. В чате советуют написать «разбаньте», но мне нужно достать машину", "report", "Помощь в игре"],
  ["administration is the subject of an inaction complaint", "Администратор не отвечает на мою жалобу о ДБ", "report", "Действия администрации"],
  ["admin as addressee does not change a player complaint", "Админ, игрок 48 ДБшит у банка", "report", "Жалоба на игрока"],
  ["request to ban another player is not own appeal", "Дайте бан игроку 512: он ДМит прохожих", "report", "Жалоба на игрока"],
  ["request to remove own ban is an appeal", "Снимите мне бан за ДМ, прошу пересмотреть доказательства", "report", "Обжалование наказания"],
  ["role-play police arrest is a player action", "Полицейский 70 посадил меня в тюрьму без отыгровки РП", "report", "Жалоба на игрока"],
  ["admin punishment is an appeal", "Администратор посадил меня за ДМ на час без причины", "report", "Обжалование наказания"],
  ["procedure question is not an existing complaint", "Как подать жалобу на ДМ?", "report", "Вопрос по игре"],
  ["polite introduction does not erase own punishment", "Подскажите, почему мне выдали мут за оскорбление?", "report", "Обжалование наказания"],
  ["concrete repair request", "Почините машину, двигатель не работает", "report", "Помощь в игре"],
  ["vehicle damage without recovery request is a complaint", "Игрок перевернул мою машину и продолжает ДБшить", "report", "Жалоба на игрока"],
  ["login problem", "Не могу зайти, появляется ошибка подключения", "report", "Помощь в игре"],
  ["missing property", "У меня пропала квартира, я её не продавал", "report", "Аккаунт и имущество"],
  ["payment did not arrive", "Оплатил донат, покупка не пришла", "report", "Платёж"],
  ["work procedure question", "Как устроиться на работу водителем автобуса?", "report", "Вопрос по игре"],
  ["event timing question", "Когда начинается мероприятие на сервере?", "report", "Вопрос по игре"],
  ["bare help request needs detail", "Помогите, пожалуйста", "report", "Помощь в игре"],
  ["known short jargon can convey an incident", "ДБ у автомойки", "report", "Жалоба на игрока"],
  ["bare unknown rule number needs detail", "1.4", "clarify", "Нужно уточнение"],
  ["explicit cancellation", "Помощь больше не нужна", "trash", "Мусор"],
  ["numbers alone", "123456", "trash", "Мусор"],
  ["help in a nickname is not a request", "Игрок Help_Admin44 ДБшит", "report", "Жалоба на игрока"],
  ["negated hypothetical ban does not override repair", "Не нужно меня банить, почините мою машину", "report", "Помощь в игре"],
  ["rough third-person wording with missing incident stays reviewable", "Этот пидорас заебал меня, damn it, помогите админы", "report", "Помощь в игре"],
  ["help request does not excuse an authored insult", "Админ, ты идиот, помоги", "violation", "Оскорбление в обращении"],
  ["joke marker does not excuse an authored insult", "Ты идиот, это шутка", "violation", "Оскорбление в обращении"],
] as const;

for (const [name, input, classification, topic] of cases) {
  test(`v3 contrast: ${name}`, () => {
    const result = process(input);
    assert.equal(result.processing.classification, classification, input);
    assert.equal(result.processing.topic, topic, input);
    assert.equal(result.status, classification === "violation" ? "violation" : classification === "trash" ? "trash" : "pending");
  });
}

for (const input of ["Памагите, у меня ашибка входа", "Игрок 27 ДМит меня", "Админ, ты идиот", "Спасибо", "Не знаю, что это"]) {
  test(`v3 uses rules only: ${input}`, () => {
    const trace = process(input).processing;
    assert.equal(trace.decisionSource, "rules");
    assert.equal(trace.model, undefined);
    assert.equal(trace.steps.some(step => step.id === "model"), false);
  });
}
