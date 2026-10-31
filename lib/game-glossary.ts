// Meanings checked against the official Grand Mobile Help Center on 2026-10-31.
// Aliases and KK/UZ translations are editorial additions, not official localization.
// This is a scoped support glossary, not an exhaustive list or a punishment table.
export type GameGlossaryEntry = { term: string; aliases: string[]; ru: string; kk: string; uz: string; source: string };

const terms = "https://support.grnd.gg/ru/articles/12974307-vi-термины-и-их-описание";
const sanctions = "https://support.grnd.gg/ru/articles/11071819-обжалование-санкций";
const gameplay = "https://support.grnd.gg/ru/articles/12974302-v-правила-игрового-процесса";
const administration = "https://support.grnd.gg/ru/articles/12974298-iii-правила-взаимодействия-с-администрацией-сервера";
const accounts = "https://support.grnd.gg/ru/articles/12974300-iv-правила-пользования-игровыми-аккаунтами-и-персонажами";
const gangs = "https://support.grnd.gg/ru/articles/11792164-криминальные-организации";
const fishing = "https://support.grnd.gg/ru/articles/14323371-большой-улов-новый-ивент-и-работа-рыбалка";
const launcher = "https://support.grnd.gg/ru/articles/13234161-обновление-лаунчера-grand-mobile";
const crashes = "https://support.grnd.gg/ru/articles/12802300-что-делать-если-вылетает-игра";
const levels = "https://support.grnd.gg/ru/articles/12802736-как-повысить-игровой-уровень";
const family = "https://support.grnd.gg/ru/collections/18442730-семья";
const races = "https://support.grnd.gg/ru/articles/12666314-уличные-гонки-уже-в-grand-mobile";

