import type { Category, Language, RuleChunk } from './types.ts';

type Copy = { greeting: string; incident: string; evidence: string; missing: string; account: string; payment: string; appeal: string; question: string; help: string; offtopic: string; references: string };
const copy: Record<Exclude<Language, 'und'>, Copy> = {
  ru: {
    greeting: 'Здравствуйте!', incident: 'Описанную вами ситуацию должен проверить администратор. Обращение само по себе не подтверждает нарушение.',
    evidence: 'В обращении указаны вложения; их содержимое автоматически не проверено.', missing: 'Уточните сервер, время происшествия и ID или ник игрока. Если есть доказательства, приложите их к обращению.',
    account: 'Для проверки проблемы с доступом или имуществом нужен сотрудник поддержки. Укажите сервер, ник и время обнаружения проблемы. Не присылайте пароль и коды входа.',
    payment: 'Проблему с платежом должен проверить сотрудник поддержки. Укажите дату, сумму и номер операции; не присылайте полный номер карты, CVV или коды подтверждения. Возврат средств не гарантируется.',
    appeal: 'Обстоятельства решения должен проверить администратор. Укажите сервер, время и уведомление о наказании. До проверки отмена наказания не гарантируется.',
    question: 'Для этого вопроса пока нет проверенного готового ответа. Уточните, о каком действии или правиле идёт речь; ответ подготовит администратор.',
    help: 'Опишите, что произошло, укажите сервер и место в игре. Если проблема продолжается сейчас, сообщите об этом администратору.',
    offtopic: 'Напишите вопрос об игре или опишите проблему, с которой нужна помощь.', references: 'Для проверки администратором подобраны пункты правил: ',
  },
  kk: {
    greeting: 'Сәлеметсіз бе!', incident: 'Сіз сипаттаған жағдайды әкімші тексеруі керек. Өтініштің өзі ереже бұзылғанын дәлелдемейді.',
    evidence: 'Өтініште тіркемелер көрсетілген; олардың мазмұны автоматты түрде тексерілген жоқ.', missing: 'Серверді, оқиға уақытын және ойыншының ID нөмірін немесе лақап атын нақтылаңыз. Дәлелдеріңіз болса, өтінішке тіркеңіз.',
    account: 'Аккаунтқа кіру немесе мүлік мәселесін қолдау қызметінің маманы тексеруі керек. Серверді, лақап атыңызды және мәселені байқаған уақытты көрсетіңіз. Құпиясөз бен кіру кодтарын жібермеңіз.',
    payment: 'Төлем мәселесін қолдау қызметінің маманы тексеруі керек. Күнін, сомасын және операция нөмірін көрсетіңіз. Картаның толық нөмірін, CVV немесе растау кодтарын жібермеңіз. Ақшаның қайтарылуына кепілдік берілмейді.',
    appeal: 'Әкімші шешімнің мән-жайын тексеруі керек. Серверді, уақытты және жаза туралы хабарламаны көрсетіңіз. Тексеруге дейін жазаның жойылуына кепілдік берілмейді.',
    question: 'Бұл сұраққа әзірге тексерілген дайын жауап жоқ. Қандай әрекет немесе ереже туралы сұрап тұрғаныңызды нақтылаңыз; жауапты әкімші дайындайды.',
    help: 'Не болғанын, серверді және ойындағы орныңызды көрсетіңіз. Мәселе қазір де жалғасып жатса, әкімшіге хабарлаңыз.',
    offtopic: 'Ойын туралы сұрағыңызды жазыңыз немесе көмек қажет мәселені сипаттаңыз.', references: 'Әкімшінің тексеруі үшін таңдалған ереже тармақтары: ',
  },
  uz: {
    greeting: 'Assalomu alaykum!', incident: "Siz tasvirlagan vaziyatni administrator tekshirishi kerak. Murojaatning o'zi qoida buzilganini isbotlamaydi.",
    evidence: "Murojaatda ilovalar ko'rsatilgan; ularning mazmuni avtomatik tekshirilmagan.", missing: "Server, voqea vaqti va o'yinchining ID raqami yoki nikini aniqlashtiring. Dalillaringiz bo'lsa, murojaatga ilova qiling.",
    account: "Akkauntga kirish yoki mol-mulk muammosini yordam xizmati xodimi tekshirishi kerak. Server, nik va muammoni aniqlagan vaqtni ko'rsating. Parol va kirish kodlarini yubormang.",
    payment: "To'lov muammosini yordam xizmati xodimi tekshirishi kerak. Sana, summa va operatsiya raqamini ko'rsating. Kartaning to'liq raqami, CVV yoki tasdiqlash kodlarini yubormang. Pul qaytarilishi kafolatlanmaydi.",
    appeal: "Administrator qaror holatlarini tekshirishi kerak. Server, vaqt va jazo haqidagi bildirishnomani ko'rsating. Tekshiruvgacha jazo bekor qilinishi kafolatlanmaydi.",
    question: "Bu savol uchun hozircha tekshirilgan tayyor javob yo'q. Qaysi harakat yoki qoida haqida so'rayotganingizni aniqlashtiring; javobni administrator tayyorlaydi.",
    help: "Nima bo'lganini, server va o'yindagi joyingizni yozing. Muammo hozir ham davom etayotgan bo'lsa, administratorga ayting.",
    offtopic: "O'yin haqidagi savolingizni yozing yoki yordam kerak bo'lgan muammoni tasvirlang.", references: "Administrator tekshiruvi uchun tanlangan qoida bandlari: ",
  },
  en: {
    greeting: 'Hello!', incident: 'An administrator needs to review the incident you described. A report alone does not establish a violation.',
    evidence: 'Attachments are listed, but their contents have not been automatically inspected.', missing: 'Please provide the server, time and player ID or nickname. Attach any available evidence.',
    account: 'Support needs to review the access or property issue. Provide your server, nickname and the time you noticed the problem. Do not send passwords or login codes.',
    payment: 'Support needs to review the payment. Provide its date, amount and transaction ID. Do not send full card numbers, CVV or verification codes. A refund is not guaranteed.',
    appeal: 'An administrator needs to review the decision. Provide the server, time and punishment notification. Reversal is not guaranteed.',
    question: 'There is no verified ready answer for this question yet. Please clarify the action or rule; an administrator will prepare a reply.',
    help: 'Describe what happened and provide the server and in-game location. Tell the administrator if the problem is still happening.',
    offtopic: 'Please ask a game-related question or describe the problem you need help with.', references: 'Rule sections selected for administrator review: ',
  },
  es: {
    greeting: '¡Hola!', incident: 'Un administrador debe revisar la situación que describes. La denuncia por sí sola no demuestra una infracción.',
    evidence: 'Se indican archivos adjuntos, pero su contenido no se ha revisado automáticamente.', missing: 'Indica el servidor, la hora y el ID o apodo del jugador. Adjunta las pruebas disponibles.',
    account: 'Soporte debe revisar el problema de acceso o de bienes. Indica el servidor, tu apodo y cuándo detectaste el problema. No envíes contraseñas ni códigos de acceso.',
    payment: 'Soporte debe revisar el pago. Indica la fecha, el importe y el identificador de la operación. No envíes el número completo de la tarjeta, CVV ni códigos. No se garantiza un reembolso.',
    appeal: 'Un administrador debe revisar la decisión. Indica el servidor, la hora y la notificación de la sanción. No se garantiza su anulación.',
    question: 'Todavía no hay una respuesta verificada para esta pregunta. Aclara la acción o regla; un administrador preparará una respuesta.',
    help: 'Describe lo ocurrido e indica el servidor y tu ubicación en el juego. Avisa si el problema continúa.',
    offtopic: 'Escribe una pregunta sobre el juego o describe el problema.', references: 'Apartados seleccionados para revisión del administrador: ',
  },
  pt: {
    greeting: 'Olá!', incident: 'Um administrador precisa verificar a situação descrita. A denúncia por si só não comprova uma infração.',
    evidence: 'Há anexos indicados, mas seu conteúdo não foi verificado automaticamente.', missing: 'Informe o servidor, o horário e o ID ou apelido do jogador. Anexe as provas disponíveis.',
    account: 'O suporte precisa verificar o problema de acesso ou de bens. Informe o servidor, seu apelido e quando percebeu o problema. Não envie senhas nem códigos de acesso.',
    payment: 'O suporte precisa verificar o pagamento. Informe a data, o valor e o identificador da transação. Não envie o número completo do cartão, CVV ou códigos. O reembolso não é garantido.',
    appeal: 'Um administrador precisa verificar a decisão. Informe o servidor, o horário e a notificação da punição. Sua revogação não é garantida.',
    question: 'Ainda não há resposta verificada para esta pergunta. Esclareça a ação ou regra; um administrador preparará uma resposta.',
    help: 'Descreva o ocorrido e informe o servidor e sua localização no jogo. Avise se o problema continua.',
    offtopic: 'Escreva uma pergunta sobre o jogo ou descreva o problema.', references: 'Itens selecionados para análise do administrador: ',
  },
};

export function makeDraft(category: Category, lang: Language, rules: readonly RuleChunk[], evidence: boolean, appeal: boolean) {
  const language = lang === 'und' ? 'ru' : lang;
  const c = copy[language];
  const body = category === 'report.payment' ? c.payment : category === 'report.account' ? c.account : appeal || category === 'complaint.admin' ? c.appeal
    : category === 'report.question' ? c.question : category === 'report.offtopic' ? c.offtopic
      : category.startsWith('complaint.') || category === 'report.complaint' ? `${c.incident} ${evidence ? c.evidence + ' ' : ''}${c.missing}` : c.help;
  const cited = [...new Set(rules.map(rule => rule.ref))];
  return { lang: language, text: `${c.greeting} ${body}${cited.length ? '\n\n' + c.references + rules.map(rule => `${rule.section}, ${rule.ref}`).join('; ') + '.' : ''}`, cited };
}
