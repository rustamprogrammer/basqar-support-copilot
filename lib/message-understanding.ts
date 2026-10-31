import { atWord, contextText, mapEditableParts } from "./game-language.ts";
import { languageAliasKeys, translationKey, type SupportLanguage } from "./language-aliases.ts";
import { kazakhEntries } from "./language-lexicons/kk.ts";
import { uzbekEntries } from "./language-lexicons/uz.ts";
import { ukrainianEntries } from "./language-lexicons/uk.ts";

type Language = SupportLanguage;
type Entry = { language: Language; target: string; variants: string; ambiguous?: boolean };
const uz = (target: string, variants: string, ambiguous = false): Entry => ({ language: "uz", target, variants, ambiguous });
const kk = (target: string, variants: string, ambiguous = false): Entry => ({ language: "kk", target, variants, ambiguous });

// A bounded game-support lexicon, not a general translator. Longer phrases take priority.
// Positive and negative verb forms are listed separately: never strip arbitrary suffixes.
const entries: Entry[] = [
  uz("несправедливая блокировка", "noqonuniy bloklash|noqonuniy blokirovka"),
  uz("покажите доказательства", "dalil ko'rsating|dalil korsating|isbot ko'rsating|isbot korsating"),
  uz("дайте доказательства", "doki ber|doki bering|doki berilar|doki berila|doki beringlar|dalil bering|dalillarni bering|isbot bering"),
  uz("дайте доказательства быстро", "doki tez ber|doki tez bering|doki tez berilar|doki tez berila|doki tez beringlar"),
  uz("в каком правиле", "qaysi qoidada|qaysi qoida"),
  uz("сказал", "db etgan|deb aytgan"),
  uz("без причины", "sababsiz|sabab siz|sabab sz|be sabab|besabab|be sabam|mesabab"),
  uz("примите меры", "chora ko'ring|chora koring|chora ko'ringlar|chora koringlar|chora korila|chora korilar|chora kurilar|chora ko'rilar|chora korilsin"),
  uz("оскорбил родню", "onadan so'kdi|onadan sokdi|onadan sokti|onadan sukindi|onadan sokindi"),
  uz("не оскорблял родню", "onadan so'kmadim|onadan sokmadim"),
  uz("не согласен", "rozi emasman|noroziman|naroziman"),
  uz("несправедливое наказание", "nohaq jazo|nohaq jazoni|nohaq blokirovka"),
  uz("жалоба на администратора", "adminga shikoyat|admin ustidan shikoyat"),
  uz("пересмотрите", "qayta ko'rib chiqing|qayta korib chiqing|qayta ko'rib chiqish"),
  uz("пусть другой администратор рассмотрит", "boshqa admin korib chiqsin|boshqa admin ko'rib chiqsin|boshqa admin korib tashxis qoysin|boshqa admin ko'rib tashxis qo'ysin"),
  uz("внимательно проверьте", "diqqatlik bilan tekshirila|diqqat bilan tekshiring|diqqat bilan tekshirila"),
  uz("надел наручники", "kishan soldi|kishan solib|kishan taqdi|kishan taqib|kshan taqib"),
  uz("не надевал наручники", "kishanlamadim|kishanlamadi"),
  uz("надел наручники", "kishanlab|kishanladi|kishanlangan|kishanlayapti|kshanlab"),
  uz("надел мешок", "qop kiydirdi|qop kiydirib"),
  uz("посадили в машину", "moshinaga solib|mashinaga solib"),
  uz("увезли", "olib ketdi|olib ketti"),
  uz("связал руки", "qolimni boyladi|qo'limni bog'ladi|qolimi boyladi"),
  uz("застрелил", "otib tashladi|otib o'ldirdi|otib oldirdi|otib qoydi|otib qo'ydi"),
  uz("не убивал", "o'ldirmadim|oldirmadim|uldirmadim|o'ldirmadi|oldirmadi|uldirmadi|o'ldirganim yo'q|oldirganim yoq|o'ldirmaganman|oldirmaganman"),
  uz("убил", "o'ldirdi|oldirdi|o'ldirgan|oldirgan|uldirdi|uldrdi|oldrdi|o'ldirish|oldirvordi|o'ldirvordi|oldirib yubordi|o'ldirib yubordi"),
  uz("убивает", "o'ldiryapti|oldiryapti|uldiryapti|uldryapti|uldryabdi|o'ldirmoqda"),
  uz("не стрелял", "otmadim|otmadi"),
  uz("стрелял", "otdi|otvordi|otishvordi|otti"),
  uz("стреляет", "otyapti|otyabdi"),
  uz("не бил", "urmadim|urmadi"),
  uz("ударил", "urdi|urib|urp"),
  uz("бьёт", "uryapti|uryabdi"),
  uz("связал", "bog'ladi|bogladi|boyladi|boylab|bog'lab|boglab"),
  uz("не связывал", "bog'lamadim|boglamadim|bog'lamadi|boglamadi|boylamadim|boylamadi"),
  uz("закрыл глаза", "ko'zimni yopib|kozimi yopib|kozimni yopib"),
  uz("посадил в тюрьму", "qamadi|qamqadi|qamab|qamoqqa oldi|qamoqqa tiqdi|qamoqga tiqdi"),
  uz("не оскорблял", "so'kmadim|sokmadim|sokinmadim|sokinmasam|so'kmadi|sokmadi|so'kinmasamxam|sokinmasamham|so'kmaganman"),
  uz("оскорбил", "so'kdi|sokdi|sokti|sukindi|sokindi|sukini|haqorat qildi|haqrat qildi"),
  uz("оскорбляет", "so'kyapti|sokyapti|so'kvotti|sokvotti|sokyabdi|sokodi|haqorat qilyapti"),
  uz("оскорбление", "haqorat|haqrat|haqrati|haqorot|xaqorat|xaqoratli"),
  uz("клевета", "tuhmat"),
  uz("наручники", "kishan|kishanni|kishanlarni|kishanlar"),
  uz("верёвкой", "arqon bilan"),
  uz("из машины", "moshinadan|mashinadan|moshinasdan"),
  uz("машиной", "moshina bilan|mashina bilan|mashinasida|moshinasida|moshinasda|maahinasda"),
  uz("в машине", "moshinada|mashinada"),
  uz("машина", "moshina|mashina|moshinam|mashinam|moshinani|mashinani|moshinaga|mashinaga"),
  uz("тюрьма", "qamoq|qamoqqa|qamoqga|kamoka"),
  uz("тайзер", "tayzer|tazer"),
  uz("оружие", "qurol|aruja|qurolga|qurolni"),
  uz("лицензия", "litsenziya|litsenziyamni|litni"),
  uz("убил машиной", "moshina bilan o'ldirdi|moshina bilan oldirdi|mashina bilan oldirdi"),
  uz("взятку", "pora"),
  uz("украл", "o'g'irladi|ogirladi|ugirladi"),
  uz("обманул", "aldadi|aldab ketdi"),
  uz("деньги", "pul|pulim|pulimni|pulni"),
  uz("не могу зайти", "kira olmayapman|kirolmayapman|kiraolmayapman|kirolmayabman"),
  uz("не работает", "ishlamayapti|ishlamayabdi"),
  uz("застрял", "tiqilib qoldim|qotib qoldim"),
  uz("помогите", "yordam bering|yordam berilar|yordam berila|yordam beringlar|yordam qiling"),
  uz("помощь", "yordam|yordamga"),
  uz("жалоба", "shikoyat|shikoyatim|shikoyatni|shikoyatlar|shikoyatlarni|shikoyatimni"),
  uz("наказание", "jazo|jazoni|jazoga"),
  uz("предупреждение", "ogohlantirish"),
  uz("доказательства", "dalil|dalillar|dalillarni|isbot|isbotlar"),
  uz("бан", "bandan|banga"),
  uz("выдали бан", "бан berdi|бан berdilar|бан berilgan"),
  uz("выдали мут", "мут berdi|мут berdilar|мут berilgan"),
  uz("выдали варн", "варн berdi|варн berdilar|варн berilgan"),
  uz("получил бан", "бан oldi|бан olgan|бан oldim"),
  uz("заспавнил", "spawn berdi|spawn qildi"),
  uz("есть читы", "chit bor|cheat bor|чит bor"),
  uz("нет читов", "chit yo'q|chit yoq|cheat yo'q|cheat yoq|чит yo'q|чит yoq"),
  uz("понаблюдайте", "kuzatila|kuzating|kuzatinglar"),
  uz("дайте бан", "бан bering|бан berila|бан berilar|бан beringlar"),
  uz("почему", "nega|nimaga"),
  uz("что такое", "nima degani"),
  uz("можно ли", "mumkinmi"),
  uz("пожалуйста", "iltimos|iltmos"),
  uz("прошу", "so'rayman|sorayman|soriman"),
  uz("требую", "talab qilaman"),
  uz("администратор", "admin|adminlar|admini|adminstrator|adminstratsiya", true),
  uz("сотрудник", "xodim|xodimi|hodim|hodimi|hodimni|hodimdi"),
  uz("игрок", "o'yinchi|oyinchi|o'yinchini|oyinchini|o'yinchiga|oyinchiga|o'yinchilar|oyinchilar"),
  uz("полицейский", "militsiya|militsalarni"),
  uz("семья", "semya|semyasidan|oila|oilani|oiladan"),
  uz("товарищ", "jamodoshini|jamoadoshini|sherigim|sherigm"),
  uz("меня", "meni|mani"), uz("мне", "menga|manga"),
  uz("я", "men|man", true), uz("его", "uni", true), uz("ему", "unga", true),
  uz("и", "va|ham", true), uz("с", "bilan|blan|bln", true),
  uz("без", "bez", true), uz("не", "emas", true), uz("нет", "yo'q|yoq", true),
  uz("но", "lekin", true), uz("потом", "keyin|kegin|kegn|ken", true),
  uz("снова", "yana", true), uz("для", "uchun", true),
  uz("сделал", "qildi", true), uz("делает", "qilyapti|qilyabdi|qivoti", true),
  uz("дайте", "bering|berilar|berila|beringlar", true),
  uz("дал", "berdi", true), uz("дней", "kun", true),

  kk("без причины", "себепсіз|себепсиз|себепсiз|себепсізден|себеп жоқ"),
  kk("не согласен", "келіспеймін|келиспеймин|келіспеймин"),
  kk("пересмотрите", "қайта қараңыз|қайта караныз|қайта қарап шығыңыз|кайта карап шыгыныз"),
  kk("не убивал", "өлтірмедім|олтирмедим|өлтірген жоқпын|олтирген жокпын"),
  kk("не убивал", "өлтірген емеспін|олтирген емеспин|өлтірмегенмін|олтирмегенмин"),
  kk("убил", "өлтірді|олтирди|өлтірдi|өлтірген|олтирген"),
  kk("убивает", "өлтіріп жатыр|олтирип жатыр|өлтіреді|олтиреди"),
  kk("не стрелял", "атпадым|атқан жоқпын|аткан жокпын"),
  kk("стрелял", "атты", true),
  kk("стрелял", "атып кетті|атып кетти"),
  kk("меня подстрелили", "мені атты|мени атты"),
  kk("стреляет", "атып жатыр"),
  kk("не бил", "ұрмадым|урмадым|ұрған жоқпын|урган жокпын"),
  kk("ударил", "ұрды|урды|ұрып жіберді|урып жиберди"),
  kk("бьют", "ұрып жатыр|урып жатыр"),
  kk("не оскорблял", "боқтамадым|боктамадым"),
  kk("оскорбил", "боқтады|боктады|балағаттады|балагаттады"),
  kk("оскорбляет", "боқтап жатыр|боктап жатыр|балағаттап жатыр|балагаттап жатыр"),
  kk("связал", "байлады|байлап тастады"),
  kk("не связывал", "байламадым|байламады|байлаған жоқпын|байлаган жокпын"),
  kk("оставил", "тастап кетті|тастап кетти"),
  kk("в наручниках", "наручнипен|кісенмен|кисенмен"),
  kk("надел наручники", "кісен салды|кисен салды|кісен салып|кисен салып"),
  kk("наручники", "кісен|кисен|кісенді|кисенді"),
  kk("руки", "қолымды|колымды|қолын|колын"),
  kk("посадил", "қамады|камады|қамап қойды|камап койды|қамап тастады|камап тастады"),
  kk("в тюрьму", "түрмеге|турмеге"),
  kk("сбил машиной", "көлікпен қақты|коликпен какты|машинамен қақты|машинамен какты"),
  kk("машиной", "көлікпен|коликпен|машинамен"),
  kk("машина", "көлік|колик|көлігім|колигим"),
  kk("маму", "анамды"), kk("родителей", "ата анамды|ата-анамды"),
  kk("деньги", "ақша|акша|ақшамды|акшамды"),
  kk("украл", "ұрлады|урлады"), kk("обманул", "алдады|алдап кетті|алдап кетти"),
  kk("взятку", "пара сұрады|пара сурады"),
  kk("не могу зайти", "кіре алмаймын|кире алмаймын|кіреалмаймын|киреалмаймын|кіре алмай тұрмын|кире алмай турмын"),
  kk("не работает", "жұмыс істемейді|жумыс истемейди"),
  kk("застрял", "тұрып қалдым|турып калдым"),
  kk("помогите", "көмектесіңіз|комектесиниз|көмектесіңдер|комектесиндер|көмектес|комектес"),
  kk("помощь не нужна", "көмек керек емес|комек керек емес"),
  kk("нужна помощь", "көмек керек|комек керек"),
  kk("понаблюдайте", "бақылаңыз|бакыланыз|бақылаңдар|бакыландар"),
  kk("помощь", "көмек|комек"),
  kk("жалоба", "шағым|шагым|шағымым|шагымым|шағымымды|шагымымды"),
  kk("правила", "ереже|ережені|ережени"),
  kk("наказание", "жаза|жазаны"),
  kk("доказательства", "дәлел|далел|дәлелдер|далелдер"),
  kk("покажите доказательства", "дәлел көрсетіңіз|далел корсетиниз|дәлелді көрсетіңіз|далелди корсетиниз"),
  kk("дайте доказательства", "дәлел беріңіз|далел бериниз"),
  kk("выдали бан", "бан берді|бан берди|бан берілді|бан берилди"),
  kk("почему", "неге|неліктен|неликтен"),
  kk("можно ли", "бола ма|болады ма"),
  kk("пожалуйста", "өтінемін|отинемин"),
  kk("прошу", "сұраймын|сураймын"),
  kk("меня", "мені|мени", true), kk("мне", "маған|маган"),
  kk("игрок", "ойыншы|ойыншысы|ойыншыны"),
  kk("сотрудник", "қызметкер|кызметкер"),
  kk("на улице", "далада"), kk("был", "болғам|болгам|болдым"),
  kk("кто-то", "біреу|биреу|бір еу|бир еу"), kk("посмотрел", "қарасам|карасам"),
  kk("я", "мен", true), kk("он", "ол", true),
  kk("не", "емес", true), kk("нет", "жоқ|жок", true),
  kk("для", "үшін|ушин|үшн", true), kk("потом", "кейін|кейин", true),
];

