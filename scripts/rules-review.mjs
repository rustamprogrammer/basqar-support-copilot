import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Local review catalog only: no prediction, rule generation, training or database writes.
const topics = Object.freeze({
  appeal: 'Обжалование наказания', administration: 'Действия администрации',
  player: 'Жалоба на игрока', help: 'Помощь в игре', question: 'Вопрос по игре',
  property: 'Аккаунт и имущество', payment: 'Платёж',
  clarify: 'Нужно уточнение', trash: 'Мусор', violation: 'Оскорбление в обращении',
});
const terminalLabels = new Set(['clarify', 'trash', 'violation']);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const statuses = new Set(['proposed', 'provisional', 'approved', 'rejected']);
const usage = 'Usage: node scripts/rules-review.mjs --input export.jsonl --output reviewed.jsonl (--approve-ids id1,id2 | --reject-ids id1,id2) [--fixtures-output evaluation.jsonl]';

export function parseIds(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Select nonempty explicit IDs; reviewing all rows implicitly is not allowed');
  const ids = value.split(',').map(id => id.trim());
  if (ids.some(id => !idPattern.test(id))) throw new Error('Invalid selected ID');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate selected ID');
  return ids;
}

export function parseJsonl(content) {
  return content.replace(/^\uFEFF/u, '').split(/\r?\n/u).flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; }
    catch { throw new Error(`Invalid JSON on line ${index + 1}`); }
  });
}

function effectiveLabel(row) {
  if (row.label === 'unknown' && terminalLabels.has(row.routeLabel)) return row.routeLabel;
  if (!Object.hasOwn(topics, row.label)) throw new Error(`Unknown label: ${row.id}`);
  if (row.routeLabel !== undefined && row.routeLabel !== row.label) throw new Error(`Conflicting label and routeLabel: ${row.id}`);
  return row.label;
}

function validateRows(rows) {
  if (!Array.isArray(rows)) throw new Error('Expected a list of review cases');
  const ids = new Set();
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid review case');
    if (typeof row.id !== 'string' || !idPattern.test(row.id) || ids.has(row.id)) throw new Error('Missing, invalid or duplicate case ID');
    ids.add(row.id);
    if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > 2000) throw new Error(`Invalid text: ${row.id}`);
    if (typeof row.label !== 'string') throw new Error(`Invalid label: ${row.id}`);
    effectiveLabel(row);
    if (row.routingSchema !== undefined && row.routingSchema !== null && row.routingSchema !== 'purpose-v1') throw new Error(`Unknown routing schema: ${row.id}`);
    if (row.routingSchema === 'purpose-v1' && !['question','help','trash','violation','clarify'].includes(effectiveLabel(row))) throw new Error(`Legacy topic in purpose schema: ${row.id}`);
    if (row.needsClarification !== undefined && ![true,false,null].includes(row.needsClarification)) throw new Error(`Invalid clarification label: ${row.id}`);
    for (const field of ['correctedText', 'expectedCorrectedText']) {
      if (row[field] !== undefined && row[field] !== null && (typeof row[field] !== 'string' || row[field].length > 2000)) throw new Error(`Invalid ${field}: ${row.id}`);
    }
    if (row.correctedText != null && row.expectedCorrectedText != null && row.correctedText !== row.expectedCorrectedText) throw new Error(`Conflicting corrected texts: ${row.id}`);
    if (row.note !== undefined && row.note !== null && (typeof row.note !== 'string' || row.note.length > 500)) throw new Error(`Invalid note: ${row.id}`);
    if (row.reviewStatus !== undefined && !statuses.has(row.reviewStatus)) throw new Error(`Invalid review status: ${row.id}`);
    // Copy data, not arbitrary instructions or imported assertions of human review.
    /** @type {{id: string, text: string, label: string, reviewStatus: string, routeLabel?: string, correctedText?: string|null, expectedCorrectedText?: string|null, note?: string|null, source?: unknown, updatedAt?: unknown, reviewedAt?: string, reviewedBy?: string, reviewMethod?: string}} */
    const clean = { id: row.id, text: row.text, label: row.label, reviewStatus: row.reviewStatus ?? 'proposed' };
    for (const field of ['routeLabel', 'correctedText', 'expectedCorrectedText', 'note', 'source', 'updatedAt', 'routingSchema', 'needsClarification']) {
      if (Object.hasOwn(row, field)) clean[field] = row[field];
    }
    return clean;
  });
}

const textKey = text => text.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function correction(row) {
  const value = row.correctedText ?? row.expectedCorrectedText;
  return typeof value === 'string' && value.trim() ? value : undefined;
}
function checkConflicts(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = textKey(row.text), previous = seen.get(key);
    if (previous && (effectiveLabel(previous) !== effectiveLabel(row) || correction(previous) !== correction(row) || (previous.needsClarification != null && row.needsClarification != null && previous.needsClarification !== row.needsClarification))) throw new Error(`Conflicting approved cases for the same text: ${previous.id}, ${row.id}`);
    seen.set(key, row);
  }
}

