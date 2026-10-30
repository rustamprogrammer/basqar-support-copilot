import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ProcessingTrace } from "@/lib/message-types";
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  originalText: text("original_text"),
  processing: text("processing", { mode: "json" }).$type<ProcessingTrace>(),
  status: text("status", { enum: ["pending", "accepted", "trash"] }).notNull(),
  createdAt: integer("created_at").notNull(),
});
