export type Status = "pending" | "accepted" | "trash";
export type ProcessingStep = {
  id: "received" | "corrected" | "classified" | "routed";
  title: string;
  value: string;
  detail?: string;
};
export type ProcessingTrace = {
  classification: "report" | "trash";
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
