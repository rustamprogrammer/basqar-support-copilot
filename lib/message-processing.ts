import type { ClarificationContext, ProcessingStep, ProcessingTrace } from "./message-types.ts";
import { correctText } from "./text-correction.ts";
import { routeMessage } from "./message-routing.ts";
import { understandMessage } from "./message-understanding.ts";
import { inspectModeration } from "./message-moderation.ts";
import { routeLabels, ROUTING_SCHEMA } from "./message-routes.ts";
import {clarifyDecision} from "./message-details.ts";
import {useClarification} from "./clarification-routing.ts";
import { normalizeInputScripts } from "./input-script-normalization.ts";


export const PROCESSOR_VERSION = "rules-5.3-context-guards";

export { correctText } from "./text-correction.ts";

export function processMessageWithTrace(original: string, context?: ClarificationContext) {
  // Restore only known input forms before attribution; keep the original as evidence.
  // In particular, a restored reporting clause must participate in the same moderation check.
  const normalized = normalizeInputScripts(original);
  const normalizationSteps: ProcessingStep[] = normalized.changes.length ? [{
    id: "normalized", title: "Раскладка и транслит", value: normalized.text,
    detail: [...new Set(normalized.changes.map(change => `${change.source} → ${change.target}`))].slice(0, 12).join("; "),
  }] : [];
  // This is a terminal route. Do not run correction, translation or intent analysis after a match.
  const moderation = inspectModeration(normalized.text);
  if (moderation.kind === "violation") {
    const processing: ProcessingTrace = {
      classification: "violation",
      route: "violation", routingSchema: ROUTING_SCHEMA, needsClarification: false,
      missingDetails: [], answerReadiness: "not_evaluated",
      ...(context ? {context} : {}),
      topic: moderation.topic ?? "Оскорбление в обращении",
      version: PROCESSOR_VERSION, decisionSource: "rules",
      steps: [
        { id: "received", title: "Исходный текст", value: original },
        ...normalizationSteps,
        { id: "classified", title: "Проверка нарушения", value: "Нарушение в обращении", detail: `Найдено выражение: «${moderation.match}». ${moderation.reason}` },
        { id: "routed", title: "Куда отправлено", value: "В раздел «Нарушения»", detail: "Отправлено автоматически. Обработка завершена." },
      ],
    };
    return { text: original.trim(), status: "violation" as const, corrected: false, processing };
  }
  const text = correctText(original, normalized.text);
  const understanding = understandMessage(text);
  const rule = clarifyDecision(normalized.text, understanding.text, useClarification(routeMessage(normalized.text, text, understanding.text), context));
  const { status, reason, classification, topic } = rule;
  const corrected = text !== original.trim();
  const processing: ProcessingTrace = {
    classification,
    route: rule.route, routingSchema: ROUTING_SCHEMA,
    needsClarification: rule.needsClarification, missingDetails: rule.missingDetails,
    answerReadiness: "not_evaluated",
    ...(context ? {context} : {}),
    topic,
    version: PROCESSOR_VERSION,
    decisionSource: "rules",
    ruleId: rule.ruleId, events: rule.events, followUp: rule.followUp,

    steps: [
      { id: "received", title: "Исходный текст", value: original },
      ...normalizationSteps,
      { id: "moderated", title: "Проверка нарушения", value: moderation.kind === "complaint" ? "Возможная жалоба с руганью" : moderation.kind === "reported" ? "Пересказ или отрицание" : "Автоматическое нарушение не выявлено", detail: moderation.reason },
      { id: "corrected", title: "Исправление текста", value: text, detail: corrected ? "Исправлены знакомые опечатки и слитные сочетания. Сокращения, цитаты, ссылки и команды сохранены." : "Без изменений." },
      ...(understanding.translations.length || understanding.glossary.length ? [{
        id: "understood" as const,
        title: "Язык и смысл",
        value: understanding.translations.length ? understanding.text : understanding.glossary.map(item => `${item.term} — ${item.meaning}`).join("; "),
        detail: [
          ...(understanding.translations.length ? [
            "Словарный перевод для анализа; неизвестные слова сохранены.",
            [...new Map(understanding.translations.map(item => [`${item.source}:${item.target}`, item])).values()]
              .map(item => `${item.source} → ${item.target} (${{uz:"узб.",kk:"каз.",uk:"укр."}[item.language]})`).join("; "),
            understanding.glossary.map(item => `${item.term} — ${item.meaning}`).join("; "),
          ] : []),
        ].filter(Boolean).join("\n") || undefined,
      }] : [{ id: "understood" as const, title: "Язык и смысл", value: "Известные иностранные фразы и жаргон не найдены", detail: "Неизвестные слова сохранены." }]),
      ...((rule.events?.length || 0) > 0 ? [{ id: "context" as const, title: "События и контекст", value: [...new Set(rule.events!.map(event => `${event.action}${event.negated ? " — отрицается" : event.uncertain ? " — контекст неясен" : event.kind === "punishment" ? " — наказание" : event.kind === "reported-speech" ? " — пересказ" : ""}`))].slice(0, 8).join("; "), detail: "Отрицания и чужая речь учитываются для соответствующего действия. Упоминание события не доказывает нарушение." }] : []),
      { id: "rules", title: "Цель обращения", value: rule.route ? routeLabels[rule.route] : "Категория пока не определена", detail: rule.reason },
      { id: "classified", title: "Итоговая категория", value: rule.route ? routeLabels[rule.route] : "Категория пока не определена" },
      ...(rule.route !== "trash" ? [{id:"details" as const, title:rule.followUp ? "Что уточнить" : "Подробности", value:rule.followUp || "Уточнение не требуется"}] : []),
      { id: "routed", title: "Куда отправлено", value: classification === "clarify" ? "Администратору для уточнения" : status === "pending" ? "Администратору на проверку" : "В корзину" },
    ],
  };
  return { text, status, corrected, processing };
}

export function processMessage(original: string) {
  const { text, status, corrected } = processMessageWithTrace(original);
  return { text, status, corrected };
}
