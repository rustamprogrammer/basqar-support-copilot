import type { ClassificationRun, Box } from "./classifier.ts";
export type Status = "pending" | "accepted" | "trash";
export type ProcessingStep = {
  id: "received" | "corrected" | "classified" | "routed";
  title: string;
  value: string;
  detail?: string;
};
export type ProcessingTrace = {
  classification: "report" | "trash";
  box?: Box;
  ai?: ClassificationRun;
  steps: ProcessingStep[];
};
export type Message = {
  id: string;
  text: string;
  originalText: string | null;
  status: Status;
  createdAt: number;
  processing: ProcessingTrace | null;
};

// Read-time compatibility for saved messages from the previous four-box scheme.
// Keep the database record intact; original text and review status are preserved.
export function normalizeMessageBox<T extends { processing: ProcessingTrace | null }>(message: T): T {
  const processing = message.processing;
  if (!processing) return message;
  const legacyBox = (processing.box as string | undefined) === "request";
  const legacyAiBox = (processing.ai?.result?.box as string | undefined) === "request";
  if (!legacyBox && !legacyAiBox) return message;
  return {
    ...message,
    processing: {
      ...processing,
      ...(legacyBox || (!processing.box && legacyAiBox) ? { box: "complaint" as const } : {}),
      ...(processing.ai && legacyAiBox ? { ai: { ...processing.ai, result: { ...processing.ai.result, box: "complaint" as const } } } : {}),
      steps: processing.steps.map(step => (step.id === "classified" || step.id === "routed") && step.value === "Запросы"
        ? { ...step, value: "Жалобы" } : step),
    },
  };
}
