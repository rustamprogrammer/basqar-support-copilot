import { processSupportMessage } from './support-processing.ts';
import type { KnowledgeEntry } from './knowledge-base.ts';
import type { ClarificationContext } from "./message-types.ts";

export function processServerMessage(original: string, context?: ClarificationContext, entries?: readonly KnowledgeEntry[]) {
  return processSupportMessage(original, context, entries);
}
