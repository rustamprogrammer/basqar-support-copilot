import type { Language } from './types.ts';

export function detectLanguage(text: string, hint?: Language): Language {
  const t = text.toLowerCase().replace(/[‘’ʻʼ`]/gu, "'");
  const scores: Record<string, number> = {
    kk: (t.match(/(?:көмек\p{L}*|көмектес\p{L}*|мені|маған|жатыр|жатр|қалай|қайда|жоқ|емес|деген|себепсіз|komek\p{L}*|magan|jatyr|qalay)/gu) ?? []).length * 3 + (/[әөұүң]/u.test(t) ? 2 : 0),
    uz: (t.match(/(?:yordam|bering|meni|menga|nima|qanday|qayer\p{L}*|yo'q|emas|akkaunt\p{L}*|qil\p{L}*|bo'\p{L}*|йўқ|ёрдам|беринг|қандай|нима|менга|ҳақорат)/gu) ?? []).length * 3,
    ru: (t.match(/(?:меня|мне|как|что|почему|помог\p{L}*|игрок\p{L}*|оплат\p{L}*|забан\p{L}*)/gu) ?? []).length * 2,
    en: (t.match(/\b(?:please|help|what|how|where|account|payment|paid|purchase|charged|receive|stolen|hacked|banned|player)\b/gu) ?? []).length * 2,
    es: (t.match(/\b(?:ayuda|ayuden|cuenta|pago|dónde|cómo|jugador|por favor)\b/gu) ?? []).length * 3,
    pt: (t.match(/\b(?:ajuda|ajudem|conta|pagamento|onde|como|jogador|não)\b/gu) ?? []).length * 3,
  };
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] > 0 && ranked[0][1] > ranked[1][1]) return ranked[0][0] as Language;
  if (hint && hint !== 'und') return hint;
  if (/[а-яё]/iu.test(t) && !/[әғқңөұүһў]/iu.test(t)) return 'ru';
  return 'und';
}

export function normalizeKazakh(text: string, hint?: Language) {
  // These code points overlap with Uzbek/Ukrainian. Restore only a Kazakh context.
  const kkContext = hint === 'kk' || detectLanguage(text) === 'kk' || (hint !== 'uz' && /[ќѕј]/u.test(text) && /мен[іи]|маган|жат[ы]?р|ќалай|ќайда|к[өо]мек/iu.test(text));
  if (!kkContext) return text;
  const letters: Record<string, string> = { 'ќ': 'қ', 'ґ': 'ғ', 'ѕ': 'ң', 'є': 'ә', 'ј': 'ө', 'ў': 'ұ', 'ї': 'ү' };
  return text.replace(/[ќґѕєјўїЌҐЅЄЈЎЇ]/gu, c => {
    const restored = letters[c.toLowerCase()];
    return c === c.toUpperCase() ? restored.toUpperCase() : restored;
  });
}
