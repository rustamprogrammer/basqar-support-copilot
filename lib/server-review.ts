import { env } from "cloudflare:workers";
import { createReviewService, processHybridMessage } from "./hybrid-processing.ts";
import type { Reviewer } from "./hybrid-processing.ts";
import type { ClarificationContext } from "./message-types.ts";

let reviewer: Reviewer | undefined;
export function processServerMessage(original: string, context?: ClarificationContext) {
  if (env.AI_REVIEW_ENABLED === "true" && env.OPENAI_API_KEY) {
    reviewer ??= createReviewService({ apiKey: env.OPENAI_API_KEY });
    return processHybridMessage(original, context, reviewer);
  }
  return processHybridMessage(original, context);
}
