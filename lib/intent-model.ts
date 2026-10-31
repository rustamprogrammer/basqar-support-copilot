import artifact from "./models/intent-model.json" with { type: "json" };
import { contextText } from "./game-language.ts";
import { FEATURE_VERSION, featureCounts, intentTopics, type IntentModel } from "./intent-features.ts";

const model = artifact as IntentModel;
export const modelInfo = { version: model.version, provenance: model.provenance, training: model.training, validation: model.validation };

export function predictIntent(original: string, understood: string) {
  const counts = featureCounts(original, understood);
  const entries = Object.entries(counts);
  const vector: [number, number][] = [];
  let norm = 0, known = 0;
  for (const [feature, count] of entries) {
    const index = model.vocabulary[feature];
    if (index === undefined) continue;
    known++;
    const value = (1 + Math.log(count)) * model.idf[index];
    vector.push([index, value]); norm += value * value;
  }
  norm = Math.sqrt(norm) || 1;
  const logits = model.labels.map((label, c) => ({ label, value: model.intercept[c] + vector.reduce((sum, [i, v]) => sum + model.weights[c][i] * v / norm, 0) }));
  const max = Math.max(...logits.map(item => item.value));
  const sum = logits.reduce((total, item) => total + Math.exp(item.value - max), 0);
  const ranked = logits.map(item => ({ label: item.label, score: Math.exp(item.value - max) / sum })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const coverage = known / Math.max(entries.length, 1);
  const margin = best.score - (ranked[1]?.score || 0);
  const enoughText = (contextText(original).match(/[\p{L}]{2,}/gu) || []).length >= 2;
  // A learned model can only suggest a report topic. It cannot discard or punish a message.
  const accepted = model.featureVersion === FEATURE_VERSION && enoughText && best.label !== "unknown"
    && best.score >= (model.thresholds[best.label] ?? 1.1) && margin >= model.minMargin && coverage >= model.minCoverage;
  return { label: best.label, topic: intentTopics[best.label] || "Нужно уточнение", score: best.score, margin, coverage, accepted, version: model.version, threshold: model.thresholds[best.label] ?? 1.1 };
}
