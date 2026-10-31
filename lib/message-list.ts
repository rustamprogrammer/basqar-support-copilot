import type { Message } from "./message-types.ts";

export const MESSAGE_PAGE_SIZE = 50;

export function messagePage<T>(rows: readonly T[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / MESSAGE_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1));
  return { page, pageCount, items: rows.slice((page - 1) * MESSAGE_PAGE_SIZE, page * MESSAGE_PAGE_SIZE) };
}

export function retainMessageSnapshot(current: Message[], incoming: Message[]): Message[] {
  if (current.length !== incoming.length) return incoming;
  // Check complete records so changes to feedback or a processing trace remain visible.
  return current.every((row, index) => JSON.stringify(row) === JSON.stringify(incoming[index])) ? current : incoming;
}
