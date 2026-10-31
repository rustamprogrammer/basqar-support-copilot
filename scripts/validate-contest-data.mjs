import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseTicket, CATEGORIES } from '../lib/triage/types.ts';

const directory = new URL('../evaluation/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('contest-data-manifest.json', directory), 'utf8'));
const languages = ['ru', 'kk', 'uz', 'en', 'es', 'pt'];
const priorities = ['p0', 'p1', 'p2', 'p3'];
const ids = new Set(), families = new Set(), texts = new Set();
const summaries = [];
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const regression = (await readFile(new URL('triage-regression.jsonl', directory), 'utf8')).trim().split(/\r?\n/u).map(JSON.parse);
const regressionTexts = new Set(regression.map(row => normalize(row.ticket.messages.filter(message => message.role === 'player').map(message => message.text).join(' '))));

for (const [split, definition] of Object.entries(manifest.files)) {
  const raw = (await readFile(new URL(definition.file, directory), 'utf8')).replace(/\r\n/gu, '\n');
  const digest = createHash('sha256').update(raw).digest('hex');
  if (digest !== definition.sha256Lf) throw new Error(`${split}: frozen dataset checksum changed; review and version labels explicitly.`);
  const rows = raw.trim().split('\n').map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${split}:${index + 1}: invalid JSON.`); }
  });
  if (rows.length !== definition.rows) throw new Error(`${split}: expected ${definition.rows} rows.`);
  const counts = { languages: {}, categories: {}, priorities: {} };
  for (const row of rows) {
    if (typeof row.id !== 'string' || ids.has(row.id)) throw new Error(`${split}: missing or duplicate ID.`);
    if (typeof row.scenario_id !== 'string' || families.has(row.scenario_id)) throw new Error(`${row.id}: missing or repeated scenario family.`);
    ids.add(row.id); families.add(row.scenario_id);
    const ticket = parseTicket(row.ticket), expected = row.expected;
    if (!expected || !languages.includes(expected.lang) || !CATEGORIES.includes(expected.category) || !priorities.includes(expected.priority) || expected.needs_human !== true) throw new Error(`${row.id}: invalid expected labels.`);
    if (!expected.category.startsWith(`${ticket.kind}.`)) throw new Error(`${row.id}: category does not match input channel.`);
    if (['verdict', 'punishment', 'violation', 'expected'].some(key => key in row.ticket)) throw new Error(`${row.id}: retrospective labels in model input.`);
    const text = normalize(ticket.messages.filter(message => message.role === 'player').map(message => message.text).join(' '));
    if (texts.has(text) || regressionTexts.has(text)) throw new Error(`${row.id}: repeated text or exact overlap with the old regression fixture.`);
    texts.add(text);
    for (const [group, value] of [[counts.languages, expected.lang], [counts.categories, expected.category], [counts.priorities, expected.priority]]) group[value] = (group[value] ?? 0) + 1;
  }
  if (languages.some(lang => counts.languages[lang] !== rows.length / languages.length)) throw new Error(`${split}: unbalanced languages.`);
  if (CATEGORIES.some(category => !counts.categories[category]) || priorities.some(priority => !counts.priorities[priority])) throw new Error(`${split}: missing category or priority coverage.`);
  summaries.push({ split, rows: rows.length, sha256Lf: digest, ...counts });
}
console.log(JSON.stringify({ valid: true, labelStatus: manifest.labelStatus, humanReviewed: false, nativeSpeakerReviewed: false, apiCalls: 0, inferenceCalls: 0, splits: summaries }, null, 2));
