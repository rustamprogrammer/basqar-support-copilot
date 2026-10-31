import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { Message } from './message-types.ts';
import { messageRoute } from './message-routes.ts';
import { createSupportState, effectiveState, effectiveUrgency, latestCases, sortHelpQueue } from './support-state.ts';
import { inboxResponse, inboxStatement, parseInboxOptions, selectorStatement, type InboxOptions, type InboxSqlRow } from './inbox-query.ts';

const now = 1_800_000_000_000;
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, text TEXT NOT NULL, original_text TEXT, processing TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, owner_hash TEXT, service TEXT);
    CREATE TABLE message_feedback (message_id TEXT PRIMARY KEY, label TEXT, routing_schema TEXT, needs_clarification INTEGER, corrected_text TEXT, note TEXT, updated_at INTEGER);`);
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const rows: Message[] = [];
  function add(row: Message, owner = 'owner-a') {
    insert.run(row.id, row.text, row.originalText, row.processing ? JSON.stringify(row.processing) : null, row.status, row.createdAt, owner, row.service ? JSON.stringify(row.service) : null);
    rows.push(row); return row;
  }
  function query(overrides: Partial<InboxOptions> = {}) {
    const options = { ...parseInboxOptions(new URLSearchParams()), ...overrides };
    const statement = inboxStatement(options, now);
    return inboxResponse(db.prepare(statement.sql).get(...statement.params) as InboxSqlRow);
  }
  return { db, rows, add, query };
}
function row(id: string, route: 'help' | 'question' | 'trash' | 'violation' | null = 'help', createdAt = now - 1000): Message {
  return { id, text: `Сообщение ${id}`, originalText: null, status: route === 'trash' || route === 'violation' ? route : 'pending', createdAt,
    processing: { classification: route === 'trash' || route === 'violation' ? route : 'report', route, steps: [] }, service: createSupportState(id, createdAt) };
}
function withUrgency(item: Message, level: 'now' | 'high' | 'normal') {
  item.processing!.urgency = { level, eventTime: 'ongoing', uncertain: false, reason: 'Проверка', evidence: [], needsLiveObservation: level === 'now' }; return item;
}
const matchesWorkflow = (item: Message, workflow: InboxOptions['workflow']) => workflow === 'all' || (workflow === 'pending' ? item.status === 'pending' && ['queued', 'in_progress'].includes(effectiveState(item)) : effectiveState(item) === (workflow === 'accepted' ? 'resolved' : 'answered'));

test('Database pagination matches queue semantics across workflow, category, urgency and legacy records', () => {
  const f = fixture();
  try {
    const parent = f.add(row('root', 'help', now - 30 * 60_000));
    const child = row('child', 'help', now - 2000); child.service = createSupportState(child.id, child.createdAt, undefined, parent); f.add(child);
    f.add(withUrgency(row('live', 'help', now - 50), 'now'));
    const high = withUrgency(row('manual', 'help', now - 10_000), 'normal'); high.service!.manualUrgency = 'high'; f.add(high);
    f.add(withUrgency(row('recent', 'help', now - 100), 'normal'));
    const answered = row('answered-help', 'help', now - 50 * 60_000); answered.service!.state = 'answered'; f.add(answered);
    const resolved = row('resolved-help', 'help', now - 60_000); resolved.status = 'accepted'; resolved.service!.state = 'resolved'; f.add(resolved);
    f.add(row('question', 'question'));
    const faq = row('faq', 'question'); faq.service!.state = 'answered'; f.add(faq);
    const legacy = row('legacy', 'question'); legacy.processing = { classification: 'report', topic: 'Вопрос по игре', steps: [] }; legacy.service = null; f.add(legacy);
    f.add(row('explicit-null', null));
    const restored = row('restored', 'violation'); restored.status = 'pending'; f.add(restored);
    const terminal = row('terminal-child', 'trash'); terminal.service!.caseId = parent.id; f.add(terminal);
    f.add(row('violation', 'violation'));
    const acceptedLegacy = row('accepted-legacy', 'help'); acceptedLegacy.status = 'accepted'; acceptedLegacy.service = null; f.add(acceptedLegacy);
    const latest = latestCases(f.rows);
    for (const workflow of ['all', 'pending', 'answered', 'accepted'] as const) {
      for (const category of ['all', 'question', 'help', 'undetermined', 'violation', 'trash'] as const) {
        for (const urgency of ['all', 'now', 'high', 'normal'] as const) {
          const result = f.query({ workflow, category, urgency, pageSize: 50 });
          let expected = latest.filter(item => matchesWorkflow(item, workflow) && (category === 'all' || messageRoute(item) === (category === 'undetermined' ? null : category)) && (category !== 'help' || urgency === 'all' || effectiveUrgency(item) === urgency));
          expected = category === 'help' ? sortHelpQueue(expected, now) : expected.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
          assert.deepEqual(result.items.map(item => item.id), expected.map(item => item.id), `${workflow}/${category}/${urgency}`);
          assert.equal(result.total, expected.length);
          assert.equal(result.allCount, f.rows.length);
          for (const countCategory of ['all', 'question', 'help', 'undetermined', 'violation', 'trash'] as const) {
            const expectedCount = latest.filter(item => (countCategory === 'violation' || countCategory === 'trash' || matchesWorkflow(item, workflow)) && (countCategory === 'all' || messageRoute(item) === (countCategory === 'undetermined' ? null : countCategory))).length;
            assert.equal(result.counts[countCategory], expectedCount, `count ${workflow}/${countCategory}`);
          }
        }
      }
    }
  } finally { f.db.close(); }
});

test('Aging promotes waiting normal cases but does not promote answered cases or overtake live incidents', () => {
  const f = fixture();
  try {
    f.add(withUrgency(row('live', 'help', now - 10), 'now'));
    f.add(withUrgency(row('old', 'help', now - 16 * 60_000), 'normal'));
    f.add(withUrgency(row('high', 'help', now - 60_000), 'high'));
    const answered = row('answered', 'help', now - 60 * 60_000); answered.service!.state = 'answered'; f.add(answered);
    f.add(row('normal', 'help', now - 100));
    assert.deepEqual(f.query({ category: 'help', workflow: 'all' }).items.map(item => item.id), ['live', 'old', 'high', 'answered', 'normal']);
  } finally { f.db.close(); }
});

test('Search is literal, multilingual, and applies after latest grouping to counts and results', () => {
  const f = fixture();
  try {
    for (const [id, text] of Object.entries({ ru: 'ПОМОГИТЕ', kk: 'ҚАЗАҚША ӘРІП', uk: 'УКРАЇНСЬКА ҐАНОК', uz: 'O‘ZBEKCHA', symbols: 'A*[?] 100%' })) f.add({ ...row(id), text });
    const parent = f.add({ ...row('old-search'), text: 'исчезнувший текст' });
    const child = { ...row('new-search', 'help', now), text: 'новый текст', service: createSupportState('new-search', now, undefined, parent) }; f.add(child);
    const original = row('original-only'); original.originalText = 'Перевірка початкового тексту'; f.add(original);
    for (const [q, id] of [['помогите', 'ru'], ['қазақша әріп', 'kk'], ['українська ґанок', 'uk'], ['o‘zbekcha', 'uz'], ['*[?]', 'symbols'], ['перевірка', 'original-only']]) {
      const result = f.query({ q }); assert.deepEqual(result.items.map(item => item.id), [id], q); assert.equal(result.counts.all, 1);
    }
    assert.equal(f.query({ q: 'исчезнувший' }).total, 0);
    assert.equal(f.query({ q: "' OR 1=1 --" }).total, 0);
    assert.equal(f.query({ q: '%' }).total, 1);
  } finally { f.db.close(); }
});

test('Only the requested page contains full payloads; page bounds and latest ties are deterministic', () => {
  const f = fixture();
  try {
    for (let index = 0; index < 123; index++) f.add({ ...row(`m-${String(index).padStart(3, '0')}`, 'question', now + index), processing: { classification: 'report', route: 'question', steps: [{ id: 'received', title: 'Текст', value: 'а'.repeat(2000) }] } });
    const first = f.query({ workflow: 'all', pageSize: 50 });
    assert.equal(first.items.length, 50); assert.equal(first.total, 123); assert.equal(first.pageCount, 3);
    const last = f.query({ workflow: 'all', pageSize: 50, page: 9999 });
    assert.equal(last.page, 3); assert.equal(last.items.length, 23);
    assert.equal(last.items.at(-1)?.id, 'm-000');
    assert.ok(JSON.stringify(first).length < 150_000, 'The response excludes full payloads of records outside the page');
    for (const item of first.items) assert.equal(Object.hasOwn(item, 'ownerHash'), false);
    const same = row('tie-root'); const a = row('tie-a', 'help', now + 1000), z = row('tie-z', 'help', now + 1000);
    a.service!.caseId = same.id; z.service!.caseId = same.id; f.add(same); f.add(a); f.add(z);
    assert.deepEqual(f.query({ category: 'help' }).items.map(item => item.id), ['tie-z']);
  } finally { f.db.close(); }
});

test('Empty queues have a valid page and selected feedback is decoded without changing booleans', () => {
  const f = fixture();
  try {
    const empty = f.query(); assert.equal(empty.page, 1); assert.equal(empty.pageCount, 1); assert.equal(empty.total, 0); assert.deepEqual(empty.items, []);
    f.add(row('feedback', 'question'));
    f.db.prepare('INSERT INTO message_feedback VALUES (?, ?, ?, ?, ?, ?, ?)').run('feedback', 'question', 'purpose-v1', 1, null, 'Проверено', now);
    assert.equal(f.query().items[0].feedback?.needsClarification, true);
    assert.equal(f.query().items[0].feedback?.note, 'Проверено');
  } finally { f.db.close(); }
});

test('Selector has a hard limit, excludes private payloads, and respects visitor ownership', () => {
  const f = fixture();
  try {
    for (let index = 0; index < 110; index++) f.add(row(`visible-${index}`, 'question', now + index), 'owner-a');
    const privateRow = row('private', 'help', now + 1000); privateRow.text = 'СЕКРЕТ'; f.add(privateRow, 'owner-b');
    f.add({ ...row('no-processing'), processing: null });
    const query = (params: string, owner: string | null) => { const statement = selectorStatement(new URLSearchParams(params), owner); return f.db.prepare(statement.sql).all(...statement.params); };
    const visitorRows = query('limit=1000', 'owner-a');
    assert.equal(visitorRows.length, 100); assert.equal(visitorRows.some(item => item.id === 'private'), false);
    assert.deepEqual(Object.keys(visitorRows[0]).sort(), ['createdAt', 'id', 'originalText', 'processing', 'text']);
    assert.deepEqual(Object.keys(JSON.parse(visitorRows[0].processing as string)).sort(), ['context', 'route']);
    assert.equal(query('q=секрет', 'owner-a').length, 0);
    assert.equal(query('q=секрет', null)[0].id, 'private');
    assert.equal(query('', 'unknown-owner').length, 0);
  } finally { f.db.close(); }
});

test('Request options are bounded and invalid filters cannot become SQL', () => {
  assert.deepEqual(parseInboxOptions(new URLSearchParams()), { category: 'all', workflow: 'pending', urgency: 'all', q: '', page: 1, pageSize: 20 });
  const options = parseInboxOptions(new URLSearchParams({ page: '-1', pageSize: '999', q: '  ' + 'x'.repeat(250), category: "' OR 1=1 --", workflow: 'invalid', urgency: 'none' }));
  assert.equal(options.page, 1); assert.equal(options.pageSize, 50); assert.equal(options.q.length, 200); assert.equal(options.category, 'all'); assert.equal(options.workflow, 'pending');
});

test('Long UUIDs, literal metacharacters and all supported alphabets do not use pattern matching', () => {
  const f = fixture();
  try {
    const alphabet = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя әғқңөұүһі їєґ ўзбекча yordam ';
    const q = alphabet.repeat(4).slice(0, 200);
    f.add({ ...row('unicode-long'), text: q.toUpperCase() });
    assert.deepEqual(f.query({ q }).items.map(item => item.id), ['unicode-long']);
    const uuid = 'fdec336c-f55d-4db0-9541-15c5308e49b0';
    f.add(row(uuid));
    assert.deepEqual(f.query({ q: uuid }).items.map(item => item.id), [uuid]);
    const statement = inboxStatement(parseInboxOptions(new URLSearchParams({ q })));
    assert.equal(/\b(?:LIKE|GLOB)\b/.test(statement.sql), false, 'Workerd has a stricter pattern complexity limit than Node SQLite');
    assert.equal(statement.params.length, 8, 'A long Unicode query does not add SQL parameters or nested expressions');
  } finally { f.db.close(); }
});
