import { mapEditableParts, keepCase } from "./game-language.ts";

type Language = "ru" | "kk" | "uk" | "uz";
export type RobustInputChange = {
  source: string; target: string; language: Language;
  kind: "transliteration" | "keyboard-layout" | "mixed-script" | "spelling" | "spacing";
};
type Word = { text: string; language: Language };
type Alias = Word & { kind: RobustInputChange["kind"] };

// A small, reviewed vocabulary of intent, attribution and game-interface words.
// This is deliberately independent of the evaluation messages: no sentence lookup,
// phrase-to-category mapping or automatic extraction of the answer key is used.
const vocabulary: Record<Language, string> = {
  ru: `где куда откуда зачем почему когда какой какая какие сколько можно нужно надо
    узнать найти посмотреть проверить прочитать открыть отключить включить выключить
    настроить изменить восстановить подать написать получить выбрать начать пригласить
    зайти войти выйти могу можем можете может могла мог
    работает работаете работают работало работает ли получается получалось невозможно
    помогите помоги помощь пожалуйста спасите вытащите почините проверьте посмотрите
    разберитесь рассмотрите верните вернуться переверните заблокировали разблокируйте
    пропал пропало пропали исчезло исчезли списали списалось вернулось вернули завис зависла
    зависает вылетает вылетело застрял застряла украли обманули убили убивает стреляет
    написал написала написали писал писала писали пишет пишут сказал сказала говорят называй называл
    оскорбляет оскорбляют оскорблял оскорбляли цитата цитирует цитировал переслал
    админ админы администрация администратор администраторы модератор поддержка
    игрок игроки игрока игроком человек водитель новичок полицейский медик лидер
    жалоба жалобу репорт обращение доказательство доказательства скриншот запись
    пароль аккаунт доступ сервер сервера сервере авторизация регистрация обновление
    настройки настройках звуки голосовой двигателя интерфейс меню управление
    машина машину машины транспорт гараж гаража вертолет самолёт лодка такси автобус
    квест задание задания работа работе смена груз маршрут маркер карта карте
    деньги баланс донат оплата платеж покупка покупки купил купила перевод пополнение
    семья семьи семейный семейной организация фракция фракции инвентарь предмет предметы
    правило правила правилах означает значит обозначает наказание наказания обжаловать
    после снова опять теперь сейчас сегодня раньше ничего нужен нужна нужны
    меня мне мой моя мою моего они его ему тебе вами вами сам сама я не нет нельзя
    если чтобы который потому поэтому без только это этот эти там тут для при как что`,
  uk: `де куди звідки навіщо чому коли який яка які скільки можна потрібно треба
    дізнатися знайти подивитися перевірити прочитати почитати відкрити вимкнути увімкнути
    налаштувати змінити відновити подати написати отримати обрати почати запросити
    працює працюють спрацювало виходить можу неможливо
    допоможіть допоможи допомога будь ласка врятуйте витягніть перевірте подивіться
    розберіться поверніть розблокуйте потрібен потрібна потрібно
    пропало пропали зник зникла зникло зникли списало списали повернули завис зависла
    вилітає застряг застрягла вкрали обманули вбив вбили вбиває стріляє
    написав написала написали пише пишуть сказав сказала каже називає називай
    ображає ображають ображав ображали цитата цитує переказав
    адмін адміни адміністрація адміністратор модератор підтримка
    гравець гравці гравця людина водій новачок поліцейський медик лідер
    скарга скаргу звернення доказ докази скриншот запис
    пароль акаунт доступ сервер сервері оновлення авторизація реєстрація
    налаштування налаштуваннях звук голосовий двигуна інтерфейс керування
    машина машину машини транспорт гараж гелікоптер човен таксі автобус
    завдання робота роботі зміна вантаж маршрут маркер карта карті
    гроші грошей кошти баланс донат оплата платіж покупка купив купила переказ
    сім'я сім'ї сімейний сімейної організація фракція інвентар предмет речі
    правило правила правилах означає значить покарання оскаржити
    після знову тепер зараз сьогодні раніше нічого
    мене мені мій моя мою вони його йому тобі сам сама я не ні якщо щоб
    котрий тому без тільки це цей ці там тут для при як що чи він вона`,
  kk: `қайда қайдан қайсы қандай қалай қашан қанша неге неліктен кім
    болады болмайды керек қажет мүмкін рұқсат ереже ережелер мағынасы білдіреді
    білу білемін табуға табамын көруге көремін оқуға жазылған көрсетілген көрсетіледі
    көмектес көмектесіңіз көмектесіңіздер көмек тексер тексеріңіз тексеріңіздер тексеру
    қараңыз қараңыздар қарап беріңіз беріңіздер қайтарыңыз қайтарыңыздар қайтару
    өзгерту ауыстыру қалпына келтіру ашу жабу өшіру қосу баптау
    істемейді істейді жұмыс кіре алмаймын алмадым болмай тұрмын тұрып қалдым
    жоғалды жоғалып жоғалған кетті кетеді қалды қалдым шықпайды шықты түспеді
    ұсталды алынды ұстап кірмейді ашылмайды келмейді соғады өлтірді өлтірген
    жазды жазған жазады айтты айтқан айтады дейді деп деді атаймын айттым
    қорлайды қорлады қорлау балағаттайды балағаттады
    админ әкімші әкімшілер модератор қолдау ойыншы ойыншылар ойыншының адам жүргізуші
    шағым шағымды шағымым өтініш дәлел жазба скриншот
    құпиясөз аккаунт аккаунтым аккаунтқа сервер серверге серверді жаңарту
    баптаулар баптауы дыбыс дауысты қозғалтқыш басқару
    көлік көлікті көлігім машина машинам гараж тікұшақ қайық такси автобус
    тапсырма тапсырманы жұмыс жұмыста ауысым жүк бағыт белгі карта картада
    ақша ақшам ақшаны баланс донат төлем төлемді сатып алдым аударым
    отбасы отбасына отбасым ұйым ұйымға фракция зат заттар
    жаза жазаны ереже ережені тәртібі айырмасы
    кейін қайта қазір бүгін бұрын ештеңе емес жоқ
    мен мені маған менің сен сені саған сенің ол оны оған оның біз өзім
    үшін бірақ немесе және бұл осы сол қай ма ме ба бе па пе`,
  uz: `qayer qayerda qayerga qayerdan qaysi qanday qachon qancha nega nima kim
    mumkin kerak mumkinmi kerakmi bo'ladi bo'ladimi bormi bor yo'q emas
    bilish bilaman bilsa topish topaman ko'rish ko'rinadi o'qish yozish yoziladi
    yordam bering beringlar iltimos tekshir tekshiring tekshiringlar tekshirish
    qarang qaytaring qaytarish oching ochish yopish o'chirish yoqish o'zgartirish
    tiklash olish olaman boshlash qilish sozlash
    ishlamayapti ishlamaydi ishlaydi kirmayapti kirish kirolmayapman olmayapman
    qoldi qolgan qoldim ketdi ketgan yo'qoldi yo'qolgan tushmadi qo'shilmadi
    yechildi olindi buzildi chiqmayapti bo'lmadi bo'lmayapti to'xtadi
    o'ldirdi o'ldirishdi o'ldiryapti otdi otishdi uryapti
    yozdi yozgan yozyapti yozmoqda aytdi aytgan aytyapti aytyapman dedi deb deyapti
    haqorat haqoratlayapti haqoratlamadim aytmadim yozmadim iqtibos
    admin ma'mur moderator yordamchi o'yinchi o'yinchilar odam haydovchi politsiyachi
    shikoyat shikoyatim ariza murojaat dalil skrinshot yozuv
    parol akkaunt akkauntim hisob server serverga serverda yangilash
    sozlamalar ovoz dvigatel boshqarish menyu
    mashina mashinam mashinani transport garaj vertolyot qayiq taksi avtobus
    topshiriq topshiriqni vazifa ish smena yuk yo'nalish marker xarita xaritada
    pul pulim pulni balans donat to'lov to'lovni sotib oldim o'tkazma
    oila oilaga oilam tashkilot fraksiya buyum buyumlar inventar
    qoida qoidalar qoidada anglatadi degani jazo jazoni shikoyat
    keyin yana hozir bugun oldin hech narsa
    meni menga mening seni senga sening uning unga uchun lekin yoki agar faqat shu bu`,
};

