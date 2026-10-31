import assert from "node:assert/strict";
import { test } from "node:test";
import { understandMessage } from "./message-understanding.ts";
import { processMessageWithTrace } from "./message-processing.ts";

// Independently written utterances, including noise and adversarial context.
// These test cases are not an estimate of accuracy on unseen player messages.
const complaints = [
  "meni sababsiz o'ldirdi", "mani besabab oldirdi", "meni be sabab uldrdi",
  "meni o‘ldirdi", "meni oʻldirdi", "meni oʼldirdi", "meni o’ldirdi",
  "sabab sz uldryabdi", "meni oldrdi iltimos chora korila",
  "u meni urdi", "meni urib ketdi", "меня otvordi возле больницы",
  "onadan so'kdi", "onadan sokdi", "он меня haqorat qildi",
  "meni kishanlab moshinaga solib olib ketdi va sokindi ham",
  "meni kishanladi", "kishan soldi bez rp", "kshan taqib qop kiydirdi",
  "meni arqon bilan boyladi без РП", "moshina bilan oldirdi",
  "меня mashina bilan o'ldirdi", "meni aldadi pulimni",
  "o'yinchi haqorat qilyapti", "meni tayzer bilan otdi", "Otyabdi sababsiz",
  "hech qanday sababsiz kishanlab qoydi", "men bilan gaplashib turgan vaqti otib tashladi",
  "мені себепсіз өлтірді", "мени себепсиз олтирди", "мені ұрып жатыр",
  "мени урып жатыр", "мені атып кетті", "маған себепсіз атты",
  "мені атты", "он мені кишан? кіcен емес, ұрды", "қолымды байлады",
  "колымды байлап тастады", "мені кісен салды", "мени кисен салды",
  "анамды боқтады", "анамды боктады", "мені балағаттап жатыр",
  "мені көлікпен қақты", "мени коликпен какты", "мені машинамен қақты",
  "мені алдап кетті",
  "меня oldirdi, потом мені боқтады", "он meni urdi возле ЗЗ",
  "мен далада наручнипен біреу тастап кетті",
  "меня взяли под стражу без объяснения", "взяли под стражу без причины",
  "сотрудник повязал своего в зз", "ЗЗ верёвка предупреждения варн",
  "верёвка на авторынке в зелёной зоне", "связка в зз",
  "он меня збил с машынои", "в зз завизал руки", "он просто задовил меня",
  "Помогите меня бьют возле больницы", "по нам открыли огонь",
  "оскорбляет меня за то что я узбек",
];
for (const input of complaints) test(`complaint: ${input}`, () => {
  const result = processMessageWithTrace(input);
  assert.equal(result.processing.topic, "Жалоба на игрока");
  assert.equal(result.status, "pending");
});

const otherTopics = [
  ["pulimni ogirladi", "Аккаунт и имущество"],
  ["ақшамды ұрлады", "Аккаунт и имущество"],
  ["акшамды урлады", "Аккаунт и имущество"],
  ["nega menga ban berdi", "Обжалование наказания"],
  ["menga warn berdi men noroziman", "Обжалование наказания"],
  ["бан rozi emasman", "Обжалование наказания"],
  ["неге маған бан берді", "Обжалование наказания"],
  ["банға келіспеймін", "Обжалование наказания"],
  ["мен келиспеймин", "Обжалование наказания"],
  ["nohaq blokirovka meni haqorat qildi", "Обжалование наказания"],
  ["adminga shikoyat meni urdi", "Действия администрации"],
  ["Прошу рассмотреть данное решение, стрелял не я один", "Обжалование наказания"],
  ["Администрация всё время следит за мной, но ничего не делают", "Действия администрации"],
  ["бан қайта қараңыз", "Обжалование наказания"],
  ["iltimos kirolmayapman в аккаунт", "Помощь в игре"],
  ["kira olmayapman", "Помощь в игре"],
  ["ishlamayapti кнопка", "Помощь в игре"],
  ["tiqilib qoldim", "Помощь в игре"],
  ["көмектесіңіз кіре алмаймын", "Помощь в игре"],
  ["комектесиниз киреалмаймын", "Помощь в игре"],
  ["кнопка жұмыс істемейді", "Помощь в игре"],
  ["турып калдым", "Помощь в игре"],
  ["ДМ nima degani", "Вопрос по игре"],
  ["НРП мумкин? Что значит НРП", "Вопрос по игре"],
  ["в ЗЗ связывать mumkinmi", "Вопрос по игре"],
  ["ЗЗ ішінде байлауға бола ма", "Вопрос по игре"],
  ["имеет ли право полицейский связывать в ЗЗ", "Вопрос по игре"],
];
for (const [input, topic] of otherTopics) test(`intent: ${input}`, () => {
  assert.equal(processMessageWithTrace(input).processing.topic, topic);
});

