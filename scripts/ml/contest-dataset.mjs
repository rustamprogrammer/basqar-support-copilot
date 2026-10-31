import { createHash } from 'node:crypto';
import { textHash } from './dataset.mjs';

const categoryLabels = {
  'complaint.insult': 'player', 'complaint.cheat': 'player', 'complaint.dm': 'player',
  'complaint.scam': 'player', 'complaint.rmt_ads': 'player', 'complaint.admin': 'administration',
  'complaint.other': 'player', 'complaint.invalid': 'unknown', 'report.question': 'question',
  'report.help': 'help', 'report.complaint': 'player', 'report.account': 'property',
  'report.payment': 'payment', 'report.offtopic': 'unknown',
};

export function contestExample(row, index) {
  const category = row.expected?.category;
  if (!(category in categoryLabels)) throw new Error(`Record ${index + 1}: expected a labelled contest category.`);
  const messages = row.ticket?.messages;
  if (!Array.isArray(messages)) throw new Error(`Record ${index + 1}: missing ticket messages.`);
  // Never learn from historical admin answers, verdicts or punishments.
  const text = messages.filter(message => message.role === 'player').map(message => message.text).join('\n');
  if (!text.trim() || text.length > 2000) throw new Error(`Record ${index + 1}: need 1–2000 player characters.`);
  const id = row.id ?? row.ticket.ticket_id ?? `contest-${index + 1}`;
  const family = row.family ?? row.family_id ?? row.scenario_id ?? id;
  if (typeof id !== 'string' || typeof family !== 'string') throw new Error(`Record ${index + 1}: invalid ID or family.`);
  return { id, family, text, label: categoryLabels[category], category, reviewStatus: 'provisional' };
}

export function prepareContestDataset(training, protectedHoldout) {
  const rows = training.map(contestExample), heldout = protectedHoldout.map(contestExample);
  const protectedHashes = new Set(heldout.map(row => textHash(row.text)));
  const protectedFamilies = new Set(heldout.map(row => row.family));
  const families = new Map();
  for (const row of rows) {
    if (protectedHashes.has(textHash(row.text)) || protectedFamilies.has(row.family)) throw new Error(`Training overlaps protected holdout: ${row.id}`);
    const group = families.get(row.family) ?? [];
    group.push(row); families.set(row.family, group);
  }
  // Stable group split; all translations/variants of a family move together.
  // This split uses training identities only, never holdout performance.
  const groups = [...families.keys()].sort((a, b) => {
    const hash = value => createHash('sha256').update(`contest-local-v1:${value}`).digest('hex');
    return hash(a).localeCompare(hash(b));
  });
  const validationFamilies = new Set(groups.slice(0, Math.max(1, Math.ceil(groups.length * .25))));
  const prepared = rows.map(row => ({ ...row, split: validationFamilies.has(row.family) ? 'validation' : 'train' }));
  const train = prepared.filter(row => row.split === 'train'), validation = prepared.filter(row => row.split === 'validation');
  if (train.length < 20 || validation.length < 10) throw new Error('Need at least 20 training and 10 validation rows after splitting families. Supply more authored families.');
  if (new Set(train.map(row => row.label)).size < 3) throw new Error('Need at least three training labels.');
  return { prepared, heldout, counts: { train: train.length, validation: validation.length, holdout: heldout.length, trainingFamilies: families.size } };
}

// The contest admin category covers both actions and appeals; compare at that
// coarser level because the synthetic data does not independently label those.
export function comparableIntent(label) { return label === 'appeal' ? 'administration' : label; }
