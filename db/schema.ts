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

// Credentials are encrypted with the checkout-local settings secret. The lifetime
// request counter and reservation ledger are intentionally independent of re-keying.
export const aiSettings = sqliteTable('ai_settings', {
  id: integer('id').primaryKey(), encryptedKey: text('encrypted_key'), keySuffix: text('key_suffix'),
  enabled: integer('enabled').notNull().default(0), mode: text('mode').notNull().default('uncertain'), model: text('model').notNull().default('gpt-6-luna'),
  used: integer('used').notNull().default(0), updatedAt: integer('updated_at').notNull().default(0),
});
export const aiRequests = sqliteTable('ai_requests', {
  id: text('id').primaryKey(), token: text('token').notNull(), inputHash: text('input_hash').notNull(), createdAt: integer('created_at').notNull(), resultJson: text('result_json'),
});
export const aiRateLimits = sqliteTable('ai_rate_limits', {
  bucket: text('bucket').primaryKey(), used: integer('used').notNull().default(0), expiresAt: integer('expires_at').notNull(), token: text('token').notNull().default(''),
}, table => [index('ai_rate_limits_expiry').on(table.expiresAt)]);

export const triageHistory = sqliteTable('triage_history', {
  id: text('id').primaryKey(), ticketId: text('ticket_id').notNull(), reporter: text('reporter').notNull(),
  signature: text('signature').notNull(), eventAt: integer('event_at').notNull(), storedAt: integer('stored_at').notNull(),
}, table => [index('triage_history_lookup').on(table.reporter, table.signature, table.eventAt), index('triage_history_retention').on(table.storedAt)]);

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