const uncertain = [
  "men o'ldirmadim", "oldirmadim", "uldirmadi", "men urmadim",
  "men otmadim", "onadan so'kmadim", "onadan sokmadim", "men sokinmadim",
  "mani so'kti deyapti so'kinmasamxam",
  "мен өлтірмедім", "мен олтирмедим", "мен атпадым", "мен урмадым",
  "мен боқтамадым", "мен боктамадым", "ол өлтірген жоқпын",
  "onadan so'kmadim ДМ", "не бьют в ЗЗ", "меня не связывали в ЗЗ",
  "Узбекистан", "я узбек", "узбекский язык", "я казах", "қазақ тілі",
  "Men", "man", "мені", "атты кітап",
  "men xqzyr", "Alex_oldirdi", "«meni oldirdi»", '"мені өлтірді"',
  "https://example.com/oldirdi", "`oldirdi`", "/warn 123", "ПП на КВ",
];
for (const input of uncertain) test(`do not invent a complaint: ${input}`, () => {
  assert.equal(processMessageWithTrace(input).processing.classification, "clarify");
});
for (const input of ["yordam", "көмек"]) test(`translated request keeps help with details: ${input}`, () => {
  const result = processMessageWithTrace(input);
  assert.equal(result.processing.route, "help");
  assert.equal(result.processing.needsClarification, true);
});

test("word/phrase analysis retains evidence, unknown tokens and negation", () => {
  const source = 'Alex_oldirdi 123 /warn «meni oldirdi» <url> meni sababsiz urdi xqzyr';
  const analysis = understandMessage(source);
  assert.equal(analysis.text, 'Alex_oldirdi 123 /warn «meni oldirdi» <url> меня без причины ударил xqzyr');
  assert.deepEqual(analysis.translations.map(t => t.language), ['uz','uz','uz']);
  assert.equal(understandMessage('мен өлтірген жоқпын').text, 'я не убивал');
  assert.equal(understandMessage('men onadan so‘kmadim').text, 'я не оскорблял родню');
});

test("mixed languages are analyzed without replacing the author's message", () => {
  const original = 'меня oldirdi, потом мені боқтады в ЗЗ';
  const result = processMessageWithTrace(original);
  assert.equal(result.text, original);
  const stage = result.processing.steps.find(s => s.id === 'understood')!;
  assert.match(stage.value, /убил/);
  assert.match(stage.value, /оскорбил/);
  assert.match(stage.detail!, /узб\./);
  assert.match(stage.detail!, /каз\./);
  assert.match(stage.detail!, /ЗЗ — зелёная зона/);
  assert.ok(result.processing.steps.findIndex(s => s.id === 'understood') < result.processing.steps.findIndex(s => s.id === 'classified'));
});

test("game commands stay executable while display abbreviations remain short", () => {
  const result = processMessageWithTrace('DM /warn 123 в ЗЗ');
  assert.equal(result.text, 'ДМ /warn 123 в ЗЗ');
  assert.match(result.processing.steps.find(s=>s.id==='understood')!.value, /ЗЗ — зелёная зона/);
});
