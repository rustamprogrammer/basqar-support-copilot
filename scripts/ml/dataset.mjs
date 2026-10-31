import { createHash } from 'node:crypto';
export const textKey = text => text.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const textHash = text => createHash('sha256').update(textKey(text)).digest('hex');
export const labels = new Set(['appeal','administration','player','help','question','property','payment','unknown']);
export function validateDataset(rows, allowProvisional = false, heldoutHashes = new Set()) {
  const seen = new Map(), selected = [], ids = new Set();
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) throw new Error('Missing or duplicate example id');
    ids.add(row.id);
    if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > 2000) throw new Error(`Invalid text: ${row.id}`);
    if (!['train','validation','test'].includes(row.split)) throw new Error(`Invalid split: ${row.id}`);
    const key = textHash(row.text), prior = seen.get(key);
    if(row.split !== 'test' && heldoutHashes.has(key)) throw new Error(`Protected test example cannot be used for training: ${row.id}`);
    if (prior && (prior.split !== row.split || prior.label !== row.label)) throw new Error(`Duplicate text crosses splits or has conflicting labels: ${row.id}`);
    seen.set(key, row);
    if (row.split === 'test') continue;
    if (!labels.has(row.label)) throw new Error(`Unknown label: ${row.id}`);
    if (row.reviewStatus !== 'approved' && !(allowProvisional && row.reviewStatus === 'provisional')) continue;
    if (!prior) selected.push(row);
  }
  return selected;
}
