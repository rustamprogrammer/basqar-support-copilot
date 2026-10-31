import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "./message-types.ts";
import { messagePage, retainMessageSnapshot } from "./message-list.ts";

test("1500 messages remain complete across 30 pages with at most 50 cards", () => {
  const rows = Array.from({ length: 1500 }, (_, id) => ({ id }));
  const pages = Array.from({ length: 30 }, (_, index) => messagePage(rows, index + 1));
  assert.ok(pages.every(page => page.pageCount === 30 && page.items.length === 50));
  assert.deepEqual(pages.flatMap(page => page.items), rows);
  assert.equal(rows.length, 1500);
});

test("page bounds stay usable after filtering, clearing, and partial final pages", () => {
  assert.deepEqual(messagePage([], 30), { page: 1, pageCount: 1, items: [] });
  const rows = Array.from({ length: 51 }, (_, id) => id);
  assert.deepEqual(messagePage(rows, 30), { page: 2, pageCount: 2, items: [50] });
  assert.equal(messagePage(rows, 0).page, 1);
});

test("unchanged polling reuses state while status, feedback, trace, and order changes update it", () => {
  const current: Message[] = [
    { id: "first", text: "Помогите", originalText: null, status: "pending", createdAt: 1, processing: { classification: "report", route: "help", steps: [] } },
    { id: "second", text: "Где настройки?", originalText: null, status: "pending", createdAt: 2, processing: null },
  ];
  assert.equal(retainMessageSnapshot(current, structuredClone(current)), current);
  for (const change of [
    (rows: Message[]) => { rows[0].status = "accepted"; },
    (rows: Message[]) => { rows[0].feedback = { label: "help", correctedText: null, note: "Проверено", updatedAt: 1 }; },
    (rows: Message[]) => { rows[0].processing!.needsClarification = true; },
    (rows: Message[]) => { rows.reverse(); },
    (rows: Message[]) => { rows.pop(); },
  ]) {
    const incoming = structuredClone(current);
    change(incoming);
    assert.equal(retainMessageSnapshot(current, incoming), incoming);
  }
});