entries.push(
  ...kazakhEntries.map(entry => ({...entry, language: "kk" as const})),
  ...uzbekEntries.map(entry => ({...entry, language: "uz" as const})),
  ...ukrainianEntries.map(entry => ({...entry, language: "uk" as const})),
);

// Shared spelling can have different meanings: KK мені = меня; UK мені = мне.
// Retain every language instead of allowing the last dictionary to overwrite it.
const lexicon = new Map<string, Entry[]>();
let longest = 1;
for (const entry of entries) for (const variant of entry.variants.split("|")) {
  for (const canonical of languageAliasKeys(variant, entry.language)) {
    const existing = lexicon.get(canonical) ?? [];
    // Short generated Cyrillic forms can be ordinary Russian words: пул, пора.
    // They need a separate Uzbek cue, as do aliases identical to their Russian target.
    const generatedCyrillic = entry.language === "uz" && /[a-z]/iu.test(variant) && /^[\p{Script=Cyrillic}]+$/u.test(canonical);
    const sharedCyrillic = generatedCyrillic && ((canonical.length < 5 && !/[қғўҳ]/u.test(canonical)) || canonical === translationKey(entry.target));
    const candidate = sharedCyrillic ? {...entry, ambiguous: true} : entry;
    lexicon.set(canonical, [...existing.filter(item => item.language !== entry.language), candidate]);
    longest = Math.max(longest, canonical.split(" ").length);
  }
}
const words = /[\p{L}]+(?:[ʻʼ‘’'`´][\p{L}]+)*/gu;

export type Understanding = {
  text: string;
  translations: { source: string; target: string; language: Language }[];
  glossary: { term: string; meaning: string }[];
};

const glossary: [string, string][] = [
  ["ДМ", "нападение без РП-причины"], ["ДБ", "нападение с использованием транспорта"],
  ["НРП", "действие без соблюдения РП"], ["РП", "отыгрывание роли"],
  ["ЗЗ", "зелёная зона"], ["ГЗ", "зелёная зона"], ["ТК", "нападение на члена своей команды"],
  ["СК", "нападение на месте появления"], ["УРП", "уход от РП"],
];

export function understandMessage(text: string): Understanding {
  const translations: Understanding["translations"] = [];
  // A short shared word (men/man/мен/мені) alone cannot establish its language.
  const protectedExtra = /((?<![\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])|(?<![\p{L}\p{N}_])(?:ник|нік|логин|логін|nickname|nick|nik|login)(?:\s*[:=]\s*|\s+)[\p{L}\p{N}_-]+)/giu;
  const translated = mapEditableParts(text, editable => editable.split(protectedExtra).map((part, partIndex) => {
    if (partIndex % 2) return part;
    const tokens = [...part.matchAll(words)];
    const anchors: { language: Language; first: number; last: number }[] = [];
    for (let i = 0; i < tokens.length; i++) for (let size = Math.min(longest, tokens.length - i); size > 0; size--) {
      const slice = tokens.slice(i, i + size);
      const source = part.slice(slice[0].index, slice.at(-1)!.index! + slice.at(-1)![0].length);
      const choices = lexicon.get(translationKey(source));
      if (choices?.length === 1 && !choices[0].ambiguous) anchors.push({ language: choices[0].language, first: i, last: i + size - 1 });
    }
    // An Uzbek sentence must not turn an unrelated English “men” later in the
    // message into “я”. Only a nearby cue in the same unquoted clause can help.
    const localScore = (language: Language, first: number, last: number) => anchors.reduce((score, anchor) => {
      if (anchor.language !== language || anchor.first > last + 5 || first > anchor.last + 5) return score;
      const low = Math.min(first, anchor.first), high = Math.max(last, anchor.last);
      const between = part.slice(tokens[low].index!, tokens[high].index! + tokens[high][0].length);
      if (/[,.!?;:\n]/u.test(between)) return score;
      return Math.max(score, 1 / (1 + Math.max(first - anchor.last, anchor.first - last, 0)));
    }, 0);
    const select = (choices: Entry[] | undefined, first: number, last: number) => {
      if (!choices?.length) return undefined;
      if (choices.length === 1 && !choices[0].ambiguous) return choices[0];
      const ranked = choices.map(entry => ({entry, score: localScore(entry.language, first, last)})).sort((a,b) => b.score-a.score);
      return ranked[0].score > 0 && (ranked.length === 1 || ranked[0].score > ranked[1].score) ? ranked[0].entry : undefined;
    };
    let result = "", end = 0;
    for (let i = 0; i < tokens.length; i++) {
      for (let size = Math.min(longest, tokens.length - i); size > 0; size--) {
        const slice = tokens.slice(i, i + size);
        const start = slice[0].index!;
        const finish = slice.at(-1)!.index! + slice.at(-1)![0].length;
        const source = part.slice(start, finish);
        const entry = select(lexicon.get(translationKey(source)), i, i + size - 1);
        if (!entry) continue;
        // Shared Ukrainian forms may be Russian infinitives after a modal verb.
        if (entry.language === "uk" && entry.ambiguous && /(?:^|\s)(?:могу|можем|может|должен|нужно|хочу|буду|будем|будет|надо)\s+(?:не\s+)?$/iu.test(part.slice(0,start))) continue;
        result += part.slice(end, start) + entry.target;
        translations.push({ source, target: entry.target, language: entry.language });
        end = finish;
        i += size - 1;
        break;
      }
    }
    return result + part.slice(end);
  }).join(""));
  const context = contextText(text);
  return {
    text: translated,
    translations,
    glossary: glossary.filter(([term]) => atWord(term).test(context)).map(([term, meaning]) => ({ term, meaning })),
  };
}
