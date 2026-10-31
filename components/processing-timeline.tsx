import type { Message } from "@/lib/message-types";
import { feedbackLabel } from "@/lib/feedback";
import { ROUTING_SCHEMA } from "@/lib/message-routes";

export function ProcessingTimeline({ message }: { message: Message }) {
  if (!message.processing) return null;
  const steps: { id: string; title: string; value: string; detail?: string; waiting?: boolean; parentId?: string }[] = [...message.processing.steps];
  if (message.processing.context) steps.unshift({ id: "clarification", title: "Уточнение пользователя", value: message.processing.context.answerText, parentId: message.processing.context.parentId });
  const automaticFinal = (message.processing.classification === "violation" && message.status === "violation")
    || (message.processing.classification === "trash" && message.status === "trash");
  if (!automaticFinal) {
    steps.push({
      id: "reviewed",
      title: "Решение администратора",
      value: message.status === "violation" ? "Администратор отметил нарушение" : message.status === "pending" ? "Ожидает проверки" : message.status === "accepted" ? "Обращение принято" : "Администратор отправил в корзину",
      waiting: message.status === "pending",
    });
  }
  if (message.feedback) {
    const current = message.feedback.routingSchema === ROUTING_SCHEMA;
    const details = current && typeof message.feedback.needsClarification === "boolean"
      ? message.feedback.needsClarification ? "Уточнение нужно." : "Уточнение не нужно."
      : "Необходимость уточнения не оценена.";
    steps.push({ id: "feedback", title: current ? "Предложенная разметка" : "Прежняя предложенная разметка", value: feedbackLabel(message.feedback), detail: [details, message.feedback.correctedText, message.feedback.note, "Ожидает отдельной проверки правил."].filter(Boolean).join("\n") });
  }
  return <>
    {message.processing.routingSchema !== ROUTING_SCHEMA && <p className="quality-note">Сохранена обработка прежней версии{message.processing.version ? ` (${message.processing.version})` : ""}.</p>}
    <ol className="logic-steps" aria-label="Этапы обработки">
    {steps.map((step, index) => <li key={step.id} className={step.waiting ? "step-waiting" : undefined}>
      <span className="step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <div className="step-content"><h2>{step.title}</h2><p className="step-value">{step.value}</p>{step.parentId && <a className="processing-link" href={`/logic?message=${encodeURIComponent(step.parentId)}`}>Исходное обращение</a>}{step.detail && <p className="step-detail">{step.detail}</p>}</div>
    </li>)}
    </ol>
  </>;
}
