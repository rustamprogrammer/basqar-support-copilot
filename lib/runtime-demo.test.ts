import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadRuntimeConfiguration, loadSettingsSecret, runtimeDemoMode, runtimeEnvironment, redactOutput } from '../scripts/start-local.mjs';

function fixture() {
  const prefix = path.resolve(tmpdir(), 'basqar-demo-test-');
  const root = mkdtempSync(prefix);
  return { root, cleanup() { assert.ok(path.resolve(root).startsWith(prefix)); rmSync(root, { recursive: true, force: true }); } };
}

test('Default runtime is a public demo and creates no administrator password file', () => {
  const f = fixture();
  try {
    const runtime = loadRuntimeConfiguration(f.root, {});
    assert.equal(runtime.publicDemo, true); assert.equal(runtime.password, undefined); assert.equal(runtime.passwordPath, undefined);
    assert.equal(existsSync(path.join(f.root, '.sites-runtime', 'admin-password.txt')), false);
    assert.equal(runtimeDemoMode({ SUPPORT_DEMO_MODE: 'false' }), false);
  } finally { f.cleanup(); }
});

test('Demo startup neither reads nor rewrites an existing unusable password file', () => {
  const f = fixture();
  try {
    const runtime = path.join(f.root, '.sites-runtime'); mkdirSync(runtime);
    const passwordFile = path.join(runtime, 'admin-password.txt'); writeFileSync(passwordFile, 'x');
    const config = loadRuntimeConfiguration(f.root, {});
    assert.equal(config.publicDemo, true); assert.equal(config.password, undefined);
    assert.equal(readFileSync(passwordFile, 'utf8'), 'x', 'The old optional secure-mode password is left untouched');
  } finally { f.cleanup(); }
});

test('Demo environment removes inherited credentials and keeps network AI disabled', () => {
  const parent = { SUPPORT_ADMIN_PASSWORD: 'synthetic-unused-admin-secret', OPENAI_API_KEY: 'synthetic-unused-api-secret', AI_REVIEW_ENABLED: 'true', OTHER: 'preserved' };
  const env = runtimeEnvironment(parent);
  assert.equal(env.SUPPORT_DEMO_MODE, 'true'); assert.equal(env.AI_REVIEW_ENABLED, 'false'); assert.equal(env.CLOUDFLARE_INCLUDE_PROCESS_ENV, 'true');
  assert.equal(Object.hasOwn(env, 'SUPPORT_ADMIN_PASSWORD'), false); assert.equal(Object.hasOwn(env, 'OPENAI_API_KEY'), false);
  assert.equal(env.OTHER, 'preserved'); assert.equal(parent.AI_REVIEW_ENABLED, 'true');
});

test('An explicit secure mode reuses a generated password and passes it only at runtime', () => {
  const f = fixture();
  try {
    const parent = { SUPPORT_DEMO_MODE: 'false' };
    const first = loadRuntimeConfiguration(f.root, parent), second = loadRuntimeConfiguration(f.root, parent);
    assert.equal(first.publicDemo, false); assert.match(first.password!, /^[A-Za-z0-9_-]{43}$/); assert.equal(first.password, second.password);
    const env = runtimeEnvironment(parent, first.password);
    assert.equal(env.SUPPORT_DEMO_MODE, 'false'); assert.equal(env.SUPPORT_ADMIN_PASSWORD, first.password); assert.equal(env.AI_REVIEW_ENABLED, 'false');
  } finally { f.cleanup(); }
});

test('Output without a demo password passes through and secure-mode redaction still handles split chunks', () => {
  let demo = ''; const plain = redactOutput(undefined, (chunk: string) => { demo += chunk; }); plain.chunk('ready'); plain.end(); assert.equal(demo, 'ready');
  let secure = ''; const redacted = redactOutput('synthetic-secret', (chunk: string) => { secure += chunk; }); redacted.chunk('before synthetic-'); redacted.chunk('secret after'); redacted.end(); assert.equal(secure, 'before [hidden] after');
});

test('Settings encryption secret is stable across restarts and never inherited from an unrelated process', () => {
  const f = fixture();
  try {
    const first = loadSettingsSecret(f.root), second = loadSettingsSecret(f.root);
    assert.match(first, /^[A-Za-z0-9_-]{43}$/u); assert.equal(first, second);
    const inherited = { SUPPORT_SETTINGS_SECRET: 'untrusted-inherited-value', OPENAI_API_KEY: 'unrelated-api-key' };
    assert.equal(Object.hasOwn(runtimeEnvironment(inherited), 'SUPPORT_SETTINGS_SECRET'), false);
    const env = runtimeEnvironment(inherited, undefined, true, first);
    assert.equal(env.SUPPORT_SETTINGS_SECRET, first); assert.equal(Object.hasOwn(env, 'OPENAI_API_KEY'), false);
    writeFileSync(path.join(f.root, '.sites-runtime', 'settings-secret'), 'broken');
    assert.throws(() => loadSettingsSecret(f.root), /повреждён/u);
  } finally { f.cleanup(); }
});
