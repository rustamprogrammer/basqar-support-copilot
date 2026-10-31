import type { ClassificationRun } from "./classifier.ts";
import { BOX_LABELS } from "./box-labels.ts";
import type { ProcessingTrace } from "./message-types.ts";

export function classifiedMessage(original: string, run: ClassificationRun) {
  const text = run.source === "fallback" ? original.trim() : run.result.meaning_ru;
  const detail = run.source === "fallback" ? run.note : run.result.box === "question"
    ? "База готовых ответов пока не подключена. Вопрос передан администратору."
    : run.result.needs_human ? "Требуется ручная проверка или уточнение." : "Обращение направлено в выбранную очередь.";
  const processing: ProcessingTrace = {
    classification: "report", box: run.result.box, ai: run,
    steps: [
      { id: "received", title: "Исходный текст", value: original },
      { id: "corrected", title: "Смысл сообщения", value: text, detail: run.note },
      { id: "classified", title: "Категория", value: BOX_LABELS[run.result.box] },
      { id: "routed", title: "Куда отправлено", value: BOX_LABELS[run.result.box], detail },
    ],
  };
  return { text, status: "pending" as const, originalText: original, processing };
}
