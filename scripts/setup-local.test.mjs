import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireSetupLock, MIGRATIONS, parseSetupArgs, parseWranglerJson, planDatabase, SCHEMA_SQL, SETTINGS_SQL, setupEnvironment, setupLocal, wranglerArguments } from './setup-local.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const readMigration = filename => readFileSync(path.join(sourceRoot, 'drizzle', filename), 'utf8');
function applyAll(sqlite) { for (const filename of MIGRATIONS) sqlite.exec(readMigration(filename)); }
function metadata(sqlite) { return sqlite.prepare(SCHEMA_SQL).all(); }

test('setup requires exactly one rules/archive file and rejects ambiguous or unknown arguments', () => {
  assert.deepEqual(parseSetupArgs(['--rules', 'rules.json']), { rules: 'rules.json', archive: undefined, skipInstall: false, help: false });
  assert.deepEqual(parseSetupArgs(['--archive', 'handout.tgz', '--skip-install']), { rules: undefined, archive: 'handout.tgz', skipInstall: true, help: false });
  assert.equal(parseSetupArgs(['--help']).help, true);
  for (const args of [[], ['--rules'], ['--archive'], ['--rules', 'x', '--archive', 'y'], ['--rules', 'x', '--rules', 'y'],
    ['--rules', 'x', '--remote'], ['--rules', 'x', '--skip-install', '--skip-install']]) assert.throws(() => parseSetupArgs(args));
});

test('actual nine migrations match the complete schema, while empty D1 metadata permits initialization', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('CREATE TABLE _cf_METADATA (key TEXT PRIMARY KEY, value BLOB); CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT);');
    assert.deepEqual(planDatabase(metadata(sqlite)), { state: 'fresh', migrations: [...MIGRATIONS], problems: [] });
    applyAll(sqlite);
    assert.deepEqual(planDatabase(metadata(sqlite)), { state: 'complete', migrations: [], problems: [] });
    assert.deepEqual({ ...sqlite.prepare(SETTINGS_SQL).get() }, { total: 1, valid: 1 });
  } finally { sqlite.close(); }
});

test('every incomplete migration prefix stops without suggesting replay of ALTER statements', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const filename of MIGRATIONS.slice(0, -1)) {
      sqlite.exec(readMigration(filename));
      const plan = planDatabase(metadata(sqlite));
      assert.equal(plan.state, 'partial', filename);
      assert.deepEqual(plan.migrations, []);
      assert.ok(plan.problems.length > 0);
    }
  } finally { sqlite.close(); }
});

test('complete-looking tables with missing or wrong indexes, columns or types are not accepted', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    applyAll(sqlite);
    const rows = metadata(sqlite);
    const variations = [
      rows.filter(row => row.kind !== 'index' || row.name !== 'triage_history_lookup'),
      rows.map(row => row.kind === 'index_column' && row.parent === 'triage_history_lookup' ? { ...row, position: 2 - row.position } : row),
      rows.filter(row => row.kind !== 'column' || row.parent !== 'messages' || row.name !== 'owner_hash'),
      rows.map(row => row.kind === 'column' && row.parent === 'ai_settings' && row.name === 'used' ? { ...row, data_type: 'TEXT' } : row),
      [...rows, { kind: 'column', name: 'future_column', parent: 'messages', data_type: 'TEXT', required: 0, primary_key: 0, position: 99 }],
    ];
    for (const altered of variations) assert.equal(planDatabase(altered).state, 'partial');
    assert.throws(() => planDatabase([{ kind: 'other', name: 'x', parent: '' }]));
  } finally { sqlite.close(); }
});

test('foreign application tables alone cannot be mistaken for an empty Basqar database', () => {
  const sqlite = new DatabaseSync(':memory:');
  try { sqlite.exec('CREATE TABLE unrelated (id TEXT);'); assert.equal(planDatabase(metadata(sqlite)).state, 'partial'); }
  finally { sqlite.close(); }
});

test('Wrangler parser requires bounded successful JSON and never echoes private response text', () => {
  assert.deepEqual(parseWranglerJson('[{"success":true,"results":[{"count":1}]}]'), [{ count: 1 }]);
  for (const raw of ['private-content', '[]', '{"success":true}', '[{"success":false,"results":[]}]', 'x'.repeat(1024 * 1024 + 1)]) {
    assert.throws(() => parseWranglerJson(raw), error => !error.message.includes('private-content'));
  }
});

