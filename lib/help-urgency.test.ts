import { test } from "node:test";
import assert from "node:assert/strict";
import { assessHelpUrgency, type HelpUrgency } from "./help-urgency.ts";

const cases: [string, HelpUrgency["level"], HelpUrgency["eventTime"]][] = [
  ["Меня бьют у спавна, помогите", "now", "ongoing"],
  ["Новичков убивают возле банка", "now", "ongoing"],
  ["321 ДБшит на парковке, админ в спек", "now", "ongoing"],
  ["Менядмятвзз помогите", "now", "ongoing"],
  ["Меня вчера убили без причины, проверьте запись", "normal", "past"],
  ["Меня убивали возле банка, есть запись", "normal", "past"],
  ["Мене вбивали біля банку, перевірте", "normal", "past"],
  ["Завтра они будут убивать всех, что делать?", "normal", "unknown"],
  ["Меня убили, но сейчас он убивает других у спавна", "now", "ongoing"],
  ["Вчера он стреляет в меня на записи", "normal", "past"],
  ["Меня не бьют, просто спрашиваю", "normal", "unknown"],
  ["Меня не бьют, но игрок расстреливает новичков", "now", "ongoing"],
  ["Если меня будут убивать, что делать?", "normal", "unknown"],
  ["Если можете, помогите, меня убивают", "now", "ongoing"],
  ["Что значит «меня ДМят»?", "normal", "unknown"],
  ["Игрок написал вчера «меня убивают»", "normal", "past"],
  ["Новичок пишет «меня убивают», он у банка", "now", "ongoing"],
  ["Застрял в текстурах, вытащите", "high", "ongoing"],
  ["Не могу выйти из машины", "high", "ongoing"],
  ["Вчера застрял в текстурах, сейчас уже выбрался", "normal", "past"],
  ["Меня держат в наручниках, полицейские ушли", "high", "ongoing"],
  ["Сейчас с аккаунта выводят мои деньги", "now", "ongoing"],
  ["Потерял доступ к аккаунту", "high", "ongoing"],
  ["Проверьте мой вчерашний мут", "normal", "past"],
  ["СРОЧНО!!! СРОЧНО!!!", "normal", "unknown"],
  ["Меня сейчас оскорбляет игрок в войсе, зайдите послушать", "now", "ongoing"],
  ["Читер сейчас летает над спавном", "now", "ongoing"],
  ["Мене зараз вбивають біля банку", "now", "ongoing"],
  ["Мене вчора вбили, подивіться запис", "normal", "past"],
  ["Якщо мене вбивають, як подати скаргу?", "normal", "unknown"],
  ["Мене не вбивають", "normal", "unknown"],
  ["Не можу вийти з машини", "high", "ongoing"],
  ["Мені допомога не потрібна, вже випустили", "normal", "past"],
  ["Мені қазір ұрып жатыр, көмектесіңіз", "now", "ongoing"],
  ["Мені кеше өлтірді, тексеріңіз", "normal", "past"],
  ["Егер мені ұрып жатыр десем не болады?", "normal", "unknown"],
  ["Мені ұрып жатыр жоқ", "normal", "unknown"],
  ["Аккаунтқа кіре алмаймын", "high", "ongoing"],
  ["Meni hozir uryapti, yordam bering", "now", "ongoing"],
  ["Meni kecha o'ldirdi, tekshiring", "normal", "past"],
  ["Agar meni uryapti desam nima bo'ladi?", "normal", "unknown"],
  ["Meni urmayapti", "normal", "unknown"],
  ["Mashinadan chiqolmayapman", "high", "ongoing"],
  ["Hammasi tugadi, yordam kerak emas", "normal", "past"],
  ["Menya ubivayut seychas pomogite", "now", "ongoing"],
  ["https://example.org/меня-убивают — проверьте адрес", "normal", "unknown"],
  ["/nick МеняУбивают", "normal", "unknown"],
  ["Менядавят рядом с автосалоном", "now", "ongoing"],
  ["Він давять мене біля гаража", "now", "ongoing"],
  ["Мені автобустың алдында басып жатыр", "now", "ongoing"],
  ["Meni bosishyapti, admin tekshiring", "now", "ongoing"],
  ["Ол ДМ жасап жатыр, әкімші қараңыз", "now", "ongoing"],
  ["DM qilishyapti, admin hozir qarang", "now", "ongoing"],
  ["Мені ДМлять на дорозі", "now", "ongoing"],
  ["Меня связали, везут к воде без отыгровки", "now", "ongoing"],
  ["Мене зв’язали та везуть у ліс", "now", "ongoing"],
  ["Мені байлап алып кетіп жатыр", "now", "ongoing"],
  ["Менібайлап, қазір алып бара жатыр", "now", "ongoing"],
  ["Meni bog'lab olib ketishyapti", "now", "ongoing"],
  ["Meni bog‘lab, hozir olib ketishyapti", "now", "ongoing"],
  ["Вчера меня связали и везут на этом видео", "normal", "past"],
  ["Сейчас при обмене подменяет дорогую машину", "now", "ongoing"],
  ["Қазір мәміледе затты ауыстырып жатыр", "now", "ongoing"],
  ["Срочно исчезли вещи после сделки", "high", "ongoing"],
  ["Мої речі зникли, відновіть", "high", "ongoing"],
  ["Инвентарьдан зат жоғалды", "high", "ongoing"],
  ["Inventardan buyum yo‘qoldi", "high", "ongoing"],
  ["Мой товар не пришёл, оплата списалась", "high", "ongoing"],
  ["Товар не прийшов після оплати", "high", "ongoing"],
  ["Тауар келмеді, ақша алынды", "high", "ongoing"],
  ["Pul olindi, buyum kelmadi", "high", "ongoing"],
  ["Игра вылетает, зайти не могу", "high", "ongoing"],
  ["Відновлював пароль, увійти не можу", "high", "ongoing"],
  ["Ойын жабылып қалады", "high", "ongoing"],
  ["O'yin yopilib qolyapti", "high", "ongoing"],
  ["Аккаунтымакіре алмаймын", "high", "ongoing"],
  ["Servergakira olmayapman", "high", "ongoing"],
  ["Потерял доступ, восстановление не работает", "high", "ongoing"],
  ["Потерялдоступ, верните пожалуйста", "high", "ongoing"],
  ["Он стрляет по всем", "now", "ongoing"],
  ["45 qazir atyp zhatyr", "now", "ongoing"],
  ["Zadanie zavislo, personazh ne dvigaetsya", "high", "ongoing"],
  ["Машина не исчезла, прошу только проверку", "normal", "unknown"],
  ["Мене розстрілюють, зараз на парковці", "now", "ongoing"],
  ["Мене не розстрілюють, але потрібен розбір", "normal", "unknown"],
  ["Игрок сейчас летает без транспорта, проверьте", "now", "ongoing"],
  ["Гравець зараз літає без машини", "now", "ongoing"],
  ["O'yinchihozir masinasiz uchyapti", "now", "ongoing"],
  ["Игрок вчера летает без машины на видеозаписи", "normal", "past"],
  ["Игра сейчас вылетает", "high", "ongoing"],
  ["Игравылетает постоянно", "high", "ongoing"],
  ["Гравилітає під час входу", "high", "ongoing"],
  ["Сервер не пускає друзів", "high", "ongoing"],
  ["Server meni kiritmayapti", "high", "ongoing"],
  ["Він зараз стрляє", "now", "ongoing"],
  ["Hali ham otypti", "now", "ongoing"],
  ["seychas pri sdelke podmenyaet mashinu", "now", "ongoing"],
  ["zaraz pidminyaye predmet pid chas obminu", "now", "ongoing"],
  ["Hozirayirboshlashda almashtiryapti buyumni", "now", "ongoing"],
];

