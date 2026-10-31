// Facts from the original text. This module never rewrites text or assigns a final route.
// Use helpHint only after explicit author violations and the request's purpose are checked.
export type EvidenceSpan = { start: number; end: number; text: string };
export type ParticipantEvidence = EvidenceSpan & { kind: "id" | "nickname" };
export type LinkEvidence = EvidenceSpan & { redacted: boolean };
export type IncidentEvidence = EvidenceSpan & { code: string };
export type RoutingEvidence = {
  participants: ParticipantEvidence[];
  links: LinkEvidence[];
  incidents: IncidentEvidence[];
  protectedSpans: EvidenceSpan[];
  context: string;
  bareCode: boolean;
  anchoredIncident: boolean;
  helpHint: boolean;
  blockedBy: "information-purpose" | "negated-or-mentioned" | null;
};

const word = String.raw`[\p{L}\p{N}_]`;
const codeForms: [string, string][] = [
  ["ДМ", "дм|dm|дмит|дмят|дмил|дмили"],
  ["ДБ", "дб|db|дбшит|дбшат|дбшил|дбшили"],
  ["СК", "ск|sk"], ["ТК", "тк|tk"], ["РК", "рк|rk"],
  ["НРП", "нрп|нонрп|nrp|nonrp"], ["МГ", "мг|mg"], ["ПГ", "пг|pg"],
  ["ОСК", "оск|osk"], ["УПОМ", "упом"], ["ЧИТ", "чит|читы"],
];
const codePattern = codeForms.map(([, aliases]) => aliases).join("|");
const codes = new RegExp(`(?<!${word})(?:${codePattern})(?!${word})`, "giu");
const joinedIdCode = new RegExp(`^(\\d{1,6})(${codePattern})$`, "iu");
const ruleReference = /(?<![\p{L}\p{N}_])\d{1,2}(?:\.\d{1,2}){1,2}\s*(?:оп|гз|op)(?![\p{L}\p{N}_])/giu;
// Protect before extracting words. A code occurring inside a URL, command, quote,
// email, nickname or arbitrary identifier is not an authored incident statement.
const protectedPattern = /```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)|https?:\/\/[^\s<>]+|www\.[^\s<>]+|[\p{L}\p{N}_.+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|\/[\p{L}\p{N}][\p{L}\p{N}_/-]*|@[\p{L}\p{N}_]+|«[^»]*(?:»|$)|"[^"]*(?:"|$)|“[^”]*(?:”|$)|<[^>]+>|[\p{L}\p{N}_-]*\d[\p{L}\p{N}_-]*|[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+/giu;
const beforeCue = /(?:^|[^\p{L}\p{N}_])(?:id|ид|айди|игрок|игрока|ник|ником)\s*[:#№]?\s*$/iu;
const informationPurpose = /(?:что\s+(?:это\s+)?(?:такое|значит|означает)|(?:как|куда|где|кому)\s+(?:подать|писать|написать|отправить)\s+(?:жб|жалобу)|сколько\s+(?:дают|длится|стоит)|(?:можно|разрешено|запрещено)\s+ли|(?:приведите|покажите)\s+пример|(?:пример|образец|проверка|тест)\s*[:—-])/iu;

function span(text: string, start: number, length: number): EvidenceSpan {
  return { start, end: start + length, text: text.slice(start, start + length) };
}
function mask(text: string, spans: EvidenceSpan[]) {
  const chars = text.split("");
  for (const item of spans) for (let i = item.start; i < item.end; i++) {
    if (!/\s/u.test(chars[i])) chars[i] = " ";
  }
  return chars.join("");
}
function incidentCode(value: string) {
  return codeForms.find(([, aliases]) => new RegExp(`^(?:${aliases})$`, "iu").test(value))?.[0] ?? value.toUpperCase();
}
function near(text: string, left: EvidenceSpan, right: EvidenceSpan) {
  const a = left.end <= right.start ? left : right;
  const b = a === left ? right : left;
  const between = text.slice(a.end, b.start);
  // Evidence may be pasted on the preceding line; unrelated sentences must not bind.
  return between.length <= 80 && !/[!?;]|\.(?!\d)/u.test(between);
}
function isMentionOrNegation(context: string, item: EvidenceSpan) {
  const before = context.slice(Math.max(0, item.start - 60), item.start).split(/[.!?;\n]/u).at(-1)!;
  const after = context.slice(item.end, item.end + 40).split(/[.!?;\n]/u)[0];
  return /(?:^|[^\p{L}])(?:не|нет|без)\s*(?:#+\s*)?$/iu.test(before)
    || /^\s*(?:не\s+было|отсутствует)(?![\p{L}])/iu.test(after)
    || /(?:^|[^\p{L}])(?:слово|термин|код|ник|ником|название|команда|написал|написала|пишет|сказал|сказала|произнёс|произнес)\s*[:—-]?\s*$/iu.test(before);
}

export function inspectRoutingEvidence(text: string): RoutingEvidence {
  const participants: ParticipantEvidence[] = [];
  const links: LinkEvidence[] = [];
  const incidents: IncidentEvidence[] = [];
  const protectedSpans: EvidenceSpan[] = [];
  const addParticipant = (item: EvidenceSpan, kind: ParticipantEvidence["kind"]) => {
    if (!participants.some(found => found.start === item.start)) participants.push({ ...item, kind });
  };
  for (const match of text.matchAll(protectedPattern)) {
    const item = span(text, match.index, match[0].length);
    protectedSpans.push(item);
    const value = item.text;
    if (/^(?:https?:\/\/|www\.)/iu.test(value) || /^<url>$/iu.test(value)) {
      links.push({ ...item, redacted: /^<url>$/iu.test(value) });
      continue;
    }
    if (/^(?:[`«"“/<]|[\p{L}\p{N}_.+-]+@)/u.test(value)) continue;
    if (/^@[\p{L}\p{N}_]+$/u.test(value)) {
      addParticipant(item, "nickname");
      continue;
    }
    const joined = joinedIdCode.exec(value);
    if (joined) {
      if (/^db$/iu.test(joined[2]) && /^\s+(?:etgan|degan|etib)(?![\p{L}\p{N}_])/iu.test(text.slice(item.end))) continue;
      addParticipant(span(text, item.start, joined[1].length), "id");
      incidents.push({ ...span(text, item.start + joined[1].length, joined[2].length), code: incidentCode(joined[2]) });
      continue;
    }
    const before = text.slice(Math.max(0, item.start - 30), item.start);
    const after = text.slice(item.end, item.end + 30);
    if (/^\d{1,6}$/u.test(value)) {
      // Do not reinterpret rule numbers, timestamps, prices or quantities as people.
      if (/[.\d:]$/u.test(before) || /^[.:\d]/u.test(after)) continue;
      if (/^\s*(?:мин(?:ут[уы]?)?|сек(?:унд[уы]?)?|час(?:а|ов)?|дн(?:я|ей)|руб(?:лей)?|тенге|тг|раз(?:а)?|лет|уровень|уровня|лвл|fps|фпс|%)(?![\p{L}])/iu.test(after)) continue;
      if (/(?:пункт|правило|статья|версия|сервер|сервере|ошибка|код|пинг)\s*[:#№]?\s*$/iu.test(before)) continue;
      // A bare integer is a candidate participant only if a nearby incident binds it below.
      addParticipant(item, "id");
      continue;
    }
    const suffixedId = /^(\d{1,6})(?:ид|id)$/iu.exec(value);
    if (suffixedId) {
      addParticipant(span(text, item.start, suffixedId[1].length), "id");
      continue;
    }
    if (beforeCue.test(before)
      || /^[A-ZА-ЯЁ][a-zа-яё]+_[A-ZА-ЯЁ][\p{L}\p{N}_]*$/u.test(value)) {
      addParticipant(item, "nickname");
    }
  }
  const context = mask(text, protectedSpans);
  // Plain nicknames require an explicit participant cue; ordinary words are not names.
  const plainNick = /(?:^|[^\p{L}\p{N}_])(?:игрок|игрока|ник|ником)\s*[:#№]?\s*([A-ZА-ЯЁ][\p{L}]{2,})(?![\p{L}\p{N}_])/gu;
  for (const match of context.matchAll(plainNick)) {
    if (codeForms.some(([, aliases]) => new RegExp(`^(?:${aliases})$`, "iu").test(match[1]))) continue;
    const start = match.index + match[0].lastIndexOf(match[1]);
    addParticipant(span(text, start, match[1].length), "nickname");
  }
  for (const match of context.matchAll(codes)) {
    if (/^db$/iu.test(match[0]) && /^\s+(?:etgan|degan|etib)(?![\p{L}\p{N}_])/iu.test(context.slice(match.index + match[0].length))) continue;
    incidents.push({ ...span(text, match.index, match[0].length), code: incidentCode(match[0]) });
  }
  // References are read from original text but cannot overlap quotes/links/identifiers.
  // The numeric parts themselves are protected; ensure every non-number part is editable.
  for (const match of text.matchAll(ruleReference)) {
    const item = span(text, match.index, match[0].length);
    if (protectedSpans.some(p => p.start < item.end && p.end > item.start && !/^\d+$/u.test(p.text))) continue;
    incidents.push({ ...item, code: item.text.toUpperCase() });
  }
  incidents.sort((a, b) => a.start - b.start);
  participants.sort((a, b) => a.start - b.start);
  // An extracted nickname is also protected in the returned analysis context.
  const analysisContext = mask(context, participants.filter(item => item.kind === "nickname"));
  const anchored = incidents.filter(item => [...participants, ...links].some(anchor => near(analysisContext, item, anchor)));
  // Retain opaque anchor placeholders for local syntax: "ник <person> ДМ" must
  // not collapse into "ник ДМ", while the person's spelling remains protected.
  const guardChars = analysisContext.split("");
  for (const anchor of [...participants, ...links]) {
    for (let i = anchor.start; i < anchor.end; i++) guardChars[i] = "#";
  }
  const guardContext = guardChars.join("");
  const usable = anchored.filter(item => !isMentionOrNegation(guardContext, item));
  const information = informationPurpose.test(analysisContext);
  const anchoredIncident = anchored.length > 0;
  const bareCode = incidents.length > 0 && !anchoredIncident
    && analysisContext.replace(codes, "").replace(/[\s.,!?;:+—-]+/gu, "") === "";
  return {
    participants, links, incidents, protectedSpans, context: analysisContext, bareCode, anchoredIncident,
    helpHint: usable.length > 0 && !information,
    blockedBy: information ? "information-purpose" : anchoredIncident && !usable.length ? "negated-or-mentioned" : null,
  };
}