test('database command is always local, uses the same persistence directory as startup, and bypasses env files', () => {
  const root = path.resolve('fixture project');
  const envFile = path.join(root, '.sites-runtime/setup-empty.env');
  const args = wranglerArguments(root, envFile, '--command', SCHEMA_SQL);
  assert.ok(args.includes('--local'));
  assert.equal(args.includes('--remote'), false);
  assert.equal(args[args.indexOf('--persist-to') + 1], path.join(root, '.wrangler/state'));
  assert.equal(args[args.indexOf('--config') + 1], path.join(root, 'dist/server/wrangler.json'));
  assert.equal(args[args.indexOf('--env-file') + 1], envFile);
  assert.equal(args[0], '--import');
  assert.match(args[1], /^file:/u);
  assert.throws(() => wranglerArguments(root, envFile, '--remote', 'irrelevant'));
  const env = setupEnvironment({ OPENAI_API_KEY: 'fake', SUPPORT_SETTINGS_SECRET: 'fake', SUPPORT_ADMIN_PASSWORD: 'fake', PATH: 'keep' });
  for (const name of ['OPENAI_API_KEY', 'SUPPORT_SETTINGS_SECRET', 'SUPPORT_ADMIN_PASSWORD']) assert.equal(Object.hasOwn(env, name), false);
  assert.equal(env.PATH, 'keep');
  assert.equal(env.AI_REVIEW_ENABLED, 'false');
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'basqar-setup-test-'));
  mkdirSync(path.join(root, 'drizzle'));
  for (const filename of MIGRATIONS) copyFileSync(path.join(sourceRoot, 'drizzle', filename), path.join(root, 'drizzle', filename));
  const rules = path.join(root, 'rules.json');
  const npm = path.join(root, 'npm-cli.js');
  writeFileSync(rules, '{}');
  writeFileSync(npm, '// mock npm');
  const sqlite = new DatabaseSync(':memory:');
  const calls = [], logs = [];
  const run = (args, context) => {
    calls.push({ args, ...context });
    assert.equal(Object.hasOwn(context.env, 'OPENAI_API_KEY'), false);
    if (context.stage === 'triage:prepare') { assert.equal(context.capture, true); return '{"private":"never print this"}'; }
    if (args.includes('--file')) { sqlite.exec(readFileSync(args.at(-1), 'utf8')); return '[{"success":true,"results":[]}]'; }
    if (args.includes('--command')) return JSON.stringify([{ success: true, results: sqlite.prepare(args.at(-1)).all() }]);
    return '';
  };
  return { root, rules, npm, sqlite, calls, logs,
    dependencies: { root, environment: { npm_execpath: npm, OPENAI_API_KEY: 'fake-key' }, run, log: value => logs.push(value) },
    close() { sqlite.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

test('fresh setup orders install, prepare, build, nine migrations and validation; repeat preserves messages, key and counter', () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.root, '.sites-runtime'));
    writeFileSync(path.join(f.root, '.sites-runtime/settings-secret'), 'existing-encryption-secret');
    writeFileSync(path.join(f.root, '.dev.vars'), 'existing-file-must-not-be-read-or-modified');
    assert.deepEqual(setupLocal({ rules: f.rules }, f.dependencies), { database: 'fresh', migrationsApplied: 9 });
    assert.deepEqual(f.calls.slice(0, 3).map(call => call.stage), ['install:ci', 'triage:prepare', 'build']);
    assert.deepEqual(f.calls.filter(call => call.args.includes('--file')).map(call => path.basename(call.args.at(-1))), [...MIGRATIONS]);
    f.sqlite.exec("INSERT INTO messages (id,text,status,created_at) VALUES ('saved','message','pending',1); UPDATE ai_settings SET encrypted_key='opaque-fixture', used=37, enabled=1, mode='all'; INSERT INTO ai_requests(id,token,input_hash,created_at,result_json) VALUES ('cached','token','hash',1,'{}');");
    const before = JSON.stringify(['messages', 'ai_settings', 'ai_requests'].map(table => f.sqlite.prepare(`SELECT * FROM ${table}`).all()));
    const previousCalls = f.calls.length;
    assert.deepEqual(setupLocal({ rules: f.rules, skipInstall: true }, f.dependencies), { database: 'complete', migrationsApplied: 0 });
    const repeated = f.calls.slice(previousCalls);
    assert.equal(repeated.some(call => call.stage === 'install:ci' || call.args.includes('--file')), false);
    assert.equal(JSON.stringify(['messages', 'ai_settings', 'ai_requests'].map(table => f.sqlite.prepare(`SELECT * FROM ${table}`).all())), before);
    assert.equal(readFileSync(path.join(f.root, '.sites-runtime/settings-secret'), 'utf8'), 'existing-encryption-secret');
    assert.equal(readFileSync(path.join(f.root, '.dev.vars'), 'utf8'), 'existing-file-must-not-be-read-or-modified');
    assert.deepEqual(readdirSync(path.join(f.root, '.sites-runtime')), ['settings-secret']);
    assert.equal(f.logs.join('\n').includes('never print this'), false);
  } finally { f.close(); }
});