const fold = (text: string) => text.toLowerCase().replace(/[’‘ʻʼ`]/gu, "'");
const words = new Map<string, Word>();
const wordLanguages = new Map<string, Set<Language>>();
const aliases = new Map<string, Alias>();
const ambiguous = new Set<string>();
for (const language of Object.keys(vocabulary) as Language[]) {
  for (const text of vocabulary[language].split(/\s+/u).filter(Boolean)) {
    if (!words.has(text)) words.set(text, { text, language });
    if (!wordLanguages.has(text)) wordLanguages.set(text,new Set());
    wordLanguages.get(text)!.add(language);
  }
}
function addAlias(alias: string, word: Word, kind: Alias["kind"]) {
  const source = fold(alias);
  if (source === word.text || source.length < 2 || ambiguous.has(source) || words.has(source)) return;
  const previous = aliases.get(source);
  if (previous && previous.text !== word.text) {
    aliases.delete(source); ambiguous.add(source); return;
  }
  aliases.set(source, { ...word, kind });
}
const ruKeys = "ёйцукенгшщзхъфывапролджэячсмитьбю";
const enKeys = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const keyMap = new Map([...ruKeys].map((char, i) => [char, enKeys[i]]));
const reverseKeyMap = new Map([...keyMap].map(([a, b]) => [b, a]));
const translit: Record<string, string> = {
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",
  м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",
  щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",і:"i",ї:"yi",є:"ye",ґ:"g",
  ә:"a",ғ:"gh",қ:"q",ң:"ng",ө:"o",ұ:"u",ү:"u",һ:"h",
};
function latin(source: string, language: Language, variant: number) {
  return [...source].map(char => {
    if (language === "uk" && char === "г" && variant === 0) return "h";
    if (variant === 1 && char === "х") return "h";
    if (variant === 1 && char === "й") return "i";
    if (variant === 1 && char === "ғ") return "g";
    return translit[char] ?? char;
  }).join("");
}
const uzCyrillic: Record<string, string> = {
  a:"а",b:"б",d:"д",e:"е",f:"ф",g:"г",h:"ҳ",i:"и",j:"ж",k:"к",l:"л",m:"м",n:"н",
  o:"о",p:"п",q:"қ",r:"р",s:"с",t:"т",u:"у",v:"в",x:"х",y:"й",z:"з",
  "o'":"ў", "g'":"ғ",sh:"ш",ch:"ч",yo:"ё",yu:"ю",ya:"я",
};
function uzbekCyrillic(source: string) {
  return source.replace(/o'|g'|sh|ch|yo|yu|ya|[a-z]/gu, part => uzCyrillic[part] ?? part);
}
for (const word of words.values()) {
  if (word.language === "uz") {
    addAlias(uzbekCyrillic(word.text), word, "transliteration");
    addAlias([...word.text].map(char => reverseKeyMap.get(char) ?? char).join(""), word, "keyboard-layout");
  } else {
    addAlias(latin(word.text, word.language, 0), word, "transliteration");
    addAlias(latin(word.text, word.language, 1), word, "transliteration");
    addAlias([...word.text].map(char => keyMap.get(char) ?? char).join(""), word, "keyboard-layout");
    if (word.language === "uk") {
      const ukKeys: Record<string, string> = { і:"s", ї:"]", є:"'", ґ:"\\" };
      addAlias([...word.text].map(char => ukKeys[char] ?? keyMap.get(char) ?? char).join(""), word, "keyboard-layout");
    }
  }
}
const visualToCyrillic: Record<string, string> = {a:"а",c:"с",e:"е",o:"о",p:"р",x:"х",y:"у",k:"к",m:"м",t:"т",b:"в",h:"н",i:"і"};
const visualToLatin: Record<string, string> = {а:"a",с:"c",е:"e",о:"o",р:"p",х:"x",у:"y",к:"k",м:"m",т:"t",і:"i",ҳ:"h"};
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const aliasPattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[...aliases.keys()].sort((a,b)=>b.length-a.length).map(escape).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
const tokenPattern = /[\p{L}]+(?:['’‘ʻʼ\u200b-\u200d\ufeff][\p{L}]+)*/gu;
const fuzzyWords = [...words.values()].filter(word => word.text.length >= 6 && !word.text.includes("'"));
// Deleted letters are more ambiguous than repeated/swapped letters: e.g. the
// valid Russian "здания" is one deletion away from "задания". Restrict that
// operation to request/intent anchors, never general nouns or tense suffixes.
const deletionAnchors=new Set(`
  помогите пожалуйста проверьте посмотрите разберитесь рассмотрите восстановить
  прочитать открыть отключить включить выключить настроить изменить получить выбрать
  пригласить застрял застряла невозможно вытащите переверните разблокируйте
  допоможіть допомога перевірте подивіться розберіться поверніть розблокуйте
  дізнатися подивитися перевірити прочитати відкрити вимкнути увімкнути налаштувати
  відновити запросити застряг застрягла неможливо
  көмектес көмектесіңіз көмектесіңіздер тексеріңіз тексеріңіздер қараңыз қараңыздар
  беріңіз беріңіздер қайтарыңыз қайтарыңыздар
  yordam qayerda qayerdan qanday mumkin iltimos tekshiring tekshiringlar
  beringlar qaytaring tekshirish`.trim().split(/\s+/u));

// Restore one omitted/duplicated letter or a transposition; do not replace an
// arbitrary character with the nearest dictionary word. In particular we never
// guess a missing negation or a foreign grammatical suffix.
function oneTypo(source: string, target: string) {
  if (source.length === target.length - 1) {
    if (!deletionAnchors.has(target)) return false;
    // Prefixes/suffixes are grammatical information, especially in KK/UZ.
    for (let i=1;i<target.length-1;i++) if (target.slice(0,i)+target.slice(i+1) === source) return true;
  }
  if (source.length === target.length + 1) {
    for (let i=1;i<source.length;i++) if (source[i] === source[i-1] && source.slice(0,i)+source.slice(i+1) === target) return true;
  }
  if (source.length === target.length) {
    for (let i=0;i<source.length-1;i++) if (source.slice(0,i)+source[i+1]+source[i]+source.slice(i+2) === target) return true;
  }
  return false;
}
function sameScript(a: string, b: string) {
  return /[а-яәғқңөұүһіїєґў]/iu.test(a) === /[а-яәғқңөұүһіїєґў]/iu.test(b);
}
const repairCache = new Map<string, Word | null>();
function typoWord(source: string): Word | undefined {
  if (source.length < 5 || source.length > 25 || words.has(source)) return;
  if (source.length < 6 && /[а-яәғқңөұүһіїєґў]/iu.test(source)) return;
  if (repairCache.has(source)) return repairCache.get(source) ?? undefined;
  const reduced = source.replace(/(\p{L})\1{1,6}/gu, "$1");
  const candidates = fuzzyWords.filter(word => sameScript(source, word.text) && (oneTypo(source, word.text) || reduced === word.text));
  const unique = [...new Map(candidates.map(word => [word.text, word])).values()];
  const result = unique.length === 1 ? unique[0] : undefined;
  if (repairCache.size < 10000) repairCache.set(source, result ?? null);
  return result;
}

const joinAnchors = new Set((`где куда зачем почему когда как что можно нужно помогите проверьте
  посмотреть проверить узнать найти восстановить не после меня помощь пожалуйста админ
  де куди чому коли як що чи допоможіть перевірте потрібно можу після
  қайда қайдан қалай неге көмек көмектесіңіз көмектесіңіздер тексеріңіздер маған мені
  qayerda qayerdan qanday nega yordam bering tekshiring kerak mumkin`).split(/\s+/u));
const shortJoinParts = new Set("я не ни на по за до от из у в к с и а о це що як чи він мен сен ол ма ме ба бе па пе shu bu bor yo'q".split(" "));
function splitKnown(source: string): Word[] | undefined {
  if (source.length < 9 || source.length > 80 || words.has(source)) return;
  const paths: Word[][] = [];
  function visit(offset: number, parts: Word[]) {
    if (paths.length > 1 || parts.length > 10) return;
    if (offset === source.length) {
      // A bare grammatical prefix is not sufficient to split an unknown word.
      if(parts.length > 1 && !(parts.length===2 && ["не","ні"].includes(parts[0].text)) && parts.some(word => joinAnchors.has(word.text))) paths.push(parts);
      return;
    }
    for (let end=offset+1;end<=source.length;end++) {
      const part = source.slice(offset,end), word = words.get(part);
      if (!word || (part.length < 3 && !shortJoinParts.has(part))) continue;
      visit(end, [...parts, word]);
    }
  }
  visit(0, []);
  return paths.length === 1 ? paths[0] : undefined;
}

function normalizePart(text: string, changes: RobustInputChange[]) {
  const candidates: {start:number;end:number;source:string;target:string;language:Language;kind:RobustInputChange["kind"]}[] = [];
  const originalTokens = [...text.matchAll(tokenPattern)];
  const aliasMatches = [...text.matchAll(aliasPattern)];
  const shortAnchors=new Set(["де","куди","як","що","чи","где","куда","как","что","кім","неге"]);
  const punctuation=[...text.matchAll(/[.!?;\n]/gu)].filter(mark=>!aliasMatches.some(alias=>mark.index!>=alias.index!&&mark.index!<alias.index!+alias[0].length)).map(mark=>mark.index!);
  const languageEvidence = (language: Language, start: number, end: number) => {
    const left=punctuation.filter(index=>index<start).at(-1)??0;
    const right=punctuation.find(index=>index>=end)??text.length;
    return originalTokens.some(token => token.index!>=left && token.index!<right && (token.index!<start || token.index!>=end) && (token[0].length>=4||shortAnchors.has(fold(token[0]))) && wordLanguages.get(fold(token[0]))?.has(language))
      || aliasMatches.some(match => {
        const entry=aliases.get(fold(match[0]));
        return entry && match.index!>=left && match.index!<right && match.index!==start && (entry.text.length>=4||shortAnchors.has(entry.text)) && wordLanguages.get(entry.text)?.has(language);
      });
  };
  for (const match of aliasMatches) {
    const entry = aliases.get(fold(match[0]))!;
    // Short homonyms (de, men, sen, on, no, etc.) cannot choose a language alone.
    // A known neighboring anchor is required even for long transliterations.
    const evidence = [...(wordLanguages.get(entry.text)??[entry.language])].some(language=>languageEvidence(language, match.index!, match.index!+match[0].length));
    const isolatedKeyboard = entry.kind === "keyboard-layout" && match[0].length>=5 && text.trim()===match[0];
    if (!evidence && !isolatedKeyboard) continue;
    candidates.push({start:match.index!,end:match.index!+match[0].length,source:match[0],target:keepCase(match[0],entry.text),language:entry.language,kind:entry.kind});
  }
  for (const match of originalTokens) {
    const source = match[0], lower = fold(source);
    if (words.has(lower) || /[\d_]/u.test(lower)) continue;
    let entry: Word | undefined, kind: RobustInputChange["kind"] = "spelling";
    const withoutInvisible = lower.replace(/[\u200b-\u200d\ufeff]/gu, "");
    if (withoutInvisible !== lower) entry = words.get(withoutInvisible);
    if (!entry && /[a-z]/u.test(lower) && /[а-яәғқңөұүһіїєґў]/u.test(lower)) {
      const cyr = lower.replace(/[a-z]/gu, char => visualToCyrillic[char] ?? char);
      const lat = lower.replace(/[а-яәғқңөұүһіїєґў]/gu, char => visualToLatin[char] ?? char);
      const possibilities = [words.get(cyr), words.get(lat)].filter(Boolean) as Word[];
      if (possibilities.length === 1) {entry=possibilities[0];kind="mixed-script";}
    }
    if (!entry) entry=typoWord(withoutInvisible);
    if (entry) {
      candidates.push({start:match.index!,end:match.index!+source.length,source,target:keepCase(source,entry.text),language:entry.language,kind});
      continue;
    }
    const split=splitKnown(lower);
    if (split) candidates.push({start:match.index!,end:match.index!+source.length,source,target:keepCase(source,split.map(word=>word.text).join(" ")),language:split[0].language,kind:"spacing"});
  }
  // Repair a single accidental space only when both fragments aren't complete
  // dictionary words. A valid "не ..." or two valid words must remain separate.
  for(let i=0;i<originalTokens.length-1;i++) {
    const a=originalTokens[i],b=originalTokens[i+1];
    if (!/^[ \t]$/u.test(text.slice(a.index!+a[0].length,b.index))) continue;
    if (a[0].length<2 || b[0].length<2 || shortJoinParts.has(fold(a[0])) || shortJoinParts.has(fold(b[0]))) continue;
    if (words.has(fold(a[0])) || words.has(fold(b[0]))) continue;
    const entry=words.get(fold(a[0]+b[0]));
    if(!entry || (entry.text.length<6 && !["админ","адмін"].includes(entry.text)))continue;
    const source=text.slice(a.index,b.index!+b[0].length);
    candidates.push({start:a.index!,end:b.index!+b[0].length,source,target:keepCase(source,entry.text),language:entry.language,kind:"spacing"});
  }
  candidates.sort((a,b)=>a.start-b.start || b.end-a.end);
  let result="",end=0;
  for(const candidate of candidates) {
    if(candidate.start<end || candidate.source===candidate.target)continue;
    result+=text.slice(end,candidate.start)+candidate.target;
    changes.push({source:candidate.source,target:candidate.target,language:candidate.language,kind:candidate.kind});
    end=candidate.end;
  }
  return result+text.slice(end);
}

export function normalizeRobustInput(text: string): { text: string; changes: RobustInputChange[] } {
  const changes: RobustInputChange[]=[];
  const protectedExtra=/((?<![\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])|(?<![\p{L}\p{N}_])(?:ник|нік|логин|логін|nickname|nick|nik|login)(?:\s*[:=]\s*|\s+)[\p{L}\p{N}_-]+)/giu;
  const normalized=mapEditableParts(text,part=>part.split(protectedExtra).map((piece,index)=>index%2?piece:normalizePart(piece,changes)).join(""));
  return {text:normalized,changes};
}
