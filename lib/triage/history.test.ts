import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { historyStatements, recordTriageHistory, type HistoryRecord } from './history.ts';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../drizzle/0007_triage_history.sql', import.meta.url), 'utf8'));
  const record = (input: HistoryRecord) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const statements = historyStatements(input);
      for (const statement of statements.slice(0, 2)) db.prepare(statement.sql).run(...statement.params);
      const result = db.prepare(statements[2].sql).get(...statements[2].params) as { ticket_id: string } | undefined;
      db.exec('COMMIT');
      return result?.ticket_id;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  return { db, record };
}
const initial: HistoryRecord = { id: 'z-first', ticketId: 'first', reporter: 'reporter-a', signature: 'same-problem', eventAt: 10_000, storedAt: 10_000 };

test('equal-timestamp submissions with reverse-sorted IDs identify one duplicate and keep retries stable', () => {
  const { db, record } = fixture();
  try {
    assert.equal(record(initial), undefined);
    const second = { ...initial, id: 'a-second', ticketId: 'second' };
    assert.equal(record(second), 'first');
    assert.equal(record({ ...initial, eventAt: 20_000, storedAt: 20_000 }), undefined);
    assert.equal(record({ ...second, eventAt: 20_000, storedAt: 20_000 }), 'first');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM triage_history').get()?.count, 2);
  } finally { db.close(); }
});

test('history isolates reporter, problem, event window and ticket identity', () => {
  const { db, record } = fixture();
  try {
    record(initial);
    assert.equal(record({ ...initial, id: 'b', ticketId: 'b', reporter: 'reporter-b' }), undefined);
    assert.equal(record({ ...initial, id: 'c', ticketId: 'c', signature: 'different-problem' }), undefined);
    assert.equal(record({ ...initial, id: 'd', ticketId: 'd', eventAt: initial.eventAt + 3600001 }), undefined);
    assert.equal(record({ ...initial, id: 'e', ticketId: 'e', eventAt: initial.eventAt - 1 }), undefined);
  } finally { db.close(); }
});

test('expired history is removed before matching', () => {
  const { db, record } = fixture();
  try {
    record(initial);
    assert.equal(record({ ...initial, id: 'next-day', ticketId: 'next-day', storedAt: initial.storedAt + 86400001 }), undefined);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM triage_history').get()?.count, 1);
  } finally { db.close(); }
});

test('concurrent callers use an atomic batch and exactly one becomes a duplicate', async () => {
  const { db } = fixture();
  const prepare = (sql: string, params: (string | number)[] = []) => ({ sql, params, bind: (...values: (string | number)[]) => prepare(sql, values) });
  const client = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(({ sql, params }) => {
        const statement = db.prepare(sql);
        if (sql.startsWith('SELECT')) return { results: statement.all(...params) };
        statement.run(...params);
        return { results: [] };
      });
      db.exec('COMMIT');
      return results;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } } as unknown as Pick<D1Database, 'prepare' | 'batch'>;
  try {
    assert.deepEqual(await Promise.all([
      recordTriageHistory(client, initial),
      recordTriageHistory(client, { ...initial, id: 'a-second', ticketId: 'second' }),
    ]), [undefined, 'first']);
  } finally { db.close(); }
});