test('archive setup forwards the path as one argument and does not extract or copy a key', () => {
  const f = fixture();
  try {
    const archive = path.join(f.root, 'handout with spaces.tgz');
    writeFileSync(archive, 'mock archive');
    setupLocal({ archive, skipInstall: true }, f.dependencies);
    assert.deepEqual(f.calls[0].args, [path.join(f.root, 'scripts/prepare-triage-corpus.mjs'), '--archive', archive]);
    assert.equal(existsSync(path.join(f.root, '.dev.vars')), false);
  } finally { f.close(); }
});

test('partial schema halts without any migration, row modification or retained lock', () => {
  const f = fixture();
  try {
    f.sqlite.exec(readMigration(MIGRATIONS[0]));
    f.sqlite.exec("INSERT INTO messages(id,text,status,created_at) VALUES('saved','message','pending',1)");
    assert.throws(() => setupLocal({ rules: f.rules }, f.dependencies), /частичная.*docs\/jury-guide\.md#upgrading-existing-database/u);
    assert.equal(f.calls.some(call => call.args.includes('--file')), false);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 1);
    assert.deepEqual(readdirSync(path.join(f.root, '.sites-runtime')), []);
  } finally { f.close(); }
});

test('missing source fails before install or runtime writes; missing settings row is not silently repaired', () => {
  const f = fixture();
  try {
    assert.throws(() => setupLocal({ rules: path.join(f.root, 'missing.json') }, f.dependencies));
    assert.equal(f.calls.length, 0);
    assert.equal(existsSync(path.join(f.root, '.sites-runtime')), false);
    applyAll(f.sqlite);
    f.sqlite.exec('DELETE FROM ai_settings');
    assert.throws(() => setupLocal({ rules: f.rules }, f.dependencies), /ai_settings/u);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM ai_settings').get().count, 0);
    assert.equal(f.calls.some(call => call.args.includes('--file')), false);
  } finally { f.close(); }
});

test('exclusive setup lock blocks concurrent work and only its owner releases it', () => {
  const f = fixture();
  try {
    const unlock = acquireSetupLock(f.root);
    const filename = path.join(f.root, '.sites-runtime/setup-local.lock');
    const original = readFileSync(filename, 'utf8');
    assert.throws(() => setupLocal({ rules: f.rules }, f.dependencies), /lock/u);
    assert.equal(f.calls.length, 0);
    assert.equal(readFileSync(filename, 'utf8'), original);
    unlock(); unlock();
    assert.equal(existsSync(filename), false);
  } finally { f.close(); }
});

test('failed preparation releases the setup lock and prevents build or migration', () => {
  const f = fixture();
  try {
    const run = f.dependencies.run;
    f.dependencies.run = (args, context) => { if (context.stage === 'triage:prepare') throw new Error('fixture preparation failure'); return run(args, context); };
    assert.throws(() => setupLocal({ rules: f.rules }, f.dependencies), /fixture preparation failure/u);
    assert.deepEqual(f.calls.map(call => call.stage), ['install:ci']);
    assert.deepEqual(readdirSync(path.join(f.root, '.sites-runtime')), []);
  } finally { f.close(); }
});
