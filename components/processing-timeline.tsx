import type { Message } from "@/lib/message-types";

export function ProcessingTimeline({ message }: { message: Message }) {
  if (!message.processing) return null;
  const steps: { id: string; title: string; value: string; detail?: string; waiting?: boolean }[] = [...message.processing.steps];
  if (message.processing.classification === "report") {
    steps.push({
      id: "reviewed",
      title: "Решение администратора",
      value: message.status === "pending" ? "Ожидает проверки" : message.status === "accepted" ? "Жалоба принята" : "Администратор отправил в корзину",
      waiting: message.status === "pending",
    });
  }
  return <ol className="logic-steps" aria-label="Этапы обработки">
    {steps.map((step, index) => <li key={step.id} className={step.waiting ? "step-waiting" : undefined}>
      <span className="step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <div className="step-content"><h2>{step.title}</h2><p className="step-value">{step.value}</p>{step.detail && <p className="step-detail">{step.detail}</p>}</div>
    </li>)}
  </ol>;
}
