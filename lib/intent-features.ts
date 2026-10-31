import { contextText } from "./game-language.ts";

export const FEATURE_VERSION = "word12-char345-v1";
export function featureCounts(original: string, understood = original): Record<string, number> {
  const counts: Record<string, number> = Object.create(null);
  const add = (key: string) => { counts[key] = (counts[key] || 0) + 1; };
  for (const text of new Set([original, understood])) {
    const words = contextText(text).normalize("NFKC").toLowerCase().replaceAll("ё", "е").match(/[\p{L}]+/gu) || [];
    words.forEach((word, i) => {
      add(`w:${word}`);
      if (i) add(`b:${words[i - 1]} ${word}`);
      const padded = ` ${word} `;
      for (let n = 3; n <= 5; n++) for (let j = 0; j <= padded.length - n; j++) add(`c:${padded.slice(j, j + n)}`);
    });
  }
  return counts;
}

export const intentTopics: Record<string, string> = {
  appeal: "Обжалование наказания", administration: "Действия администрации",
  player: "Жалоба на игрока", help: "Помощь в игре", question: "Вопрос по игре",
  property: "Аккаунт и имущество", payment: "Платёж",
  clarify: "Нужно уточнение", trash: "Мусор", violation: "Оскорбление в обращении",
};
export type IntentModel = {
  version: string; featureVersion: string; provenance: string; trainedAt: string;
  labels: string[]; vocabulary: Record<string, number>; idf: number[]; weights: number[][]; intercept: number[];
  thresholds: Record<string, number>; minMargin: number; minCoverage: number;
  training: { train: number; validation: number; approved: number; provisional: number; sha256: string };
  validation: Record<string, { accepted: number; correct: number; precision: number | null }>;
};
