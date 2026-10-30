import { ArrowLeft, ArrowRight, GitBranch, MessageCircle, ShieldCheck, Trash2 } from "lucide-react";

const steps = [
  { title: "Пользователь пишет сообщение", text: "Вводит текст и нажимает «Отправить». Запрос поступает на сервер, работающий на ноутбуке.", example: "памагите не магу зайти в акаунт" },
  { title: "Система проверяет заполнение", text: "Пустые сообщения и текст длиннее 2000 символов не принимаются. Исходный текст сохраняется отдельно от исправленного." },
  { title: "Исправляет частые опечатки", text: "Словарь заменяет знакомые ошибки: «памагите» → «помогите», «акаунт» → «аккаунт». Неизвестные слова остаются как есть. Числа, ссылки, код и текст в кавычках не меняются.", example: "Помогите не могу зайти в аккаунт" },
  { title: "Проверяет исправленный текст по правилам", text: "Ищет «помощь», «помогите», «помоги», «помочь» или известную проблему, например «не могу войти», «не работает». Регистр не важен. Фраза «помощь больше не нужна» сама по себе не считается просьбой." },
  { title: "Выбирает очередь и сохраняет", text: "Оригинал, исправленный текст и статус записываются в базу на ноутбуке. «123» остаётся без изменений и попадает в корзину.", branches: true },
  { title: "Показывает результат пользователю", text: "Пользователь видит статус отправки. Если текст изменился, появляется блок «Исправлено» с возможностью раскрыть исходное сообщение." },
  { title: "Администратор принимает решение", text: "В очереди «На проверке» администратор читает исправленный текст и при необходимости раскрывает оригинал. Нажимает «Принять» или «В корзину». Сообщения и решения остаются после обновления страницы." },
];
const examples = [
  ["памагите", "Помогите", "Админу"],
  ["неработает кнопка", "Не работает кнопка", "Админу"],
  ["Не могу войти", "Без изменений", "Админу"],
  ["123", "Без изменений", "В корзину"],
  ["Помощь больше не нужна", "Без изменений", "В корзину"],
];

export default function LogicPage() {
  return <div className="shell">
    <header className="header">
      <a className="brand" href="/" aria-label="На связи — главная"><span className="brand-icon"><MessageCircle size={21} /></span>На связи<span className="brand-dot">.</span></a>
      <a className="nav-link" href="/"><ArrowLeft size={16} />К сообщениям</a>
    </header>
    <main className="logic-main">
      <div className="heading"><span className="section-icon"><GitBranch size={25} /></span><h1>Логика</h1></div>
      <p className="logic-note">Исправление работает по словарю и правилам. ИИ и свободный анализ смысла пока не подключены.</p>
      <ol className="logic-steps" role="list">
        {steps.map((step, index) => <li key={step.title}>
          <span className="step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <div className="step-content"><h2>{step.title}</h2><p>{step.text}</p>
            {step.example && <blockquote>{step.example}</blockquote>}
            {step.branches && <div className="logic-branches">
              <div><ShieldCheck size={18} /><span>Есть подходящее правило<strong>На проверку админу</strong></span></div>
              <div><Trash2 size={18} /><span>Нет подходящего правила<strong>В корзину</strong></span></div>
            </div>}
          </div>
        </li>)}
      </ol>
      <section className="logic-examples" aria-labelledby="examples-heading">
        <h2 id="examples-heading">Примеры</h2>
        <table><thead><tr><th scope="col">Сообщение</th><th scope="col">После исправления</th><th scope="col">Результат</th></tr></thead>
          <tbody>{examples.map(([text, corrected, result]) => <tr key={text}><td>«{text}»</td><td>{corrected}</td><td>{result}</td></tr>)}</tbody>
        </table>
      </section>
      <a className="logic-back" href="/">К сообщениям<ArrowRight size={17} /></a>
    </main>
  </div>;
}
