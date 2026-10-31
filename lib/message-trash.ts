import {contextText} from "./game-language.ts";

// A short allowlist, matched against the entire message. Unknown language is
// never evidence of trash; protected quotes/links are not silently discarded.
export function isSocialOnly(original: string): boolean {
  const text=original.trim().toLowerCase().replaceAll("ё","е");
  if(contextText(text).trim()!==text)return false;
  return /^(?:hi|hello|hey|приветик|здрасьте|здарова|добрый\s+(?:день|вечер)|доброе\s+утро)[\s,.!]*$/u.test(text)
    || /^(?:a{3,}|а{3,})[.!\s]*$/u.test(text)
    || /^(?:(?:а?ха){3,}|(?:ha){3,})[\s.!\p{S}\uFE0F]*$/u.test(text)
    || /^(?:(?:ладно|ладна|это|просто)\s+){0,2}шутка[.!\s]*$/u.test(text)
    || /^(?:спасибо\s+вам|всегда\s+пожалуйста|приятной\s+игры|удачного\s+(?:дня|рабочего\s+дня))[.!\s]*$/u.test(text);
}