export function reviewCases(rows, options = {}) {
  const { approveIds = [], rejectIds = [], reviewedAt = new Date().toISOString() } = options;
  if (!Array.isArray(approveIds) || !Array.isArray(rejectIds) || (!!approveIds.length === !!rejectIds.length)) throw new Error('Choose exactly one explicit approval or rejection list');
  const selectedIds = approveIds.length ? approveIds : rejectIds;
  if (selectedIds.some(id => typeof id !== 'string' || !idPattern.test(id)) || new Set(selectedIds).size !== selectedIds.length) throw new Error('Invalid or duplicate selected ID');
  if (typeof reviewedAt !== 'string' || !Number.isFinite(Date.parse(reviewedAt))) throw new Error('Invalid review timestamp');
  const clean = validateRows(rows), known = new Set(clean.map(row => row.id));
  for (const id of selectedIds) if (!known.has(id)) throw new Error(`Unknown selected ID: ${id}`);
  const selected = new Set(selectedIds);
  const result = clean.map(row => selected.has(row.id) ? {
    ...row, reviewStatus: approveIds.length ? 'approved' : 'rejected', reviewedAt,
    reviewedBy: 'local-owner', reviewMethod: 'explicit-id-selection',
  } : row);
  // Existing approved cases can reveal conflicts, but cannot authorize fixture export.
  checkConflicts(result.filter(row => row.reviewStatus === 'approved'));
  return result;
}

export function createFixtures(reviewedRows, explicitlyApprovedIds) {
  if (!Array.isArray(explicitlyApprovedIds) || !explicitlyApprovedIds.length || new Set(explicitlyApprovedIds).size !== explicitlyApprovedIds.length) throw new Error('Fixture export requires explicitly approved IDs');
  validateRows(reviewedRows);
  const byId = new Map(reviewedRows.map(row => [row.id, row]));
  const selected = explicitlyApprovedIds.map(id => {
    const row = byId.get(id);
    if (!row || row.reviewStatus !== 'approved' || row.reviewMethod !== 'explicit-id-selection' || typeof row.reviewedAt !== 'string' || !Number.isFinite(Date.parse(row.reviewedAt))) throw new Error(`Case was not explicitly approved in this review: ${id}`);
    return row;
  });
  checkConflicts(selected);
  return selected.map(row => {
    const label = effectiveLabel(row), expectedClassification = terminalLabels.has(label) ? label : 'report';
    return {
      id: row.id, text: row.text, group: topics[label], label: row.label,
      ...(row.routingSchema === 'purpose-v1' && {routingSchema:row.routingSchema,expectedRoute:label==='clarify'?null:label,needsClarification:row.needsClarification??null}),
      ...(row.routeLabel !== undefined && { routeLabel: row.routeLabel }),
      expectedClassification, allowedTopics: [topics[label]], ambiguous: false,
      ...(correction(row) !== undefined && { expectedCorrectedText: correction(row) }),
      ...(row.note !== undefined && { note: row.note }),
      reviewStatus: 'approved', labelStatus: 'human-reviewed', reviewedAt: row.reviewedAt,
      reviewedBy: row.reviewedBy, reviewMethod: row.reviewMethod, source: 'manual-rules-review',
    };
  });
}

const jsonl = rows => rows.length ? `${rows.map(row => JSON.stringify(row)).join('\n')}\n` : '';
const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

export function runCli(args = process.argv.slice(2)) {
  const options = new Map(), allowed = new Set(['--input', '--output', '--approve-ids', '--reject-ids', '--fixtures-output']);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!allowed.has(key) || options.has(key) || typeof value !== 'string' || !value.trim() || value.startsWith('--')) throw new Error(usage);
    options.set(key, value);
  }
  if (!options.has('--input') || !options.has('--output') || (options.has('--approve-ids') === options.has('--reject-ids'))) throw new Error(usage);
  if (options.has('--fixtures-output') && !options.has('--approve-ids')) throw new Error('Fixture export requires --approve-ids; rejected cases are not an evaluation standard');
  const input = path.resolve(options.get('--input'));
  const approveIds = options.has('--approve-ids') ? parseIds(options.get('--approve-ids')) : [];
  const rejectIds = options.has('--reject-ids') ? parseIds(options.get('--reject-ids')) : [];
  const rows = reviewCases(parseJsonl(fs.readFileSync(input, 'utf8')), { approveIds, rejectIds });
  const fixtures = options.has('--fixtures-output') ? createFixtures(rows, approveIds) : [];
  const outputs = [{ path: path.resolve(options.get('--output')), body: jsonl(rows) }];
  if (options.has('--fixtures-output')) outputs.push({ path: path.resolve(options.get('--fixtures-output')), body: jsonl(fixtures) });
  for (const [index, output] of outputs.entries()) {
    if (samePath(input, output.path) || outputs.some((other, otherIndex) => otherIndex !== index && samePath(output.path, other.path))) throw new Error('Input, catalog and fixture paths must be different');
    if (fs.existsSync(output.path)) throw new Error('Choose new output files; existing files are never overwritten');
  }
  const created = [];
  try {
    // Reserve both destinations before writing either, so a conflict leaves no partial catalog.
    for (const output of outputs) created.push({ ...output, fd: fs.openSync(output.path, 'wx') });
    for (const output of created) fs.writeFileSync(output.fd, output.body, 'utf8');
  } catch (error) {
    for (const output of created) {
      fs.closeSync(output.fd);
      fs.unlinkSync(output.path); // Only files created by this invocation, never recursive.
    }
    throw error;
  }
  for (const output of created) fs.closeSync(output.fd);
  return { approved: approveIds.length, rejected: rejectIds.length, retained: rows.length, fixtures: fixtures.length };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const counts = runCli();
    console.log(`Rules review: approved ${counts.approved}, rejected ${counts.rejected}; catalog ${counts.retained}, fixtures ${counts.fixtures}. Production rules unchanged.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Rules review failed');
    process.exitCode = 1;
  }
}
