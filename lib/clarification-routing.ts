import {atWord, contextText} from "./game-language.ts";
import type {ClarificationContext} from "./message-types.ts";
import type {RoutingDecision} from "./message-routing.ts";

export function useClarification(decision: RoutingDecision, context?: ClarificationContext): RoutingDecision {
  if(!context||decision.route==="violation"||decision.route==="trash")return decision;
  if(context.parentRoute==="help"&&(decision.route===null||decision.route==="question")){
    return {...decision,route:"help",classification:"report",topic:"Помощь в игре",ruleId:"route.context-help",reason:"Дополнение относится к уже установленной просьбе о помощи; первоначальная просьба сохранена."};
  }
  if(context.parentRoute===null&&context.requestedDetails?.includes("purpose")){
    const answer=contextText(context.answerText).toLowerCase().trim();
    if(/^(?:да|нет|ага|ок|хорошо|не знаю)[\s.!]*$/u.test(answer))return {...decision,route:null,classification:"clarify",topic:"Нужно уточнение",ruleId:"route.context-purpose",reason:"Короткий ответ не объяснил, нужна справка или помощь с ситуацией."};
    if(atWord("объясн[а-я]*|определени[а-я]*|значени[а-я]*|узнать\\s+что\\s+значит").test(answer)&&!atWord("не|помогите|проверьте|накажите").test(answer))return {...decision,route:"question",classification:"report",topic:"Вопрос по игре",ruleId:"route.context-information",reason:"Пользователь уточнил, что требуется объяснение термина."};
  }
  return decision;
}
