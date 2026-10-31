import {atWord, contextText} from "./game-language.ts";
import {punishmentWords} from "./request-analysis.ts";
import type {RoutingDecision} from "./message-routing.ts";
import {inspectRoutingEvidence} from "./routing-evidence.ts";

export function referencedPlayer(text: string) {
  const evidence=inspectRoutingEvidence(text);
  if(evidence.participants.some(item=>item.kind==="nickname")||(evidence.participants.length>0&&evidence.helpHint))return true;
  const clean=text.replace(/«[^»]*»|"[^"]*"|`[^`]*`|https?:\/\/\S+|www\.\S+|\/[\p{L}\p{N}_]+|<[^>]+>|\b\d+\.\d+(?:\.\d+)*\b/giu," ");
  return /(?:\b(?:id|ID)\b|айди|ид|игрок(?:а|у)?)\s*[:#№-]?\s*\d{1,6}(?!\d)|(?:^|\s)\d{1,6}\s+(?:дм|дб|оск|чит|софт|убил|нрп|спам|скам)|(?:дм|дб|спек|следите|оск|читер)\s+\d{1,6}(?!\d)|Уточнение:\s*\d{1,6}[\s.!]*$|[\p{L}]+_[\p{L}_]+/iu.test(clean);
}

export function clarifyDecision(original: string, understood: string, decision: RoutingDecision): RoutingDecision {
  const text=contextText(understood).toLowerCase().replaceAll("ё","е");
  const has=(pattern:string)=>atWord(pattern).test(text);
  const ask=(field:string,question:string)=>({...decision,needsClarification:true,missingDetails:[field],followUp:question});
  const complete=()=>({...decision,needsClarification:false,missingDetails:[],followUp:undefined});
  if(decision.route === "trash" || decision.route === "violation")return complete();
  if(decision.route===null){
    if(decision.ruleId==="route.bare-term")return ask("purpose","Вам нужно объяснить термин или помочь с происшествием?");
    if(has("слив|пп"))return ask("meaning","Что означает «ПП» в этой ситуации и что произошло?");
    if(/^\s*\d+(?:\.\d+)+[\s.!?]*$/u.test(original))return ask("purpose","Вы спрашиваете о пункте правил или сообщаете о происшествии?");
    if(has("не\\s+(?:дм[а-я]*|оск[а-я]*|использу[а-я]*)|без\\s+чит[а-я]*"))return ask("purpose","Вас наказали за это действие или вы хотите что-то узнать?");
    return ask("purpose","Что вы хотите узнать или какую помощь получить?");
  }
  if(decision.route==="question"){
    const words=text.match(/[\p{L}]+/gu)||[];
    if(has("отгадать\\s+(?:слово|загадку)")&&words.length<10)return ask("task","Напишите условие задания и известные буквы.");
    if(has("когда|во\\s+сколько")&&has("собеседовани[а-я]*|собез")&&words.length<7)return ask("event","О каком собеседовании или организации вы спрашиваете?");
    if(/^(?:(?:а|ну|мне|нам|пожалуйста)\s+)*(?:как|что|где)(?:\s+(?:это|делать|найти|получить))?[\s!?.,]*$/u.test(text)&&!/[«"“][^»"”]+[»"”]/u.test(original))return ask("subject","О каком действии или термине вы спрашиваете?");
    return complete();
  }
  const words=text.match(/[\p{L}]+/gu)||[];
  const subjectlessText=text.replace(atWord("здравствуй[а-я]*|здрастуй[а-я]*|здраствуй[а-я]*|привет|срчоно|[пахх]{3,}|(?:ха)+|(?:xa)+|xaxax", "gu")," ").replace(/[\p{P}\p{S}]/gu," ");
  const subjectless=/^\s*(?:(?:админ[а-я]*|адм|пж|пожалуйста|плиз|help|хелп|sos|сос|помощь|помогите|помоги|помочь|нужна|нужно|мне|нам|очень|срочно|прошу|спасите)[\s,.!?]*)+$/u.test(subjectlessText);
  if(subjectless)return ask("problem","Что произошло и какая помощь вам нужна?");
  if(has("ничего\\s+не\\s+могу\\s+делать"))return ask("problem","Что именно не получается сделать и что происходит при попытке?");
  if(has("заебал[а-я]*|достал[а-я]*|мешает")&&has("помогите|помоги|помощь")&&!decision.events?.some(e=>e.kind==="incident"&&!e.negated))return ask("incident","Что именно сделал игрок и какая помощь нужна?");
  const evidence=inspectRoutingEvidence(original), identified=referencedPlayer(original), linked=evidence.links.length>0;
  const positiveIncident=decision.events?.some(e=>e.kind==="incident"&&!e.negated);
  if(has("пожаловаться|жалуюсь")&&!positiveIncident)return ask("incident","Что произошло с указанным игроком?");
  if(has("спек|следите|проследите")&&!identified&&!linked)return ask("player","За каким игроком нужно понаблюдать: ID или ник?");
  if(has("(?:посмотрите|рассмотрите)\\s+(?:ка\\s+)?(?:жб|жалобу)")&&!linked&&words.length<7)return ask("report","Пришлите номер или ссылку на жалобу.");
  if(has("сними|снимите|уберите|выпусти|вытащи|вытащите")&&words.length<5&&!has("бан|мут|варн|наручники|машину|мопед|транспорт|мешок"))return ask("object","Что нужно снять, убрать или откуда вас освободить?");
  if(has("почему")&&has("добавили|продлили")&&!has("бан|мут|варн|деморган|тюрьм[а-я]*"))return ask("decision","Какое наказание или ограничение вам продлили?");
  const appeal=decision.topic==="Обжалование наказания"||has("обжал[а-я]*|пересмотр[а-я]*|не\\s*соглас[а-я]*|не\\s+согл|опру|опра");
  if(appeal){
    if(/^\s*за\s+что\s+(?:бан|мут|варн)[\s!?.,]*$/u.test(text))return ask("decision","Пришлите уведомление о наказании или укажите, когда и на каком сервере его выдали.");
    if(has("фрапс|опру|опра|доказательств[а-я]*|лог[а-я]*"))return complete();
    if((!has(punishmentWords)||!has("бан[а-я]*|мут[а-я]*|варн[а-я]*|деморган|дмг|джаил|предупреждени[а-я]*"))&&words.length<12)return ask("decision","Какое наказание или решение вы просите проверить?");
    return complete();
  }
  if(has("не\\s+дает\\s+(?:мне\\s+)?сесть")&&has("вертолет[а-я]*|машин[а-я]*|транспорт[а-я]*"))return ask("obstacle","Другой игрок мешает или посадка не работает?");
  const recovery=has("вытащи[а-я]*|достан[а-я]*|верните|телепортируйте|перенесите|утонул[а-я]*|почини[а-я]*|переверни[а-я]*");
  if(recovery&&has("машин[а-я]*|мотоцикл[а-я]*|мотик[а-я]*|транспорт[а-я]*|тс")&&!has("возле|рядом|около|координат[а-я]*|гараж[а-я]*|парковк[а-я]*|(?:у|на)\\s+(?:банка|вокзала|рынка|пирса|моста|стоянке|паркинге)"))return ask("location","Где находится транспорт?");
  if(has("накажите|наказать|выдайте|(?:дайте|выдать)\\s+(?:бан|варн|мут)|принять\\s+меры")&&!positiveIncident&&!linked)return ask("incident","Что сделал игрок и как его найти: ID или ник?");
  const narrative=has("(?:я|мы)\\s+(?:(?:просто|спокойно|сначала|потом)\\s+)?(?:стоял[а-я]*|ехал[а-я]*|выш[а-я]*|подош[а-я]*|передал[а-я]*|дал[а-я]*|попросил[а-я]*|пытал[а-я]*|начал[а-я]*|остановил[а-я]*|продавал[а-я]*|купил[а-я]*)");
  const concreteScene=positiveIncident&&has("возле|рядом|около|в\\s+(?:магазине|банке|гараже|воде)|на\\s+(?:рынке|парковке|автобусе)");
  if((decision.events?.some(e=>(e.kind==="incident"&&!e.negated)||e.kind==="reported-speech")||decision.ruleId==="route.case-evidence"||decision.topic==="Жалоба на игрока")&&!identified&&!linked&&!narrative&&!concreteScene)return ask("player","Укажите ID или ник игрока, на которого жалуетесь.");
  if(words.length<5&&has("прошу|жду|не\\s+согл"))return ask("problem","Какой вопрос или ситуацию нужно рассмотреть?");
  return complete();
}
