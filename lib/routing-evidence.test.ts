import assert from "node:assert/strict";
import test from "node:test";
import { inspectRoutingEvidence } from "./routing-evidence.ts";

for (const text of [
  "123 ДМ", "ДБ 123", "ID 123 ТК", "123ид ДМ", "123DM",
  "123дмят", "Игрок 123 НРП", "Nick_Player55 ДМ", "@player ДМ",
  "игрок Alex ДМ", "ник alex_player ДМ", "123 2.1 ОП",
  "Nick_Player55 нарушение правил 2.2 оп",
  "https://example.test/evidence ДБ", "ДМ www.example.test/proof",
  "<url>\nДБ",
]) {
  test("outside incident has a structural anchor: " + text, () => {
    const result = inspectRoutingEvidence(text);
    assert.equal(result.helpHint, true);
    assert.equal(result.anchoredIncident, true);
    assert.equal(result.bareCode, false);
  });
}

for (const text of [
  "ДМ", "DB", "НРП", "ОСК", "ЧИТ", "ДМ!",
]) {
  test("bare incident is not enough to route: " + text, () => {
    const result = inspectRoutingEvidence(text);
    assert.equal(result.helpHint, false);
    assert.equal(result.bareCode, true);
  });
}

for (const text of [
  "123", "2.1 ОП", "123 РП", "123 ЗЗ", "123 ГЗ", "123 ООС",
  "https://example.test/DM/идиот", "https://example.test/123DM",
  "/DM", "/123DM", "/идиот", "/report/DM", "123 /DM",
  "123 `ДМ`", "123 «ДМ»", "123 \"ДМ\"", "123 ```ДМ```",
  "123 <DM>", "123 <anything>", "123 someone+DM@example.test",
  "123 Nick_DM", "123 @DM", "123 Error123DM", "Ошибка 123 ДМ",
  "Бан 60 минут за ДМ", "ДМ в 12:30", "2.1 ДМ",
  "Версия 123 ДМ", "Сервер 123 ДМ", "123. ДМ",
  "Ник Player_123", "123дмг", "abc123DM",
]) {
  test("protected content and unrelated numbers do not invent an incident: " + text, () => {
    assert.equal(inspectRoutingEvidence(text).helpHint, false);
  });
}

for (const text of [
  "Что значит ДМ у игрока 123?", "Что такое ДМ? Вот https://example.test/123",
  "Как подать жалобу на игрока 123 за ДМ?",
  "Сколько дают за ДМ игроку 123?", "Можно ли ДМ с игроком 123?",
  "Пример: 123 ДМ", "Тест: 123 ДМ",
]) {
  test("evidence cannot override explicit information purpose: " + text, () => {
    const result = inspectRoutingEvidence(text);
    assert.equal(result.helpHint, false);
    assert.equal(result.blockedBy, "information-purpose");
  });
}

for (const text of [
  "123 не ДМ", "123 ДМ не было", "123 без ДМ", "не 123 ДМ",
  "123 написал ДМ", "123 сказал ДМ", "123 ник ДМ",
  "123 команда ДМ",
]) {
  test("negation and word mentions do not assert the incident: " + text, () => {
    const result = inspectRoutingEvidence(text);
    assert.equal(result.helpHint, false);
    assert.equal(result.blockedBy, "negated-or-mentioned");
  });
}

test("source text and UTF-16 offsets remain exact, including protected tokens", () => {
  const source = "🙂 @tester ДМ, https://example.test/DB";
  const result = inspectRoutingEvidence(source);
  assert.equal(source, "🙂 @tester ДМ, https://example.test/DB");
  assert.equal(result.incidents.length, 1);
  assert.equal(result.incidents[0].text, "ДМ");
  for (const item of [...result.participants, ...result.links, ...result.incidents, ...result.protectedSpans]) {
    assert.equal(source.slice(item.start, item.end), item.text);
  }
  assert.equal(result.context.length, source.length);
  assert.equal(result.context.includes("tester"), false);
  assert.equal(result.context.includes("example"), false);
});

test("redacted links are explicit and other angle-bracket content is never a link", () => {
  assert.equal(inspectRoutingEvidence("<url> ДМ").links[0].redacted, true);
  assert.equal(inspectRoutingEvidence("https://example.test/proof ДМ").links[0].redacted, false);
  assert.equal(inspectRoutingEvidence("<file> ДМ").links.length, 0);
  assert.equal(inspectRoutingEvidence("<file> ДМ").helpHint, false);
});

test("a quoted link is not an authored evidence anchor", () => {
  const result = inspectRoutingEvidence("«https://example.test/proof» ДМ");
  assert.equal(result.links.length, 0);
  assert.equal(result.helpHint, false);
});

test("protected abusive strings are not incident or moderation output", () => {
  const result = inspectRoutingEvidence("https://example.test/ты-идиот /идиот @idiot");
  assert.deepEqual(result.incidents, []);
  assert.equal(result.helpHint, false);
  assert.equal("violation" in result, false);
});

test("clear real incident stays available even with a separate denied incident", () => {
  assert.equal(inspectRoutingEvidence("123 не ДМ; 456 ДБ").helpHint, true);
});

test("plain names require an explicit participant cue", () => {
  assert.equal(inspectRoutingEvidence("Alex ДМ").helpHint, false);
  assert.equal(inspectRoutingEvidence("игрок Alex ДМ").helpHint, true);
});
