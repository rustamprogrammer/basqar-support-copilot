import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { caseSnapshotGuard, latestCaseStatement } from './case-guard.ts';
import { createSupportState, latestCases, updateSupportState } from './support-state.ts';
import type { Message } from './message-types.ts';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, status TEXT NOT NULL, service TEXT, created_at INTEGER NOT NULL)');
  const row: Message = { id: 'root', text: 'Меня сейчас бьют, помогите', originalText: null, status: 'pending', createdAt: 1000, processing: null, service: createSupportState('root', 1000) };
  const add = (item: Message) => db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?)').run(item.id, item.status, item.service ? JSON.stringify(item.service) : null, item.createdAt);
  const latest = (item: Message) => { const query = latestCaseStatement(item); return db.prepare(query.sql).get(...query.params)?.id ?? item.id; };
  const update = (before: Message, after: Message) => {
    const guard = caseSnapshotGuard(before);
    return db.prepare(`UPDATE messages SET status = ?, service = ? WHERE id = ? AND ${guard.sql}`).run(after.status, after.service ? JSON.stringify(after.service) : null, before.id, ...guard.params).changes;
  };
  const clarify = (before: Message, child: Message) => {
    const guard = caseSnapshotGuard(before);
    return db.prepare(`INSERT INTO messages SELECT ?, ?, ?, ? WHERE ${guard.sql} ON CONFLICT DO NOTHING`).run(child.id, child.status, JSON.stringify(child.service), child.createdAt, ...guard.params).changes;
  };
  const read = (id: string): Message => { const value = db.prepare('SELECT * FROM messages WHERE id = ?').get(id)!; return { ...row, id, status: value.status as Message['status'], createdAt: value.created_at as number, service: value.service ? JSON.parse(value.service as string) : null }; };
  add(row);
  return { db, row, add, latest, update, clarify, read };
}
function childOf(parent: Message, id = 'child'): Message {
  return { ...parent, id, createdAt: parent.createdAt + 1, service: createSupportState(id, parent.createdAt + 1, undefined, parent) };
}

for (const status of ['trash', 'violation'] as const) test(`A ${status} clarification can be restored while an active old parent stays protected`, () => {
  const f = fixture();
  try {
    const child = childOf(f.row); child.status = status; f.add(child);
    assert.equal(f.latest(child), child.id, 'The terminal card is independently actionable');
    assert.equal(f.latest(f.row), f.row.id, 'It does not hide the active parent');
    assert.equal(latestCases([f.row, child]).length, 2);
    assert.equal(f.update(child, { ...child, status: 'pending' }), 1, 'Restore passes the same atomic guard as PATCH');
    assert.equal(f.latest(f.row), child.id);
    assert.equal(f.update(f.row, { ...f.row, status: 'accepted' }), 0, 'The active old parent cannot now be accepted');
    assert.equal(f.clarify(f.row, childOf(f.row, 'stale-child')), 0, 'Nor can the old parent gain another clarification');
    assert.deepEqual(latestCases([f.read(f.row.id), f.read(child.id)]).map(row => row.id), [child.id]);
  } finally { f.db.close(); }
});

test('A reply committed first rejects an old clarification snapshot; retry keeps the reply history', () => {
  const f = fixture();
  try {
    const staleChild = childOf(f.row);
    const replied = { ...f.row, service: updateSupportState(f.row, 'reply', { text: 'Администратор проверил и ждёт место.' }, 1001, true) };
    assert.equal(f.update(f.row, replied), 1);
    assert.equal(f.clarify(f.row, staleChild), 0);
    const fresh = f.read(f.row.id), retried = childOf(fresh);
    assert.equal(f.clarify(fresh, retried), 1);
    assert.ok(f.read(retried.id).service?.history.some(event => event.action === 'reply' && event.detail === 'Администратор проверил и ждёт место.'));
  } finally { f.db.close(); }
});

test('A clarification committed first prevents a late administrator reply to its parent', () => {
  const f = fixture();
  try {
    const child = childOf(f.row);
    const delayedReply = { ...f.row, service: updateSupportState(f.row, 'reply', { text: 'Этот ответ уже устарел.' }, 1002, true) };
    assert.equal(f.clarify(f.row, child), 1);
    assert.equal(f.update(f.row, delayedReply), 0, 'No reply may disappear into a superseded parent');
    assert.equal(f.latest(f.row), child.id);
    assert.equal(f.read(f.row.id).service?.reply, undefined);
  } finally { f.db.close(); }
});

test('Two clarifications prepared from one parent cannot both commit', () => {
  const f = fixture();
  try {
    assert.equal(f.clarify(f.row, childOf(f.row, 'first')), 1);
    assert.equal(f.clarify(f.row, childOf(f.row, 'second')), 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n, 2);
  } finally { f.db.close(); }
});

test('A status change on a legacy row with null service invalidates its old snapshot', () => {
  const f = fixture();
  try {
    const legacy = { ...f.row, id: 'legacy', service: null }; f.add(legacy);
    assert.equal(f.update(legacy, { ...legacy, status: 'trash' }), 1);
    assert.equal(f.update(legacy, { ...legacy, status: 'accepted' }), 0);
    assert.equal(f.clarify(legacy, childOf(legacy)), 0);
  } finally { f.db.close(); }
});

test('An unrelated case does not block an update, and identifiers remain SQL parameters', () => {
  const f = fixture();
  try {
    const other = { ...f.row, id: "other' OR 1=1 --", createdAt: 9999, service: createSupportState("other' OR 1=1 --", 9999) }; f.add(other);
    assert.equal(f.latest(f.row), f.row.id);
    assert.equal(f.update(f.row, { ...f.row, status: 'accepted' }), 1);
    assert.equal(f.read(other.id).status, 'pending');
  } finally { f.db.close(); }
});
