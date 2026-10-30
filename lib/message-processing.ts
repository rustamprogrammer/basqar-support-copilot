const dictionary: Record<string, string> = {
  памагите: "помогите", помагите: "помогите", памогите: "помогите", помогити: "помогите", памаги: "помоги", помаги: "помоги",
  помошь: "помощь", памощь: "помощь", помощьь: "помощь", помощ: "помощь", помош: "помощь",
  пажалуста: "пожалуйста", пожалуста: "пожалуйста", пожалусто: "пожалуйста", пажалуйста: "пожалуйста",
  немогу: "не могу", неможем: "не можем", неработает: "не работает", неработаит: "не работает",
  работаит: "работает", работоет: "работает", рабоатет: "работает", неработают: "не работают",
  акаунт: "аккаунт", акаунта: "аккаунта", акаунте: "аккаунте", акаунту: "аккаунту", аккаунд: "аккаунт",
  саабщение: "сообщение", соабщение: "сообщение", саобщение: "сообщение", сообщние: "сообщение", саабщения: "сообщения",
  атправляится: "отправляется", отправляится: "отправляется", отпровляется: "отправляется", атправить: "отправить", отпровить: "отправить",
  ашибка: "ошибка", ошипка: "ошибка", ашибку: "ошибку", ошипку: "ошибку", ашибки: "ошибки", ошипки: "ошибки",
  парол: "пароль", параль: "пароль", кнпока: "кнопка", кнопака: "кнопка", заити: "зайти", ваити: "войти",
  палучается: "получается", получаеться: "получается", открываеться: "открывается", отправляеться: "отправляется",
  загружаиться: "загружается", загружаеться: "загружается", ничиво: "ничего", севодня: "сегодня", спасиба: "спасибо",
};
const word = (pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, "iu");
const help = word("помощь|помогите|помоги|помочь");
const problem = word("не\\s+(?:могу|можем|получается)\\s+(?:войти|зайти|открыть|отправить|загрузить|оплатить)|не\\s+(?:работает|работают|открывается|отправляется|загружается|приходит)");
const declinedHelp = word("помощь\\s+(?:больше\\s+)?не\\s+нужна|не\\s+нужна\\s+(?:мне\\s+)?помощь");

function keepCase(source: string, replacement: string) {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  return source[0] === source[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
}

export function processMessage(original: string) {
  const input = original.trim();
  // Keep quoted text, code, links, email addresses and numeric identifiers verbatim.
  const protectedParts = new RegExp('(```[\\s\\S]*?```|`[^`\\n]*`|https?://[^\\s]+|www\\.[^\\s]+|[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}|«[^»]*»|"[^"]*"|[\\p{L}\\p{N}_-]*\\d[\\p{L}\\p{N}_-]*)', 'giu');
  let text = input.split(protectedParts).map((part, index) => {
    if (index % 2) return part;
    return part
      .replace(new RegExp('(?<![\\p{L}\\p{N}_])[а-яё]+(?![\\p{L}\\p{N}_])', 'giu'), token => dictionary[token.toLowerCase()] ? keepCase(token, dictionary[token.toLowerCase()]) : token)
      .replace(new RegExp('(?<![\\p{L}\\p{N}_])(не|я)\\s+магу(?![\\p{L}\\p{N}_])', 'giu'), match => keepCase(match, match.toLowerCase().replace('магу', 'могу')))
      .replace(new RegExp('(?<![\\p{L}\\p{N}_])у\\s+миня(?![\\p{L}\\p{N}_])', 'giu'), match => keepCase(match, 'у меня'))
      .replace(new RegExp('(?<![\\p{L}\\p{N}_])(помогите|помоги)[ \\t]+(пожалуйста)(?![\\p{L}\\p{N}_])', 'giu'), '$1, $2')
      .replace(new RegExp('(?<![\\p{L}\\p{N}_])(пожалуйста)[ \\t]+(?=(?:не|у|я|мне|нам)(?![\\p{L}\\p{N}_]))', 'giu'), '$1, ');
  }).join('');
  if (text !== input) text = text.replace(/^[а-яё]/u, first => first.toUpperCase());
  const normalized = text.normalize('NFKC');
  const status = problem.test(normalized) || (help.test(normalized) && !declinedHelp.test(normalized)) ? 'pending' as const : 'trash' as const;
  return { text, status, corrected: text !== input };
}
