import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportState, updateSupportState } from '../support-state.ts';
import type { Message } from '../message-types.ts';
const row: Message = { id: 'sample', text: 'помогите', originalText: 'помогите', status: 'pending', createdAt: 1000, processing: null, service: createSupportState('sample', 1000) };
test('escalation requires admin and reason, and survives a clarification', () => {
  assert.throws(() => updateSupportState(row, 'escalate', { reason: 'Платёж' }, 2000, false));
  assert.throws(() => updateSupportState(row, 'escalate', { reason: '' }, 2000, true));
  const service = updateSupportState(row, 'escalate', { reason: 'Нужна проверка платежа' }, 2000, true);
  assert.equal(service.state, 'queued'); assert.equal(service.escalatedAt, 2000);
  assert.equal(service.revision, 1); assert.equal(service.history.at(-1)?.action, 'escalate');
  const child = createSupportState('child', 3000, undefined, { ...row, service });
  assert.equal(child.escalationReason, service.escalationReason); assert.equal(child.firstReceivedAt, 1000);
});