for (const [text, level, eventTime] of cases) {
  test(`help urgency: ${text}`, () => {
    const urgency = assessHelpUrgency(text);
    assert.equal(urgency.level, level);
    assert.equal(urgency.eventTime, eventTime);
    assert.equal(urgency.needsLiveObservation, level === "now");
    assert.ok(urgency.reason.length > 10);
  });
}

test("Latest ended event overrides an old attack without deleting the complaint", () => {
  const urgency = assessHelpUrgency("Меня убивают", undefined, { answerText: "Уже всё закончилось" });
  assert.equal(urgency.level, "normal");
  assert.equal(urgency.eventTime, "past");
});
test("Current clarification revives an old incident", () => {
  const urgency = assessHelpUrgency("Вчера меня ДМили", undefined, { answerText: "Да, сейчас снова" });
  assert.equal(urgency.level, "now");
});
test("Location-only clarification does not erase a current incident", () => {
  assert.equal(assessHelpUrgency("Меня бьют", undefined, { answerText: "У банка, ID 321" }).level, "now");
});
test("A resolved current event can become a persistent block", () => {
  assert.equal(assessHelpUrgency("Меня бьют", undefined, { answerText: "Уже не бьют, но не могу выйти из машины" }).level, "high");
});
test("A new current attack outranks an ended incident in the same clarification", () => {
  assert.equal(assessHelpUrgency("Меня бьют", undefined, { answerText: "Меня уже убили, но теперь он убивает других" }).level, "now");
});
test("Uncertain but concrete current incident remains visible immediately", () => {
  const urgency = assessHelpUrgency("Кажется, читер сейчас стреляет через стены");
  assert.equal(urgency.level, "now");
  assert.equal(urgency.uncertain, true);
  assert.ok(urgency.followUp);
});
test("Urgent wording without an event requests details", () => {
  const urgency = assessHelpUrgency("Срочно сюда админ!!!");
  assert.equal(urgency.uncertain, true);
  assert.ok(urgency.followUp);
});
test("Translation cannot remove explicit negation or historical context", () => {
  assert.equal(assessHelpUrgency("Мене вчора вбили", "Меня убивают").level, "normal");
  assert.equal(assessHelpUrgency("Меня не бьют", "Меня бьют").level, "normal");
  assert.equal(assessHelpUrgency("Meni hozir urmayapti", "Меня сейчас бьют").level, "normal");
  assert.equal(assessHelpUrgency("Қазір ұрып жатқан жоқ", "Сейчас бьют").level, "normal");
});
test("Understood text supplies evidence only when original has no conflicting guard", () => {
  assert.equal(assessHelpUrgency("Неизвестное слово", "Меня бьют у спавна").level, "now");
});
test("Current denial in the latest answer cancels stale urgency in all four languages", () => {
  for (const answerText of ["Уже не бьют", "Зараз мене не вбивають", "Қазір ұрып жатқан жоқ", "Meni hozir urmayapti"]) {
    const urgency = assessHelpUrgency("Меня бьют у банка", undefined, { answerText });
    assert.equal(urgency.level, "normal", answerText);
    assert.equal(urgency.eventTime, "past", answerText);
  }
});
