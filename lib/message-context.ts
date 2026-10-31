import type { Message } from "./message-types.ts";
import {processingRoute, ROUTING_SCHEMA} from "./message-routes.ts";

export const CLARIFICATION_PREFIX = "\nУточнение: ";

export function canClarify(message: Message) {
  return !!message.processing?.followUp && (message.status === "pending" ||
    (message.status === "violation" && message.processing.route === "violation" &&
      message.processing.needsClarification === true &&
      (message.processing.aiReview?.outcome === "confirmed" || message.processing.aiReview?.outcome === "replaced")));
}

export function prepareClarification(parent: Message | undefined, answer: string) {
  if (!parent) return { error: "Исходное обращение не найдено.", status: 404 } as const;
  if (!canClarify(parent) || !parent.processing) {
    return { error: "Это обращение уже не ожидает уточнения.", status: 409 } as const;
  }
  if (!answer.trim()) return { error: "Введите уточнение.", status: 400 } as const;
  const originalText = (parent.originalText ?? parent.text) + CLARIFICATION_PREFIX + answer;
  if (originalText.length > 2000) {
    return { error: "Исходное обращение и уточнение вместе должны быть не длиннее 2000 символов.", status: 400 } as const;
  }
  return { originalText, context: { parentId: parent.id, answerText: answer,
    ...(parent.processing.routingSchema === ROUTING_SCHEMA ? {
      parentRoute: processingRoute(parent.processing), requestedDetails: parent.processing.missingDetails ?? [],
      question: parent.processing.followUp,
    } : {}),
  } } as const;
}