export const GAME_GLOSSARY: GameGlossaryEntry[] = [
  { term: "RP", aliases: ["рп", "roleplay", "role play", "ролеплей", "отыгровка"], ru: "Ролевая игра", kk: "Рөлдік ойын", uz: "Rolli o‘yin", source: terms },
  { term: "IC", aliases: ["ик", "in character"], ru: "Сведения персонажа", kk: "Кейіпкер білетін ақпарат", uz: "Qahramon biladigan ma’lumot", source: terms },
  { term: "OOC", aliases: ["оос", "out of character"], ru: "Внеролевые сведения игрока", kk: "Ойыншының рөлден тыс ақпараты", uz: "O‘yinchining roldan tashqari ma’lumoti", source: terms },
  { term: "MG", aliases: ["мг", "metagaming", "метагейминг"], ru: "Перенос OOC-сведений в IC", kk: "OOC-ақпаратты IC-де қолдану", uz: "OOC-ma’lumotni IC-da qo‘llash", source: terms },
  { term: "NonRP", aliases: ["нонрп", "нон рп", "non rp", "non-rp", "nrp", "нрп"], ru: "Нарушение ролевой логики", kk: "Рөлдік қисынды бұзу", uz: "Rolli mantiqni buzish", source: terms },
  { term: "PG", aliases: ["пг", "powergaming", "павергейминг", "повергейминг"], ru: "Преувеличение возможностей персонажа", kk: "Кейіпкер мүмкіндігін асыру", uz: "Qahramon imkoniyatlarini oshirib ko‘rsatish", source: terms },
  { term: "DM", aliases: ["дм", "deathmatch", "дмят", "дмит", "дмил", "дмить", "дмятменя", "менядмят"], ru: "Убийство/попытка без RP-причины", kk: "Рөлдік себепсіз өлтіру/әрекет", uz: "RP sababisiz o‘ldirish/urinish", source: terms },
  { term: "Mass DM", aliases: ["масс дм", "массдм", "massdm", "мдм"], ru: "Массовый DM", kk: "Жаппай DM", uz: "Ommaviy DM", source: terms },
  { term: "Mass DM GZ", aliases: ["масс дм зз", "mass dm gz", "массовый дм в зз"], ru: "Массовый DM в безопасной зоне", kk: "Қауіпсіз аймақтағы жаппай DM", uz: "Xavfsiz hududdagi ommaviy DM", source: terms },
  { term: "DB", aliases: ["дб", "driveby", "drive by", "дбшит", "дбшитменя", "дбшат", "дбшит меня", "dbku", "таран"], ru: "Безосновательное убийство/таран транспортом", kk: "Көлікпен негізсіз өлтіру/соғу", uz: "Transport bilan asossiz o‘ldirish/urish", source: terms },
  { term: "SK", aliases: ["ск", "spawnkill", "spawn kill", "спавнкилл", "спавнкил", "скшит"], ru: "Убийство/попытка на спавне", kk: "Пайда болғанда өлтіру/әрекет", uz: "Paydo bo‘lganda o‘ldirish/urinish", source: terms },
  { term: "Mass SK", aliases: ["масс ск", "массск", "masssk"], ru: "Массовый SK", kk: "Жаппай SK", uz: "Ommaviy SK", source: terms },
  { term: "RK", aliases: ["рк", "revengekill", "revenge kill", "ркшит"], ru: "Месть/возвращение после смерти", kk: "Өлгеннен кейін кек/қайту", uz: "O‘limdan keyin qasos/qaytish", source: terms },
  { term: "TK", aliases: ["тк", "teamkill", "team kill", "тимкилл", "тимкил"], ru: "Убийство/попытка внутри организации/семьи", kk: "Ұйым/отбасы мүшесін өлтіру/әрекет", uz: "Tashkilot/oila a’zosini o‘ldirish/urinish", source: terms },
  { term: "GZ", aliases: ["зз", "zz", "ззда", "zzda", "green zone", "гз", "зелёнка", "зеленка", "зелёная зона", "зеленая зона"], ru: "Зелёная безопасная зона; контекст важен", kk: "Жасыл қауіпсіз аймақ; контекст маңызды", uz: "Yashil xavfsiz hudud; kontekst muhim", source: terms },
  { term: "Ban", aliases: ["бан", "забанили", "забанен", "баним", "banim", "ban berishdi", "блокировка"], ru: "Блокировка персонажа/аккаунта", kk: "Кейіпкерді/аккаунтты бұғаттау", uz: "Qahramon/akkauntni bloklash", source: sanctions },
  { term: "Jail", aliases: ["джайл", "джаил", "джейл", "деморган", "demorgan", "дмг", "админ тюрьма"], ru: "Административное заключение персонажа", kk: "Кейіпкерді әкімшілік қамау", uz: "Qahramonni ma’muriy qamash", source: sanctions },
  { term: "Mute", aliases: ["мут", "замутили", "замутил", "mute berdi", "мут берді"], ru: "Ограничение текстового/голосового чата", kk: "Мәтіндік/дауыстық чатты шектеу", uz: "Matnli/ovozli chatni cheklash", source: sanctions },
  { term: "Warn", aliases: ["варн", "варны", "varn", "varnim", "пред", "предупреждение"], ru: "Предупреждение с ограничениями", kk: "Шектеулері бар ескерту", uz: "Cheklovli ogohlantirish", source: sanctions },
  { term: "Апелляция", aliases: ["апелляция", "обжалование", "разбан", "разбаньте", "снять бан", "unban", "размут", "unmute", "banimni yeching"], ru: "Просьба пересмотреть наказание", kk: "Жазаны қайта қарау өтініші", uz: "Jazoni qayta ko‘rish iltimosi", source: sanctions },
  { term: "Амнистия", aliases: ["амнистия", "амнистируйте", "amnistiya"], ru: "Снятие/смягчение наказания администрацией", kk: "Әкімшіліктің жазаны жоюы/жеңілдетуі", uz: "Ma’muriyatning jazoni bekor qilishi/yengillatishi", source: sanctions },
  { term: "Чит", aliases: ["чит", "читы", "читер", "cheat", "cheater", "cheat ishlatyapti", "чит қолданады"], ru: "Стороннее ПО для игрового преимущества", kk: "Ойында артықшылық беретін бөгде бағдарлама", uz: "O‘yinda ustunlik beruvchi tashqi dastur", source: gameplay },
  { term: "Багоюз", aliases: ["багоюз", "багюз", "bug abuse", "bugabuse", "эксплойт", "exploit"], ru: "Использование ошибки ради преимущества", kk: "Қатені артықшылық үшін пайдалану", uz: "Xatodan ustunlik uchun foydalanish", source: gameplay },
  { term: "AFK", aliases: ["афк", "afk", "афкашит", "в афк"], ru: "Игрок отошёл/не участвует", kk: "Ойыншы уақытша қатыспайды", uz: "O‘yinchi vaqtincha qatnashmayapti", source: gameplay },
  { term: "Автокликер", aliases: ["автокликер", "автоклик", "autoclicker", "auto clicker"], ru: "Программа автоматических нажатий", kk: "Автоматты басу бағдарламасы", uz: "Avtomatik bosish dasturi", source: gameplay },
  { term: "Макрос", aliases: ["макрос", "макросы", "macro", "makros"], ru: "Автоматизированная последовательность действий", kk: "Автоматтандырылған әрекеттер тізбегі", uz: "Avtomatlashtirilgan harakatlar ketma-ketligi", source: gameplay },
  { term: "Стримснайп", aliases: ["стримснайп", "streamsniping", "stream sniping", "стримснайпер"], ru: "Вмешательство в игру стримера через трансляцию", kk: "Трансляция арқылы стример ойынына араласу", uz: "Translyatsiya orqali strimer o‘yiniga aralashish", source: gameplay },
  { term: "Репорт", aliases: ["репорт", "реп", "report", "репортқа", "reportga"], ru: "Обращение к администрации", kk: "Әкімшілікке жүгіну", uz: "Ma’muriyatga murojaat", source: administration },
  { term: "Оффтоп", aliases: ["оффтоп", "офтоп", "offtop", "offtopic", "off-topic"], ru: "Сообщение не по теме", kk: "Тақырыпқа қатыссыз хабарлама", uz: "Mavzuga aloqasiz xabar", source: administration },
  { term: "Флуд", aliases: ["флуд", "флудит", "флудят", "flood", "спам", "spam"], ru: "Поток повторяющихся/лишних сообщений", kk: "Қайталанатын/артық хабарламалар ағыны", uz: "Takroriy/ortiqcha xabarlar oqimi", source: administration },
  { term: "Mute report", aliases: ["мут репорта", "мут репорт", "репорт мут", "mute report"], ru: "Ограничение отправки репортов", kk: "Репорт жіберуді шектеу", uz: "Report yuborishni cheklash", source: administration },
  { term: "ЖБ", aliases: ["жб", "жбга", "жалоба", "shikoyat", "шикоят", "шағым", "шағымды", "шагым"], ru: "Жалоба на действия/решение", kk: "Әрекетке/шешімге шағым", uz: "Harakat/qaror ustidan shikoyat", source: administration },
  { term: "Скрин", aliases: ["скрин", "скрины", "скриншот", "screenshot", "скриншоты"], ru: "Снимок экрана; доказательство требует проверки", kk: "Экран суреті; дәлелді тексеру қажет", uz: "Ekran rasmi; dalilni tekshirish kerak", source: sanctions },
  { term: "Скам", aliases: ["скам", "скамер", "scam", "scammer", "обман", "кинул", "кинули", "aldadi", "алдады"], ru: "Обман при сделке/передаче имущества", kk: "Мәміледе/мүлік беруде алдау", uz: "Bitimda/mulk topshirishda aldash", source: accounts },
  { term: "RMT", aliases: ["rmt", "рмт", "за реал", "реал", "реальные деньги", "реал пул", "real pul"], ru: "Сделки с игровыми ценностями за реальные деньги", kk: "Ойын құндылықтарын нақты ақшаға саудалау", uz: "O‘yin boyliklarini haqiqiy pulga sotish", source: accounts },
  { term: "Вымогательство", aliases: ["вымогает", "вымогательство", "шантаж", "tovlamachilik", "бопсалау"], ru: "Требование ценностей под угрозой", kk: "Қорқытып құндылықтарды талап ету", uz: "Tahdid bilan boyliklarni talab qilish", source: accounts },
  { term: "Твинк", aliases: ["твинк", "твинки", "twink", "мультиакк", "доп аккаунт", "альт"], ru: "Дополнительный персонаж/аккаунт", kk: "Қосымша кейіпкер/аккаунт", uz: "Qo‘shimcha qahramon/akkaunt", source: accounts },
  { term: "ОПГ", aliases: ["опг", "opg", "группировка"], ru: "Игровая преступная организация", kk: "Ойындағы қылмыстық ұйым", uz: "O‘yindagi jinoiy tashkilot", source: gangs },
  { term: "Фракция", aliases: ["фракция", "фрак", "фракции", "fraction", "fraksiya", "орг", "оргдан", "org", "orgga"], ru: "Игровая организация", kk: "Ойын ұйымы", uz: "O‘yin tashkiloti", source: gangs },
  { term: "Семья", aliases: ["семья", "семью", "семьи", "сімю", "сім'ю", "сімї", "сім'ї", "family", "отбасы", "отбасыға"], ru: "Игровая семья; её участники и имущество", kk: "Ойындағы отбасы; мүшелері мен мүлкі", uz: "O‘yindagi oila; a’zolar va mol-mulk", source: family },
  { term: "Чекпоинт", aliases: ["чекпоинт", "чек-поинт", "checkpoint", "чекпоинты"], ru: "Контрольная точка игрового маршрута или гонки", kk: "Ойын бағытының не жарыстың бақылау нүктесі", uz: "O‘yin yo‘li yoki poygasidagi nazorat nuqtasi", source: races },
  { term: "Стрела", aliases: ["стрела", "стрелы", "забив", "забить стрелу"], ru: "Бой ОПГ за контроль бизнеса", kk: "Бизнес үшін ОПГ шайқасы", uz: "Biznes nazorati uchun OPG jangi", source: gangs },
  { term: "Общак", aliases: ["общак", "общака", "склад опг"], ru: "Общий склад/ресурсы ОПГ", kk: "ОПГ ортақ қоймасы/қорлары", uz: "OPG umumiy ombori/resurslari", source: gangs },
  { term: "Маты", aliases: ["маты", "материалы", "матов", "mats"], ru: "Оружейные материалы; также может означать ругань", kk: "Қару материалдары; боғауыз да болуы мүмкін", uz: "Qurol materiallari; so‘kinish ham bo‘lishi mumkin", source: gangs },
  { term: "GC", aliases: ["gc", "гк", "grand coins", "grand coin", "грандкоины", "коины"], ru: "Платная игровая валюта", kk: "Ақылы ойын валютасы", uz: "Pulli o‘yin valyutasi", source: fishing },
  { term: "Cash", aliases: ["cash", "кэш", "кеш", "наличка"], ru: "Игровые деньги", kk: "Ойын ақшасы", uz: "O‘yin puli", source: fishing },
  { term: "Фарм", aliases: ["фарм", "фармить", "фармлю", "farm", "farming"], ru: "Повторные действия ради ресурсов/дохода", kk: "Табыс/ресурс үшін әрекеттерді қайталау", uz: "Daromad/resurs uchun harakatlarni takrorlash", source: fishing },
  { term: "Бустер", aliases: ["бустер", "booster", "бустеры"], ru: "Временное усиление", kk: "Уақытша күшейту", uz: "Vaqtinchalik kuchaytirish", source: fishing },
  { term: "Кейс", aliases: ["кейс", "кейсы", "case", "keis"], ru: "Контейнер случайных наград", kk: "Кездейсоқ сыйлықтар контейнері", uz: "Tasodifiy mukofotlar konteyneri", source: fishing },
  { term: "Spawn", aliases: ["спавн", "спаун", "респавн", "respawn", "заспавнить"], ru: "Появление/место появления в игре", kk: "Ойында пайда болу/пайда болатын орын", uz: "O‘yinda paydo bo‘lish/paydo bo‘lish joyi", source: launcher },
  { term: "TP", aliases: ["тп", "телепорт", "телепортируйте", "teleport", "тпхните"], ru: "Быстрое перемещение между локациями", kk: "Орындар арасында жылдам ауысу", uz: "Joylar orasida tez ko‘chish", source: fishing },
  { term: "Вылет", aliases: ["вылет", "вылетает", "краш", "crash", "игра закрывается"], ru: "Игра неожиданно закрывается", kk: "Ойын күтпеген жерден жабылады", uz: "O‘yin kutilmaganda yopiladi", source: crashes },
  { term: "FPS", aliases: ["фпс", "фпс просел", "кадры в секунду", "frames per second"], ru: "Частота кадров; не то же, что сетевая задержка", kk: "Кадр жиілігі; желі кідірісі емес", uz: "Kadrlar chastotasi; tarmoq kechikishi emas", source: launcher },
  { term: "UID", aliases: ["уид", "юид", "uid аккаунта", "идентификатор аккаунта"], ru: "Идентификатор аккаунта", kk: "Аккаунт идентификаторы", uz: "Akkaunt identifikatori", source: launcher },
  { term: "Лаунчер", aliases: ["лаунчер", "launcher", "лончер", "запуск игры"], ru: "Приложение/экран запуска и настройки игры", kk: "Ойынды іске қосу және баптау қолданбасы/экраны", uz: "O‘yinni ishga tushirish va sozlash ilovasi/ekrani", source: launcher },
  { term: "Донат", aliases: ["донат", "задонатил", "donat", "донат магазин", "платная покупка"], ru: "Платная игровая покупка/услуга", kk: "Ақылы ойын сатып алуы/қызметі", uz: "Pulli o‘yin xaridi/xizmati", source: levels },
  { term: "PayDay", aliases: ["pay day", "пейдей", "пэйдей", "пд", "зарплата"], ru: "Периодическое начисление опыта и зарплаты", kk: "Тәжірибе мен жалақының мерзімді есептелуі", uz: "Tajriba va maoshning davriy berilishi", source: levels },
  { term: "EXP", aliases: ["exp", "экспа", "опыт", "xp", "эксп"], ru: "Очки опыта для повышения уровня", kk: "Деңгейді көтеруге арналған тәжірибе ұпайлары", uz: "Darajani oshirish uchun tajriba ballari", source: levels },
];
