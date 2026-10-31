import data from './corpus.local.json' with { type: 'json' };
import { validateCorpus } from './retrieval.ts';
export const ruleCorpus = validateCorpus(data);
