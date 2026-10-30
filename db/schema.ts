import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  status: text("status", { enum: ["pending", "accepted", "trash"] }).notNull(),
  createdAt: integer("created_at").notNull(),
});
