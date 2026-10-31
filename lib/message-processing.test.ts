import assert from "node:assert/strict";
import { test } from "node:test";
import { processMessage, processMessageWithTrace } from "./message-processing.ts";

test("corrects a complete request before routing it", () => {
  assert.deepEqual(processMessage("памагите пажалуста не магу зайти в акаунт"), { text: "Помогите, пожалуйста, не могу зайти в аккаунт", status: "pending", corrected: true });
});
test("keeps message numbers while correcting a problem report", () => {
  assert.deepEqual(processMessage("у миня не атправляится саабщение 123"), { text: "У меня не отправляется сообщение 123", status: "pending", corrected: true });
});
test("does not rewrite names, links, quoted text, code or identifiers", () => {
  const original = 'Илья Миронов: АБ123, помошь123, https://example.com/памагите user@example.com «памагите» "помошь" `акаунт`';
  assert.equal(processMessage(original).text, original);
});
test("preserves negation and does not request help when it is declined", () => {
  const original = "Помощь больше не нужна. Пароль НЕ меняйте.";
  assert.deepEqual(processMessage(original), { text: original, status: "trash", corrected: false });
});
test("handles uppercase requests and known problem phrases", () => {
  assert.equal(processMessage("ПАМАГИТЕ!").text, "ПОМОГИТЕ!");
  assert.equal(processMessage("ПАМАГИТЕ!").status, "pending");
  assert.equal(processMessage("Не могу войти").status, "pending");
});
test("does not invent meaning for numbers or unfamiliar words", () => {
  assert.deepEqual(processMessage("123"), { text: "123", status: "trash", corrected: false });
  assert.equal(processMessage("Ксенофонт абракадабра").text, "Ксенофонт абракадабра");
  assert.equal(processMessageWithTrace("помощник").processing.classification, "clarify");
});

test("records the user's example in order and classifies the corrected complaint", () => {
  const original = "У мня не удеться зойти";
  const result = processMessageWithTrace(original);
  assert.equal(result.text, "У меня не получается зайти");
  assert.equal(result.status, "pending");
  assert.equal(result.processing.classification, "report");
  assert.deepEqual(result.processing.steps.map(step => step.id), ["received", "moderated", "corrected", "understood", "rules", "classified", "details", "routed"]);
  assert.equal(result.processing.steps.find(step => step.id === "corrected")?.value, result.text);
  assert.equal(result.processing.steps.at(-1)?.value, "Администратору на проверку");
  assert.match(result.processing.steps.find(step => step.id === "rules")!.detail!, /не получается зайти/);
  assert.equal(result.processing.steps.find(step => step.id === "classified")!.value, "Помощь");
});

test("records trash without claiming to send it to the administrator", () => {
  const result = processMessageWithTrace(" 123 ");
  assert.equal(result.processing.classification, "trash");
  assert.equal(result.processing.steps[0].value, " 123 ");
  assert.equal(result.processing.steps.find(step => step.id === "corrected")?.value, "123");
  assert.equal(result.processing.steps.find(step => step.id === "corrected")?.detail, "Без изменений.");
  assert.equal(result.processing.steps.at(-1)?.value, "В корзину");
});

test("keeps quoted variants intact and recognizes correctly written login complaints", () => {
  assert.equal(processMessage('«У мня не удеться зойти»').text, '«У мня не удеться зойти»');
  assert.equal(processMessage("Не удаётся зайти").status, "pending");
  assert.equal(processMessage("Не удается зайти").status, "pending");
});

test("separates known joined slang without expanding game terms", () => {
  const cases = [
    ["оскродни", "Оск родни"], ["дмвзз", "ДМ в ЗЗ"], ["менядмят", "Меня ДМят"],
    ["менядмятвзз", "Меня ДМят в ЗЗ"], ["дмбезпричины", "ДМ без причины"],
    ["нонрпкоп", "НРП коп"], ["дмидб", "ДМ и ДБ"],
    ["оннедмит", "Он не ДМит"], ["dm в gz, дбшит", "ДМ в ГЗ, ДБшит"],
    ["немогузайти в акаунт", "Не могу зайти в аккаунт"],
  ];
  for (const [input, expected] of cases) {
    const result = processMessage(input);
    assert.equal(result.text, expected, input);
    assert.equal(processMessage(result.text).text, expected, `idempotent: ${input}`);
  }
});

test("does not guess word boundaries in names, evidence or unknown words", () => {
  const examples = [
    'Дмитрий подменяет ведомство', 'Alex_dm оскродни', 'dm123', 'оск_родни памагите',
    '«дмвзз»', '"оскродни"', '`нонрпкоп`', '```dm в gz```', '@дмвзз',
    'https://example.com/оскродни', 'osk@dm.example', '<url>', 'тт пп кв лсп',
  ];
  for (const input of examples) {
    const expected = input === 'Alex_dm оскродни' ? 'Alex_dm оск родни' : input === 'оск_родни памагите' ? 'оск_родни помогите' : input;
    assert.equal(processMessage(input).text, expected, input);
  }
  assert.equal(processMessageWithTrace('Дмитрий подменяет ведомство').processing.classification, 'clarify');
  assert.equal(processMessageWithTrace('читает книгу').processing.classification, 'clarify');
});

test("keeps DM and DB distinct and keeps negation", () => {
  assert.equal(processMessage('dm db').text, 'ДМ ДБ');
  const result = processMessageWithTrace('оннедмит');
  assert.equal(result.text, 'Он не ДМит');
  assert.equal(result.processing.classification, 'clarify');
  assert.equal(result.status, 'pending');
  assert.equal(processMessageWithTrace('я не использую софт').processing.classification, 'clarify');
  assert.equal(processMessageWithTrace('я играю без читов').processing.classification, 'clarify');
});

test("uses context to distinguish a complaint, question and appeal", () => {
  const cases = [
    ['Меня дмят у магазина', 'Жалоба на игрока'],
    ['Что значит ДМ?', 'Вопрос по игре'],
    ['Что значит «DM»?', 'Вопрос по игре'],
    ['Меня ошибочно наказали за ДМ, не согласен', 'Обжалование наказания'],
    ['дали варн хотя я защищался', 'Обжалование наказания'],
    ['админ не следит за игроком', 'Действия администрации'],
    ['за что бан?', 'Обжалование наказания'],
    ['застрял в текстурах', 'Помощь в игре'],
    ['донат не пришёл', 'Платёж'],
    ['взломали аккаунт', 'Аккаунт и имущество'],
    ['помощь не нужна, меня дмят', 'Жалоба на игрока'],
  ];
  for (const [input, topic] of cases) {
    const result = processMessageWithTrace(input);
    assert.equal(result.processing.topic, topic, input);
    assert.equal(result.status, 'pending');
  }
});

test("sends uncertainty to an administrator without calling it a proven complaint", () => {
  for (const input of ['2.1', '2.1 ОП', 'ПП на КВ', 'мне нужна страховка', '«ДМ»', '<url>']) {
    const result = processMessageWithTrace(input);
    assert.equal(result.status, 'pending', input);
    assert.equal(result.processing.classification, 'clarify', input);
    assert.equal(result.processing.steps.find(step => step.id === 'routed')?.value, 'Администратору для уточнения');
  }
  for (const input of ['123', '+', '...', 'Привет!', 'спасибо']) assert.equal(processMessage(input).status, 'trash', input);
});
