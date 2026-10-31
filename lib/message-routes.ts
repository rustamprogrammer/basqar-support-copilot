import type { Message, MessageRoute, ProcessingTrace } from "./message-types.ts";

export const ROUTING_SCHEMA = "purpose-v1";
export const routeLabels: Record<MessageRoute, string> = {
  question: "Вопрос", help: "Помощь", violation: "Нарушение", trash: "Корзина",
};

// Legacy decisions remain historical; this adapter does not rewrite stored data.
export function processingRoute(processing: ProcessingTrace | null): MessageRoute | null {
  if (!processing) return null;
  if (Object.hasOwn(processing, "route")) return processing.route ?? null;
  if (processing.classification === "report") return processing.topic === "Вопрос по игре" ? "question" : "help";
  if (processing.classification === "violation" || processing.classification === "trash") return processing.classification;
  return null;
}

export function messageRoute(message: Pick<Message, "status" | "processing">): MessageRoute | null {
  if (message.status === "violation" || message.status === "trash") return message.status;
  // Returning an automatically rejected message to pending is a manual override.
  const route = processingRoute(message.processing);
  return (message.status === "pending" || message.status === "accepted") && (route === "violation" || route === "trash") ? null : route;
}
