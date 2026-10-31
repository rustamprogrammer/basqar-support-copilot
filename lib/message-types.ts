import type { RequestEvent } from "./request-analysis.ts";
export type MessageRoute = "question" | "help" | "violation" | "trash";
export type ClarificationContext = {
  parentId: string;
  answerText: string;
  parentRoute?: MessageRoute | null;
  requestedDetails?: string[];
  question?: string;
};
export type Status = "pending" | "accepted" | "trash" | "violation";
export type ProcessingStep = {
  id: "received" | "normalized" | "moderated" | "corrected" | "understood" | "context" | "details" | "rules" | "model" | "classified" | "routed" | "ai-review" | "ai-text" | "algorithm-result";
  title: string;
  value: string;
  detail?: string;
};
export type ProcessingTrace = {
  classification: "report" | "trash" | "clarify" | "violation";
  route?: MessageRoute | null;
  routingSchema?: string;
  needsClarification?: boolean;
  missingDetails?: string[];
  answerReadiness?: "not_evaluated";
  topic?: string;
  version?: string;
  decisionSource?: "rules" | "classifier" | "ai";
  algorithm?: {
    text: string; route: MessageRoute | null; needsClarification: boolean;
    followUp?: string; version?: string; ruleId?: string; reason?: string;
  };
  aiReview?: {
    outcome: "confirmed" | "replaced" | "unavailable" | "disabled" | "limited";
    model?: string; promptVersion: string; reason?: string; errorCode?: string;
    cached?: boolean; elapsedMs?: number;
    usage?: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number };
  };
  ruleId?: string;
  events?: RequestEvent[];
  followUp?: string;
  context?: ClarificationContext;
  model?: { version: string; topic: string; score: number; accepted: boolean; coverage: number };
  steps: ProcessingStep[];
};
export type Feedback = {
  label: string;
  routingSchema?: string | null;
  needsClarification?: boolean | null;
  correctedText: string | null;
  note: string | null;
  updatedAt: number;
};
export type Message = {
  id: string;
  text: string;
  originalText: string | null;
  status: Status;
  createdAt: number;
  processing: ProcessingTrace | null;
  feedback?: Feedback | null;
};
