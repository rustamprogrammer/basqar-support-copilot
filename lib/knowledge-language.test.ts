import test from 'node:test';
import assert from 'node:assert/strict';
import { processSupportMessage } from './support-processing.ts';
import { getKnowledgeDecision } from './knowledge-matching.ts';
import { KNOWLEDGE_ENTRIES } from './knowledge-base.ts';

for (const [text, id] of [
  ['Что такое ДМить?', 'dm'], ['ДМить — это что?', 'dm'],
  ['Как понимать слово «дмит»?', 'dm'], ['Что означает «дмят» в игровом чате?', 'dm'],
  ['А что значит дмить в игре?', 'dm'], ['Я новичок, объясните пожалуйста что значит ДМить', 'dm'],
  ['Объясни слово «дмить», я новичок', 'dm'], ['Не понимаю, что такое DMить?', 'dm'],
  ['што значет дмить??', 'dm'], ['чтотакоедмить', 'dm'], ['чтозначитдмить', 'dm'],
  ['что такое д м и т ь', 'dm'], ['chto takoe dmit?', 'dm'],
  ['Что такое ДБшить?', 'db'], ['А DBшить это что вообще значит?', 'db'],
  ['Объясните значение слова дбшить', 'db'], ['Что значит МГшить?', 'mg'],
  ['мгшить это как понять?', 'mg'], ['Что такое ПГшить?', 'pg'], ['Что значит СКшить?', 'sk'],
  ['Как расшифровать ткшил в игровом жаргоне?', 'tk'], ['Что значит РКшить?', 'rk'],
  ['Что такое РПшить?', 'rp'], ['Что такое флудить?', 'flood'], ['Что значит скамить?', 'scam'],
  ['Что такое багоюзить?', 'buguse'], ['Что означает читерить?', 'cheat'], ['Что такое афкшить?', 'afk'],
  ['Що означає дмити у грі?', 'dm'], ['Поясніть, будь ласка, що таке дбшити.', 'db'],
  ['Я новачок, що значить ПГшити?', 'pg'], ['ДМить деген не?', 'dm'],
  ['ДМ жасау деген не?', 'dm'], ['DM qilish nima degani?', 'dm'],
  ["Men yangi o'yinchiman, дбшить nima degani?", 'db'],
]) test(`whole glossary intent: ${text}`, () => {
  const result = processSupportMessage(text);
  assert.equal(result.processing.route, 'question');
  assert.equal(result.processing.needsClarification, false);
  assert.equal(result.processing.knowledge?.entryId, `faq-${id}`);
  assert.equal(result.processing.knowledge?.status, 'answered');
  assert.equal(result.processing.answerReadiness, 'ready');
  assert.ok(result.processing.steps.some(step => step.id === 'answer'));
});

for (const text of [
  'Меня дмят, помогите!', 'Что значит ДМить? Меня сейчас убивают', 'ДМить это что? Помогите мне!',
  'Что такое ДМить и ДБшить?', 'Что такое дмить и где купить дом?', 'Не дмить это что?',
  'Можно ли ДМить?', 'Где можно ДБшить?', 'Как правильно дмить?', 'За дмить бан?',
  'Что такое ДМить без причины?', 'Он написал что такое дмить', 'Он дмит, что делать?',
  'Что такое дмить, ID 17', 'Что такое дмить /report', 'Что такое дмить https://example.com',
  'Что такое дмитьxyz?', 'Что такое дмить725?', 'Что такое дмить, админ идиот',
  'Что такое ДМить? 🖕',
  'ДМить', 'DM', 'Что такое ДМить? Не отвечайте про ДМ',
  'Я новичок, что такое ДМить? Меня за это забанили',
  'Не понимаю, что значит дмить, помогите мне', 'Що означає дмити, мене вбивають',
  'ДМ жасау деген не, қазір көмектесіңіз', 'DM qilish nima degani, meni uryapti',
]) test(`no partial or incident autoanswer: ${text}`, () => {
  assert.notEqual(processSupportMessage(text).processing.knowledge?.status, 'answered');
});

const dm = KNOWLEDGE_ENTRIES.find(entry => entry.id === 'faq-dm')!;
test('old saved cards get query morphology without overwriting editorial state or answer', () => {
  const override = { ...dm, answer: 'Утверждённый администратором текст', aliases: ['дм'], version: 'saved-42' };
  const answer = getKnowledgeDecision('Что такое DMить?', 'question', [override]);
  assert.equal(answer.answer, override.answer);
  assert.equal(answer.entryVersion, override.version);
  for (const status of ['draft', 'retired'] as const) assert.equal(getKnowledgeDecision('Что такое ДМить?', 'question', [{ ...override, status }]).status, 'needs_admin');
  assert.equal(getKnowledgeDecision('Что такое ДМить?', 'question', [{ ...override, aliases: ['другой термин'] }]).status, 'needs_admin');
  assert.equal(getKnowledgeDecision('Что такое ДМить?', 'question', [{ ...override, excludedTerms: ['дмить'] }]).status, 'needs_admin');
  assert.equal(getKnowledgeDecision('Что такое ДМить?', 'question', [{ ...override, excludedTerms: ['дм'] }]).status, 'needs_admin');
  for (const text of ['Я новичок, что такое ДМить?', 'Что такое ДМить, я новичок?']) assert.equal(getKnowledgeDecision(text, 'question', [{ ...override, excludedTerms: ['новичок'] }]).status, 'needs_admin');
  assert.equal(getKnowledgeDecision('Не понимаю, что такое ДМить?', 'question', [{ ...override, excludedTerms: ['не понимаю'] }]).status, 'needs_admin');
  assert.equal(getKnowledgeDecision('Я новичок, что такое ДМить?', 'question', [{ ...override, requiredTerms: ['новичок'] }]).status, 'answered');
  assert.equal(getKnowledgeDecision('Что такое ДМить?', 'question', [{ ...override, requiredTerms: ['в игре'] }]).status, 'needs_admin');
  assert.equal(getKnowledgeDecision('Что такое ДМить?', 'question', [{ ...override, questionKind: 'permission' }]).status, 'needs_admin');
});

test('morphology cannot confuse neighbouring short codes or conflicting published cards', () => {
  assert.equal(getKnowledgeDecision('Что такое ДБшить?', 'question', [dm]).status, 'needs_admin');
  assert.equal(getKnowledgeDecision('Что такое ДМить?', 'question', [dm, { ...dm, id: 'conflicting' }]).status, 'needs_admin');
});
