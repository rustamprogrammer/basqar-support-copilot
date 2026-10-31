import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { messageClearStatements, parseMessageClearRequest } from "./message-clearing.ts";

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

test("clearing requires explicit confirmation and a valid unique snapshot", () => {
  for (const body of [null, {}, { ids: [id(1)] }, { confirmation: "clear-messages", ids: [] },
    { confirmation: "clear-messages", ids: ["invalid"] }, { confirmation: "clear-messages", ids: [id(1), id(1)] }]) {
    assert.equal(parseMessageClearRequest(body), null);
  }
  assert.deepEqual(parseMessageClearRequest({ confirmation: "clear-messages", ids: [id(1), id(2)] }), [id(1), id(2)]);
});

test("clearing 1500 messages removes their feedback but preserves later messages and unrelated data", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE messages (id TEXT PRIMARY KEY, processing TEXT);
      CREATE TABLE message_feedback (message_id TEXT PRIMARY KEY REFERENCES messages(id), note TEXT);
      CREATE TABLE quality_datasets (name TEXT PRIMARY KEY);
      CREATE TABLE dictionaries (word TEXT PRIMARY KEY);
      INSERT INTO quality_datasets VALUES ('frozen-evaluation');
      INSERT INTO dictionaries VALUES ('DM');`);
    const message = db.prepare("INSERT INTO messages VALUES (?, ?)");
    const feedback = db.prepare("INSERT INTO message_feedback VALUES (?, ?)");
    const ids = Array.from({ length: 1500 }, (_, index) => id(index));
    for (const messageId of [...ids, id(1500)]) {
      message.run(messageId, '{"steps":[],"reply":"stored history"}');
      feedback.run(messageId, "manual feedback");
    }
    db.exec("BEGIN");
    const changes = messageClearStatements(ids).map(statement => db.prepare(statement.sql).run(statement.snapshot).changes);
    db.exec("COMMIT");
    assert.deepEqual(changes, [1500, 1500]);
    assert.deepEqual(db.prepare("SELECT id FROM messages").all().map(row => row.id), [id(1500)]);
    assert.deepEqual(db.prepare("SELECT message_id FROM message_feedback").all().map(row => row.message_id), [id(1500)]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM quality_datasets").get()?.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dictionaries").get()?.n, 1);
    // A retry is safe and cannot erase a message outside the confirmed snapshot.
    assert.deepEqual(messageClearStatements(ids).map(statement => db.prepare(statement.sql).run(statement.snapshot).changes), [0, 0]);
  } finally { db.close(); }
});
