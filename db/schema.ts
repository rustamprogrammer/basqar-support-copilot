import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ProcessingTrace } from "@/lib/message-types";
import type { SupportState } from '@/lib/support-state';
import type { KnowledgeEntry } from '@/lib/knowledge-base';
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  originalText: text("original_text"),
  processing: text("processing", { mode: "json" }).$type<ProcessingTrace>(),
  status: text("status", { enum: ["pending", "accepted", "trash", "violation"] }).notNull(),
  createdAt: integer("created_at").notNull(),
  ownerHash: text('owner_hash'),
  service: text('service', { mode: 'json' }).$type<SupportState>(),
}, table => [index('messages_owner_hash_idx').on(table.ownerHash)]);

export const knowledgeEntries = sqliteTable('knowledge_entries', {
  id: text('id').primaryKey(), entry: text('entry', { mode: 'json' }).$type<KnowledgeEntry>().notNull(), updatedAt: integer('updated_at').notNull(),
});

// Public feedback remains a proposal until a separate review of the rules.
export const messageFeedback = sqliteTable("message_feedback", {
  messageId: text("message_id").primaryKey().references(() => messages.id),
  label: text("label").notNull(),
  routingSchema: text("routing_schema"),
  needsClarification: integer("needs_clarification", { mode: "boolean" }),
  correctedText: text("corrected_text"),
  note: text("note"),
  updatedAt: integer("updated_at").notNull(),
});
