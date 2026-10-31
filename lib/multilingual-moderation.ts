import { atWord } from "./game-language.ts";

// A small explicit lexicon for moderation analysis. It is deliberately not a
// translation dictionary and never changes the original text shown to people.
const families: [string, string[]][] = [
  ["идиот", ["идиот", "идиоты", "идиота", "идиотом", "idiot", "idioty", "идоит"]],
  ["долбоеб", ["долбоеб", "долбоебы", "долбоебом", "долбаеб", "далбаеб", "dolboeb", "dalbaeb"]],
  ["придурок", ["придурок", "придурки", "придурку", "придурком", "pridurok"]],
  ["ублюдок", ["ублюдок", "ублюдки", "ублюдка", "ublyudok", "ublyudki"]],
  ["мразь", ["мразь", "мрази", "mraz", "mrazi"]],
  ["тупой", ["tupoy", "tupaya", "tupye"]],
  ["сука", ["suka", "suki"]],
  ["нахуй", ["нахуй", "nahuy", "naxuy", "nahui"]],
  ["довбойоб", ["довбойоб", "довбойобе", "довбойоби", "довбойобом", "довбойоба", "dovboyob", "dovboiob"]],
  ["ідіот", ["ідіот", "ідіоте", "ідіоти", "ідіотом"]],
  ["хуїло", ["хуїло", "хуїлом", "хуйло", "huyilo", "khuyilo"]],
  ["виродок", ["виродок", "виродки", "виродку", "vyrodok", "virodki"]],
  ["скотина", ["скотина", "скотино", "скотини", "skotyna"]],
  ["йобаний", ["йобаний", "йобана", "йобані", "йобану", "йобане", "yobanyy"]],
  ["ақымақ", ["ақымақ", "ақымақсың", "ақымақсыз", "ақымақтың", "ақымақтар", "акымак", "акымаксын", "aqymaq", "aqymaqsyng", "aqymaqsyn", "akymak"]],
  ["қотақбас", ["қотақбас", "қотақбассың", "қотақбастар", "котакбас", "котакбассын", "qotaqbas", "qotaqbassyng", "qotaqbassyn", "qotakbas", "kotakbas"]],
  ["боқмұрын", ["боқмұрын", "боқмұрынсың", "боқмұрындар", "бокмурын", "бокмурынсын", "boqmuryn", "boqmurynsyng", "bokmuryn"]],
  ["нақұрыс", ["нақұрыс", "нақұрыссың", "накурыс", "накурыссын", "naqurys", "naquryssyng"]],
  ["топас", ["топас", "топассың", "топассын", "topas", "topassyng", "topassyn"]],
  ["малсың", ["малсың", "малсын", "malsyn", "malsyng"]],
  ["сукасың", ["сукасың", "сукасын", "sukasyng"]],
  ["долбоебсың", ["долбоебсың", "долбоебсын", "dolboebsyng"]],
  ["ahmoq", ["ahmoq", "ahmoqsan", "ahmoqsiz", "ahmoqlar", "ahmoqning", "аҳмоқ", "аҳмоқсан", "ахмок", "ахмоксан"]],
  ["tentak", ["tentak", "tentaksan", "tentaklar", "тентак", "тентаксан"]],
  ["haromi", ["haromi", "haromisan", "haromilar", "ҳароми", "ҳаромисан", "хароми", "харомисан"]],
  ["qanjiq", ["qanjiq", "qanjiqsan", "қaнжиқ", "қанжиқ", "канжик", "қанжиқсан"]],
  ["eshshak", ["eshshak", "eshshaksan", "eshshaklar", "eshak", "eshaksan", "эшшак", "эшшаксан", "эшак"]],
  ["qotoqbosh", ["qotoqbosh", "qotoqboshsan", "qo'toqbosh", "қотокбош", "қўтоқбош", "котокбош"]],
  ["siktir", ["siktir", "sktir", "сиктир"]],
  ["masxaraboz", ["masxaraboz", "masxarabozsan", "масхарабоз", "масхарабозсан"]],
  ["itsan", ["itsan", "итсан"]],
];
const forms = new Map(families.flatMap(([canonical, variants]) => variants.map(v => [v, canonical] as const)));
const kazakhRoots = new Set(["ақымақ","қотақбас","боқмұрын","нақұрыс","топас"]);
const uzbekRoots = new Set(["ahmoq","tentak","haromi","qanjiq","eshshak","qotoqbosh","masxaraboz"]);
function keepAddressSuffix(form: string, canonical: string) {
  if(kazakhRoots.has(canonical) && /(?:сың|сын|syng|syn|сыз)$/u.test(form)) return canonical+"сың";
  if(uzbekRoots.has(canonical) && /(?:san|сан|siz|сиз)$/u.test(form)) return canonical+"san";
  return canonical;
}
const normalMask = (word: string) => word.replace(/[aaceopxykmti0136@]/g, c => ({a:"а",c:"с",e:"е",o:"о",p:"р",x:"х",y:"у",k:"к",m:"м",t:"т",i:"і","0":"о","1":"и","3":"з","6":"б","@":"а"}[c]!));
function oneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i=0; while(i<a.length && a[i]===b[i]) i++;
  if(i===a.length && i===b.length) return true;
  if(a.length===b.length) return a.slice(i+1)===b.slice(i+1) || (a[i]===b[i+1] && a[i+1]===b[i] && a.slice(i+2)===b.slice(i+2));
  return a.length>b.length ? a.slice(i+1)===b.slice(i) : a.slice(i)===b.slice(i+1);
}
function normalizedAbuseWord(word: string): string {
  const variants = [word, normalMask(word)].flatMap(s => [s, s.replace(/(.)\1+/gu,"$1")]);
  for(const variant of variants) if(forms.has(variant)) return keepAddressSuffix(variant, forms.get(variant)!);
  // Do not fuzz short ordinary words or a whole arbitrary text. A misspelling
  // must resolve to exactly one insult family, with sufficient letters left.
  if(word.length < 6 || word.length > 17 || /(?:man|ман|мын|мін|пын|пін)$/u.test(word)) return word;
  const matches = new Set<string>();
  for(const variant of variants) for(const [form, canonical] of forms) {
    if(form.length<6 || /[^\p{L}]/u.test(form)) continue;
    if(/[＊*#]/u.test(variant)) {
      if((variant.match(/[＊*#]/gu)?.length??0)===1 && variant.length===form.length && [...variant].every((c,i)=>/[＊*#]/u.test(c)||c===form[i])) matches.add(keepAddressSuffix(form,canonical));
    } else if(oneEdit(variant, form)) matches.add(keepAddressSuffix(form,canonical));
  }
  return matches.size===1 ? [...matches][0] : word;
}

export function normalizeAbuseForms(original: string) {
  let text=original.normalize("NFKC").toLowerCase().replaceAll("ё","е").replace(/[’‘ʻʼ]/gu,"'");
  // Masks inside a known whole form, including spelling letters one by one.
  text=text.replace(/(?<![\p{L}\p{N}_])(?:[\p{L}*#][.·_-]){2,}[\p{L}*#](?![\p{L}\p{N}_])/gu, word=>normalizedAbuseWord(word.replace(/[.·_-]/gu,"")));
  text=text.replace(/(?<![\p{L}\p{N}_])[\p{L}*#]{1,4}(?:[.·_-][\p{L}*#]{1,4})+(?![\p{L}\p{N}_])/gu, word=>{
    const joined=word.replace(/[.·_-]/gu,"");
    const normalized=normalizedAbuseWord(joined);
    return forms.has(normalized) ? normalized : word;
  });
  text=text.replace(/[\p{L}\p{N}*#@]+/gu, normalizedAbuseWord);
  // A bounded join repair: join adjacent fragments only into a known form.
  const tokens=[...text.matchAll(/[\p{L}*#]+/gu)];
  let merged="",cursor=0;
  for(let i=0;i+1<tokens.length;i++) {
    const first=tokens[i],second=tokens[i+1],end=first.index!+first[0].length;
    const gap=text.slice(end,second.index);
    const canonical=forms.get(first[0]+second[0]);
    if(canonical && !forms.has(first[0]) && !forms.has(second[0]) && /^[ \t-]+$/u.test(gap)) {
      merged+=text.slice(cursor,first.index)+keepAddressSuffix(first[0]+second[0],canonical);
      cursor=second.index!+second[0].length;i++;
    }
  }
  text=merged+text.slice(cursor);
  text=text.replace(atWord("идинахуй|пошелнахуй|пошланахуй","gu"), word=>word.replace("нахуй"," нахуй"));
  text=text.replace(/(?<![\p{L}\p{N}_])(ты|вы|сен|ти)(?=(?:тупой|тупая|конченый|дебил|ақымақ|қотақбас|довбойоб)(?![a-z]))/gu,"$1 ");
  return text;
}

export type MultilingualAbuse = { match: string; reason: string };
const foreignInsult=atWord("(?:довбойоб|ідіот|хуїло|виродок|скотина|йобаний|ақымақ|қотақбас|боқмұрын|нақұрыс|топас|малсың|сукасың|долбоебсың|ahmoq|tentak|haromi|qanjiq|eshshak|qotoqbosh|siktir|masxaraboz|itsan)(?:сың|san)?", "gu");
const address=atWord("ти|ви|тебе|тобі|твої|твою|тобою|сен|сіз|сенің|саған|сені|өзің|озин|sening|sen|siz|seni|senga|sizga|sizni|ozing|o'zing|сенга|сени|сизга|ты|вы|тебя|тебе|вам|вас");
const personRole=atWord("админ[\p{L}]*|адмін[\p{L}]*|admin[\p{L}]*|әкімші[\p{L}]*|акимши|akimshi|таксист[\p{L}]*|taksichi|полицей[\p{L}]*|копе|мент|ment|модер[\p{L}]*|дәрігер|доригер|shifokor|o'yinchi|гравцю|продавцю|сатушы|басшы[\p{L}]*|қарсылас|бала|новач[\p{L}]*|jamoadosh[\p{L}]*");
// Productive reporting inflections include speech addressed to the reporter
// ("you called me ..."). Present first-person authorship is deliberately absent.
const speechWords=atWord("написав|пише|пишеш|пишете|написали|сказав|казав|сказали|назвав|назвала|назвали|назива(?:в|ла|ли|є|єш|ють|єте)|обзива(?:в|ла|ли|є|єш|ють|єте)|жазды|жазады|жазған|жаздың|жаздыңыз|жазасың|айтты|айтқан|айттың|айттыңыз|айтасың|де(?:ді|дің|діңіз|ген|йді|йсің|йсіз)|ата(?:ды|ған|дың|дыңыз|йды)|yozdi|yozding|yozdingiz|yozgan|yozishyapti|yozyapti|yozyapsan|yozyapsiz|ayt(?:di|ding|dingiz|gan|yapsan|yapsiz)|de(?:di|ding|dingiz|dilar|gan|ydi|yapsan|yapsiz)|atadi|atading|atadingiz|atashdi|ataldi|деди|дединг|дейди|езди|ёзди|ёздинг|ёзган|айтди|айтдинг|написал|написали|пишет|сказал|говорит|назвал|называют");
const quotedAttribution=atWord("цитата|цитую|дәйексөз|дәйексоз|iqtibos|iqtibosi|иқтибос|скрин[\p{L}]*|скрін[\p{L}]*|скріншот[\p{L}]*");
const metaQuestion=atWord("(?:що|не|nima)\\s+(?:означає|значить|деген|degani)|(?:сөз|сөздің|so'z|so'zi|слово|слова|словом|вираз|фраза|термін)\\s*[:—-]?|(?:не\\s+можна|не\\s+пиши|не\\s+називай|жазуға\\s+болмайды)|(?:айтуға|жазуға)\\s+бола");
const self=atWord("я|мен|men|ўзим|өзім|ozim|o'zim");
const incident=atWord("вбив|вбиває|убив|убиває|б'є|стріляє|забрав|украв|обдурив|обманув|өлтірді|урды|ұрды|ұрлап|алдады|urdi|urishyapti|oldirdi|o'ldirdi|aldadi|o'g'irladi|ўлдирди|урди|алдади|убил|обманул|забанил");
const affected=atWord("мене|мені|нас|нам|мені|маған|мени|магaн|meni|menga|мне|меня");
function reported(claim: string, before: string, after: string) {
  // Present first-person statements are an author's own speech, even if they
  // contain «deb/деп/називаю». A third-party/past report is not author abuse.
  if(speechWords.test(before) || speechWords.test(after)) return true;
  if(metaQuestion.test(before) || quotedAttribution.test(before)) return true;
  if(/^[\s,:—-]*(?:nima\s+degani|деген\s+не|що\s+означає|що\s+значить|(?:це\s+)?образа|(?:це\s+)?лайка)(?![\p{L}])/u.test(after)) return true;
  if(/^[\s,:—-]*(?:деп|deb|деб)\s+(?:atadi|atashdi|yozishdi|yozdi|aytdi|айтты|жазды|написав|назвав)/u.test(after)) return true;
  return false;
}
function negated(before:string,after:string) {
  return /(?:^|\s)(?:не|емес|emas|эмас)(?:\s+(?:такий|така|такі|зовсім|нағыз))?\s*$/u.test(before)
    || /^[\s,:—-]*(?:емес(?:сің|пін|сіз)?|емессің|emas(?:san|man)?|эмас(?:сан|ман)?|деме|демесін|демеңіз|dema|demang|aytmang)(?![\p{L}])/u.test(after);
}
function authoredQuote(prefix:string,suffix:string) {
  const before=prefix.split(/[.!?;\n]/u).at(-1)!;
  if(speechWords.test(before) || quotedAttribution.test(before) || speechWords.test(suffix)) return false;
  return (address.test(before) && !atWord("мені|мене|meni|menga|маған").test(before))
    || atWord("від\\s+себе|від\\s+мене|өзім\\s+айт|o'zim\\s+ayt|o'zim\\s+deyman").test(before+" "+suffix)
    || atWord("(?:це|бұл|bu)\\s+(?:менің|менин|мій|моя)|саған\\s+айтқаным|тобі\\s+(?:кажу|пишу)|senga\\s+(?:gap|ayt)").test(suffix);
}

export function inspectMultilingualAbuse(original:string): MultilingualAbuse | null {
  let text=normalizeAbuseForms(original).replace(/https?:\/\/\S+|www\.\S+|@[\p{L}\p{N}_]+|[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+|```[\s\S]*?```|`[^`\n]*`/gu," ");
  text=text.replace(/«([^»]*)(?:»|$)|"([^"]*)(?:"|$)|“([^”]*)(?:”|$)/gu,(all,a:string,b:string,c:string,offset:number,source:string)=>authoredQuote(source.slice(0,offset),source.slice(offset+all.length)) ? " "+(a??b??c)+" " : " ");
  const claims=text.split(/[.!?;\n]+|,\s*(?:а|но|але|бірақ|lekin|ammo)\s+/u).map(s=>s.trim()).filter(Boolean);
  for(const claim of claims) {
    for(const hit of claim.matchAll(foreignInsult)) {
      const before=claim.slice(0,hit.index), after=claim.slice(hit.index!+hit[0].length);
      if(reported(claim,before,after) || negated(before,after)) continue;
      const second=address.test(before+" "+after);
      if(!second && self.test(before) && !personRole.test(before+" "+after)) continue;
      if(!second && incident.test(claim) && affected.test(claim)) continue;
      // An adjective applied to a game object is frustration, not an insult of
      // a person. Person suffixes and obscene dismissal remain unambiguous.
      if(!second && /^[\s,:—-]+(?:баг|сервер|кнопк|гра|граю|ойын|o'yin|internet|інтернет)/u.test(after)) continue;
      const standalone=!/[\p{L}\p{N}]/u.test((before+after).replace(/\[[^\]]*\]/gu,""));
      const secondSuffix=/сың$|san$/u.test(hit[0]);
      const imperative=atWord("йди|іди|замовкни|заткнись|смокчи|аулақ|жоғал|yo'qol|ўқ[иӣ]|o'qi|отвали|қара|қарашы|siktir").test(claim);
      if(second || secondSuffix || personRole.test(before+" "+after) || imperative || standalone) return {match:hit[0],reason:"Найдено собственное адресное оскорбление на украинском, казахском или узбекском языке. Пересказ, отрицание и цитирование проверены отдельно."};
    }
    const obsceneDismissal=atWord("(?:йди|іди|пішов|пішла|poshel|poshyol|idi)\\s+(?:(?:ты|ти|ви|ty)\\s+)?(?:нахуй|на\\s+хуй)|(?:смокчи|соси)\\s+хуй|(?:шешеңді|шешенди|sheshengdi)\\s+(?:сігейін|сигейин|sigeyin)|(?:заткни|закрой)\\s+(?:свое\\s+)?ебало", "gu");
    for(const match of claim.matchAll(obsceneDismissal)) {
      if(!reported(claim,claim.slice(0,match.index),claim.slice(match.index!+match[0].length)) && !negated(claim.slice(0,match.index),"")) return {match:match[0],reason:"Найдено собственное адресное непристойное оскорбление. Цитирование и отрицание проверены отдельно."};
    }
    const threat=atWord("(?:я\\s+)?(?:тебе|тобі|вас|вам)\\s+(?:знайду|влаштую)|(?:сені|сени|seni|sizni)\\s+(?:өмірде|omirde|o'yindan\\s+tashqarida)|(?:shaxsiy|шахсий)\\s+(?:ma'lumot|маълумот)").exec(claim);
    if(threat && !reported(claim,claim.slice(0,threat.index),claim.slice(threat.index+threat[0].length))
       && !atWord("не|емес|emas").test(claim)
       && (atWord("реалі|реале|реальну\\s+розправу|поза\\s*грою|поб'ю|переламаю|өлтірем|таратамын|tarqataman|tarqatib|тарқатаман").test(claim))) return {match:threat[0],reason:"Автор адресует угрозу насилия вне игры или распространения личных сведений. Это требует модерации."};
  }
  return null;
}
