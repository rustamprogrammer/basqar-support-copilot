// These keys recognize only curated phrases. Unknown input is never transliterated.
export type SupportLanguage = "uz" | "kk" | "uk";
const toCyrillic: Record<string, string> = {a:"а",c:"с",e:"е",o:"о",p:"р",x:"х",y:"у",k:"к",m:"м",t:"т",b:"в",h:"н",i:"і"};
const toLatin: Record<string, string> = {а:"a",с:"c",е:"e",о:"o",р:"p",х:"x",у:"y",к:"k",м:"m",т:"t",в:"b",н:"h",і:"i"};

export function translationKey(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[ʻʼ‘’'`´]/gu, "")
    .replace(/[\p{L}]+/gu, token => {
      const latin = token.match(/[a-z]/gu)?.length ?? 0;
      const cyrillic = token.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
      if (!latin || !cyrillic) return token;
      return cyrillic >= latin
        ? token.replace(/[a-z]/gu, letter => toCyrillic[letter] ?? letter)
        : token.replace(/\p{Script=Cyrillic}/gu, letter => toLatin[letter] ?? letter);
    }).replace(/\s+/gu, " ");
}

const uzbekAlphabet: Record<string, string> = {
  a:"а",b:"б",d:"д",e:"е",f:"ф",g:"г",h:"ҳ",i:"и",j:"ж",k:"к",l:"л",m:"м",
  n:"н",o:"о",p:"п",q:"қ",r:"р",s:"с",t:"т",u:"у",v:"в",x:"х",y:"й",z:"з",
};
const uzbekDigraphs: Record<string, string> = {sh:"ш", ch:"ч", yo:"ё", yu:"ю", ya:"я", ye:"е", ts:"ц"};
function uzbekCyrillic(source: string) {
  return source.toLowerCase().replace(/[ʻʼ‘’`´]/gu, "'")
    .replace(/o'/gu, "ў").replace(/g'/gu, "ғ")
    .replace(/sh|ch|yo|yu|ya|ye|ts|[a-z]/gu, token => uzbekDigraphs[token] ?? uzbekAlphabet[token] ?? token);
}

export function languageAliasKeys(source: string, language: SupportLanguage) {
  const variants = [source];
  if (language === "uz" && /[a-z]/iu.test(source)) variants.push(uzbekCyrillic(source));
  const keys = variants.map(translationKey);
  // Finite known phrases only; no splitting arbitrary words or stripping suffixes.
  for (const variant of [...keys]) {
    const parts = variant.split(" ");
    if (parts.length >= 2 && parts.length <= 4 && variant.length >= 10 && /^[\p{L} ]+$/u.test(variant)) keys.push(parts.join(""));
  }
  return [...new Set(keys)];
}
