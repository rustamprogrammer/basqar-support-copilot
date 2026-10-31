import test from "node:test";
import assert from "node:assert/strict";
import { KNOWLEDGE_ENTRIES, type KnowledgeEntry } from "./knowledge-base.ts";
import { getKnowledgeDecision } from "./knowledge-matching.ts";

for (const [text, id] of [
  ["Что такое ДМ?", "faq-dm"], ["Что такое ДБ?", "faq-db"],
  ["Що означає DM?", "faq-dm"], ["DM деген не?", "faq-dm"],
  ["DM nima degani?", "faq-dm"], ["chto takoe dm?", "faq-dm"],
  ["Объясни мне, пожалуйста, ДМ", "faq-dm"], ["что такое «ДМ»?", "faq-dm"],
  ["Что такое mass dm?", "faq-massdm"], ["Что означает ЗЗ в игре?", "faq-zz"],
  ["Что такое РП? 🤔", "faq-rp"], ["Як розшифровується НРП?", "faq-nonrp"],
  ["Объясните значение АФК", "faq-afk"], ["Поясніть значення ТК", "faq-tk"],
  ["ПГ мағынасын түсіндіріңіз", "faq-pg"], ["DM ma’nosini tushuntiring", "faq-dm"],
  ["Что такое ХП простыми словами?", "faq-hp"], ["Що таке РП простими словами?", "faq-rp"],
  ["МГ деген не, қарапайым тілмен?", "faq-mg"], ["DB nima, oddiy qilib ayting?", "faq-db"],
  ["Подкажите, что значит РК?", "faq-rk"], ["МГ қысқартуы нені білдіреді?", "faq-mg"],
  ["Що означає скорочення ТК?", "faq-tk"], ["PG qisqartmasi nimani anglatadi?", "faq-pg"],
  ["Чтотакое ХП?", "faq-hp"], ["ОйындаДМ нені білдіреді?", "faq-dm"],
  ["ДМдегенне?", "faq-dm"], ["dmnimadegani?", "faq-dm"],
  ["Что такое IC, объсните термин", "faq-ic"], ["ТК деген не, теринді түсіндіріңіз", "faq-tk"],
  ["Як розифровується МГ?", "faq-mg"], ["RP nimani angatadi?", "faq-rp"],
  ["Объяснитезначение СК", "faq-sk"], ["Пояснітьзначення РК", "faq-rk"],
  ["ДМмағынасын түсіндіріңіз", "faq-dm"], ["ICдеген не, қарапайым тілмен?", "faq-ic"],
  ["RPnima, oddiy qilib ayting?", "faq-rp"], ["ХПдеген не, терминді түсіндіріңіз", "faq-hp"],
  ["MGnima, atamani tushuntiring", "faq-mg"], ["ДМнені білдіреді, айтыңызшы?", "faq-dm"],
  ["RKnimani anglatadi, aytingchi?", "faq-rk"], ["Объяснитетермин ДМ", "faq-dm"],
  ["Пояснітьтермін ДБ", "faq-db"], ["ДМ терминін түсіндіріңіз", "faq-dm"],
  ["DB atamasini tushuntiring", "faq-db"], ["RP ataasini tushuntiring", "faq-rp"],
  ["ZZ qisqartmasi qanday izohlanadi?", "faq-zz"],
]) test(`FAQ answers a whole supported intent: ${text}`, () => {
  const result = getKnowledgeDecision(text, "question");
  assert.equal(result.status, "answered"); assert.equal(result.entryId, id);
  assert.ok(result.answer); assert.ok(result.source?.version); assert.ok(result.entryVersion);
});

