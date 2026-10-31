export function parseMessageClearRequest(value: unknown): string[] | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { confirmation?: unknown; ids?: unknown };
  if (body.confirmation !== "clear-messages" || !Array.isArray(body.ids) || body.ids.length === 0) return null;
  if (!body.ids.every((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))) return null;
  if (new Set(body.ids).size !== body.ids.length) return null;
  return [...body.ids];
}

// One JSON binding avoids D1's parameter limit for large confirmed snapshots.
// Feedback must be deleted first because it references messages without a cascade.
export function messageClearStatements(ids: readonly string[]) {
  const snapshot = JSON.stringify(ids);
  return [
    { sql: "DELETE FROM message_feedback WHERE message_id IN (SELECT value FROM json_each(?))", snapshot },
    { sql: "DELETE FROM messages WHERE id IN (SELECT value FROM json_each(?))", snapshot },
  ] as const;
}
