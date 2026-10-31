import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ProcessingTrace } from "@/lib/message-types";
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  originalText: text("original_text"),
  processing: text("processing", { mode: "json" }).$type<ProcessingTrace>(),
  status: text("status", { enum: ["pending", "accepted", "trash", "violation"] }).notNull(),
  createdAt: integer("created_at").notNull(),
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