for (const text of [
  "Что такое ДМ, меня убивают!", "Что такое ДМ и ДБ?", "Что такое ДМ? Как купить дом?",
  "Что такое ДМ и как отключить голос?", "Что такое ДМ? Он меня бьёт", "Меня ДМят, помогите",
  "Что такое не ДМ?", "Он спросил: что такое ДМ?", "Если я нападу, это ДМ?", "За что мне дали бан за ДМ?",
  "Что такое ДМ, сука", "Что такое ДМ? Пошёл нахуй", "Что такое скайбидигейминг?", "ДМ", "🤡🤡",
  "Где выключается голосовой чат, чтобы двигатель остался?", "Отключил голос, не помогло",
  "Що таке ДМ, мене вбивають", "DM деген не, қазір көмектес", "DM nima, meni uryapti",
  "Можно ли ДМить?", "Что такое ДМ? Почему мне не отвечают?", "Что такое ДМ без РП причины?",
  "Подкажите, что значит РК, он меня убивает", "Объяснитезначение РП и ДМ", "ДМдегенне мені өлтіріп жатыр",
  "DMnimadegani va DBnimadegani", "Что такое ДМ простыми словами и где найти оружие?",
  "ICдеген не, но меня бьют", "ДМмағынасын түсіндіріңіз, қазір атып жатыр",
  "PGnima, atamani tushuntiring, yordam bering", "Объяснитетермин ДМ и купите мне оружие",
  "Пояснітьтермін ДМ, мене вбивають", "OOCдеген не, НЕ надо отвечать про OOC",
]) test(`FAQ abstains rather than answering part of: ${text}`, () => {
  assert.equal(getKnowledgeDecision(text, "question").status, "needs_admin");
});

test("FAQ never handles help or other routes even when they contain a definition", () => {
  for (const route of ["help", "violation", "trash", null] as const) assert.equal(getKnowledgeDecision("Что такое ДМ?", route).status, "not_applicable");
});
test("FAQ sources and published entries are unique and nonempty", () => {
  assert.ok(KNOWLEDGE_ENTRIES.length >= 20);
  assert.equal(new Set(KNOWLEDGE_ENTRIES.map(entry => entry.id)).size, KNOWLEDGE_ENTRIES.length);
  for (const entry of KNOWLEDGE_ENTRIES) {
    assert.ok(entry.source.title && entry.source.version && entry.version && entry.answer && entry.aliases.length);
    for (const alias of entry.aliases) assert.equal(getKnowledgeDecision(`Что такое ${alias}?`, "question").entryId, entry.id, alias);
  }
});
const dm = KNOWLEDGE_ENTRIES.find(entry => entry.id === "faq-dm")!;
test("draft, retired and missing-source answers are never sent", () => {
  for (const entry of [{ ...dm, status: "draft" }, { ...dm, status: "retired" }, { ...dm, source: { title: "", version: "" } }] as KnowledgeEntry[]) {
    assert.equal(getKnowledgeDecision("Что такое ДМ?", "question", [entry]).status, "needs_admin");
  }
});
test("contradictory approved matches go to an administrator", () => {
  assert.equal(getKnowledgeDecision("Что такое ДМ?", "question", [dm, { ...dm, id: "other", answer: "Другой ответ" }]).status, "needs_admin");
});
test("required and excluded terms are strict additional conditions", () => {
  assert.equal(getKnowledgeDecision("Что такое ДМ?", "question", [{ ...dm, requiredTerms: ["в игре"] }]).status, "needs_admin");
  assert.equal(getKnowledgeDecision("Что такое ДМ в игре?", "question", [{ ...dm, requiredTerms: ["в игре"] }]).status, "answered");
  assert.equal(getKnowledgeDecision("Что такое ДМ в игре?", "question", [{ ...dm, excludedTerms: ["в игре"] }]).status, "needs_admin");
});
test("an administrator can add an original fully approved procedural question", () => {
  const custom = { ...dm, id: "custom-approved", title: "Проверенная справка", aliases: ["Где найти справку проекта?"], answer: "Проверенный администратором ответ." };
  assert.equal(getKnowledgeDecision("Где найти справку проекта?", "question", [custom]).entryId, custom.id);
  assert.equal(getKnowledgeDecision("Где найти справку проекта? И где получить деньги?", "question", [custom]).status, "needs_admin");
  assert.equal(getKnowledgeDecision("Где найти справку проекта?", "help", [custom]).status, "not_applicable");
});
