import { GAME_GLOSSARY } from "./game-glossary.ts";

const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[‘’ʻʼ`]/gu, "'");
const isWord = (c: string) => /[\p{L}\p{N}_]/u.test(c);
function matches(text: string, alias: string) {
  const needle = normalize(alias);
  let start = text.indexOf(needle);
  while (start >= 0) {
    // Every alias needs word boundaries: 'дмит' must not match 'Дмитрий'.
    // Known fused forms such as 'менядмят' are explicit glossary aliases.
    if (!isWord(text[start - 1] || "") && !isWord(text[start + needle.length] || "")) return true;
    start = text.indexOf(needle, start + 1);
  }
  return false;
}

// Retrieval only: never chooses a box, edits the original, or accesses the network.
// Keep translations/sources local; the model needs only a short Russian meaning.
export function selectGlossaryHints(original: string, limit = 6) {
  const text = normalize(original);
  return GAME_GLOSSARY.map(entry => ({ entry, score: Math.max(0, ...[entry.term, ...entry.aliases].filter(a => matches(text, a)).map(a => a.length)) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, Math.min(limit, 6)))
    .map(({ entry }) => ({ term: entry.term, meaning_ru: entry.ru }));
}
