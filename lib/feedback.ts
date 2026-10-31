import { intentTopics } from "./intent-features.ts";
import { ROUTING_SCHEMA, routeLabels } from "./message-routes.ts";
import type { Feedback, MessageRoute } from "./message-types.ts";

export function feedbackRoute(feedback: Pick<Feedback, "label" | "routingSchema">): MessageRoute | null {
  return feedback.routingSchema === ROUTING_SCHEMA && Object.hasOwn(routeLabels, feedback.label)
    ? feedback.label as MessageRoute : null;
}

export function feedbackLabel(feedback: Pick<Feedback, "label" | "routingSchema">): string {
  if (feedback.routingSchema === ROUTING_SCHEMA) {
    const route = feedbackRoute(feedback);
    return route ? routeLabels[route] : "Категория не определена";
  }
  return intentTopics[feedback.label] || feedback.label;
}

export function parseFeedback(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (typeof row.messageId !== "string" || !/^[0-9a-f-]{36}$/i.test(row.messageId) || typeof row.label !== "string") return null;
  const current = row.routingSchema === ROUTING_SCHEMA;
  if (row.routingSchema != null && !current) return null;
  if (current) {
    if (!Object.hasOwn(routeLabels, row.label) && row.label !== "clarify") return null;
    if (row.needsClarification !== null && typeof row.needsClarification !== "boolean") return null;
  } else if (!Object.hasOwn(intentTopics, row.label)) return null;
  if (row.correctedText != null && (typeof row.correctedText !== "string" || row.correctedText.length > 2000)) return null;
  if (row.note != null && (typeof row.note !== "string" || row.note.length > 500)) return null;
  return {
    messageId: row.messageId,
    label: row.label,
    routingSchema: current ? ROUTING_SCHEMA : null,
    needsClarification: current ? row.needsClarification as boolean | null : null,
    correctedText: typeof row.correctedText === "string" ? row.correctedText.trim() || null : null,
    note: typeof row.note === "string" ? row.note.trim() || null : null,
  };
}

export function exportFeedback(message: { id: string; text: string; originalText: string | null }, feedback: Feedback) {
  const current = feedback.routingSchema === ROUTING_SCHEMA;
  return {
    id: message.id,
    text: message.originalText ?? message.text,
    label: ["clarify", "trash", "violation"].includes(feedback.label) ? "unknown" : feedback.label,
    routeLabel: feedback.label,
    ...(current ? { routingSchema: ROUTING_SCHEMA, expectedRoute: feedbackRoute(feedback) } : { legacyLabel: feedback.label }),
    needsClarification: current ? feedback.needsClarification ?? null : null,
    expectedCorrectedText: feedback.correctedText,
    note: feedback.note,
    reviewStatus: "proposed",
    source: "public-demo-feedback",
    updatedAt: feedback.updatedAt,
  };
}
