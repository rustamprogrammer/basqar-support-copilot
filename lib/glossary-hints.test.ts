import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME_GLOSSARY } from "./game-glossary.ts";
import { selectGlossaryHints } from "./glossary-hints.ts";

test("canonical codes and fused Russian slang retrieve contextual definitions", () => {
  const english = selectGlossaryHints("DM DB GZ MG RP").map(h => h.term);
  for (const term of ["DM", "DB", "GZ", "MG", "RP"]) assert.ok(english.includes(term), term);
  const fused = selectGlossaryHints("Менядмят в зз за прсоа так").map(h => h.term);
  assert.ok(fused.includes("DM"));
  assert.ok(fused.includes("GZ"));
});

test("short codes do not match arbitrary interior characters", () => {
  const hints = selectGlossaryHints("admin scripted database");
  assert.ok(!hints.some(h => ["DM", "DB", "IC", "RP"].includes(h.term)));
});

test("long aliases do not turn unrelated words into game terms", () => {
  assert.deepEqual(selectGlossaryHints("Дмитрий покинул игру: какой предмет реально купить?"), []);
  const actual = selectGlossaryHints("дмит, пред; кинул за реал").map(h => h.term);
  for (const term of ["DM", "Warn", "Скам", "RMT"]) assert.ok(actual.includes(term), term);
});

test("only small Russian hints are sent, all translations and source URLs stay local", () => {
  const hints = selectGlossaryHints("DM DB GZ MG RP TK SK RK AFK мут бан жб", 500);
  assert.equal(hints.length, 6);
  for (const hint of hints) assert.deepEqual(Object.keys(hint).sort(), ["meaning_ru", "term"]);
  assert.deepEqual(selectGlossaryHints("unrecognized_xyz_term"), []);
});

test("multilingual aliases are recognized without rewriting original text", () => {
  const original = "Meni aldadi, shikoyat qilmoqchiman";
  const hints = selectGlossaryHints(original);
  assert.ok(hints.some(h => h.term === "Скам"));
  assert.ok(hints.some(h => h.term === "ЖБ"));
  assert.equal(original, "Meni aldadi, shikoyat qilmoqchiman");
  assert.ok(selectGlossaryHints("Маған мут берді").some(h => h.term === "Mute"));
});

test("every glossary entry has all three definitions and an official reference", () => {
  assert.ok(GAME_GLOSSARY.length >= 40);
  assert.equal(new Set(GAME_GLOSSARY.map(e => e.term)).size, GAME_GLOSSARY.length);
  for (const entry of GAME_GLOSSARY) {
    assert.ok(entry.ru.trim() && entry.kk.trim() && entry.uz.trim(), entry.term);
    assert.equal(new URL(entry.source).hostname, "support.grnd.gg");
    assert.ok(entry.aliases.every(a => a.trim().length > 0));
  }
});
