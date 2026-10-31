import assert from "node:assert/strict";
import {test} from "node:test";
import {understandMessage} from "./message-understanding.ts";
// Targeted semantic fixtures; these are not an estimate of real-world accuracy.
const cases = [
  {
    "source": "Серверді ауыстырғанда код келмейді, ескі нөмірім жоқ.",
    "expectedFragments": [
      "код не приходит",
      "у меня нет старого номера"
    ],
    "forbiddenFragments": [
      "код приходит"
    ],
    "language": "kk",
    "text": "Серверді ауыстырғанда код келмейді, ескі нөмірім жоқ."
  },
  {
    "source": "Кеңседегі компьютерден құпиясөзді ауыстырдым, кейін кіруге тырыстым.",
    "expectedFragments": [
      "я изменил пароль"
    ],
    "forbiddenFragments": [
      "украл пароль"
    ],
    "language": "kk",
    "text": "Кеңседегі компьютерден құпиясөзді ауыстырдым, кейін кіруге тырыстым."
  },
  {
    "source": "Мотоцикл емес, көлігім гараждан шыққанда басқа түсте болды.",
    "expectedFragments": [
      "мой транспорт",
      "из гаража",
      "другого цвета"
    ],
    "forbiddenFragments": [
      "мой транспорт украден"
    ],
    "language": "kk",
    "text": "Мотоцикл емес, көлігім гараждан шыққанда басқа түсте болды."
  },
  {
    "source": "Өзім боямағанмын, бәлкім жарықтан солай көрінеді.",
    "expectedFragments": [
      "сам не красил"
    ],
    "forbiddenFragments": [
      "я покрасил",
      "сам красил"
    ],
    "language": "kk",
    "text": "Өзім боямағанмын, бәлкім жарықтан солай көрінеді."
  },
  {
    "source": "Төлемді үш рет емес, екі рет жасаған сияқтымын.",
    "expectedFragments": [
      "оплату",
      "не три раза",
      "два раза"
    ],
    "forbiddenFragments": [
      "три раза оплатил"
    ],
    "language": "kk",
    "text": "Төлемді үш рет емес, екі рет жасаған сияқтымын."
  },
  {
    "source": "Ол наручникті шештім дейді, бірақ зат ұстай алмай тұрмын.",
    "expectedFragments": [
      "говорит, что снял наручники",
      "не могу держать предмет"
    ],
    "forbiddenFragments": [
      "я снял наручники"
    ],
    "language": "kk",
    "text": "Ол наручникті шештім дейді, бірақ зат ұстай алмай тұрмын."
  },
  {
    "source": "Егер атты өзгертсем, бұрынғы суреттерім қала ма?",
    "expectedFragments": [
      "если изменю имя"
    ],
    "forbiddenFragments": [
      "стрелял",
      "стреляет"
    ],
    "language": "kk",
    "text": "Егер атты өзгертсем, бұрынғы суреттерім қала ма?"
  },
  {
    "source": "Мен ешкімге тимедім, тек есік алдында тұрдым.",
    "expectedFragments": [
      "я никого не трогал"
    ],
    "forbiddenFragments": [
      "я ударил",
      "я трогал"
    ],
    "language": "kk",
    "text": "Мен ешкімге тимедім, тек есік алдында тұрдым."
  },
  {
    "source": "Жолдасымның дауысы жетеді, мені ешкім естімейді.",
    "expectedFragments": [
      "меня никто не слышит"
    ],
    "forbiddenFragments": [
      "меня слышат"
    ],
    "language": "kk",
    "text": "Жолдасымның дауысы жетеді, мені ешкім естімейді."
  },
  {
    "source": "Қалғандары қайда кетті, тек бір сурет қалды ма?",
    "expectedFragments": [
      "куда делись остальные",
      "только один снимок"
    ],
    "forbiddenFragments": [
      "все снимки удалены"
    ],
    "language": "kk",
    "text": "Қалғандары қайда кетті, тек бір сурет қалды ма?"
  },
  {
    "source": "Код запросил дважды, lekn kod kelmayapti на привязанный номер.",
    "expectedFragments": [
      "но",
      "код не приходит"
    ],
    "forbiddenFragments": [
      "код пришёл"
    ],
    "language": "uz",
    "text": "Код запросил дважды, lekn kod kelmayapti на привязанный номер."
  },
  {
    "source": "После покупки pul yechilmadi, а чек пустой.",
    "expectedFragments": [
      "деньги не списались"
    ],
    "forbiddenFragments": [
      "деньги списались"
    ],
    "language": "uz",
    "text": "После покупки pul yechilmadi, а чек пустой."
  },
  {
    "source": "Проверьте журнал: мен пул ўтказмадим, сумму отправлял другой игрок.",
    "expectedFragments": [
      "я не переводил деньги"
    ],
    "forbiddenFragments": [
      "я перевёл деньги"
    ],
    "language": "uz",
    "text": "Проверьте журнал: мен пул ўтказмадим, сумму отправлял другой игрок."
  },
  {
    "source": "Состав фракции пустой: orgdan chiqmadim, lider haydamagan.",
    "expectedFragments": [
      "не выходил из организации",
      "лидер не исключал"
    ],
    "forbiddenFragments": [
      "вышел из организации",
      "лидер исключил"
    ],
    "language": "uz",
    "text": "Состав фракции пустой: orgdan chiqmadim, lider haydamagan."
  },
  {
    "source": "В общем канале ёзаолмаяпман, зато в личку отправляется.",
    "expectedFragments": [
      "не могу писать"
    ],
    "forbiddenFragments": [
      "могу зайти",
      "я написал"
    ],
    "language": "uz",
    "text": "В общем канале ёзаолмаяпман, зато в личку отправляется."
  },
  {
    "source": "Он спорит в чате: u yozdi «верни деньги», men yozmadim это сообщение.",
    "expectedFragments": [
      "он написал",
      "«верни деньги»",
      "я не писал"
    ],
    "forbiddenFragments": [
      "я написал"
    ],
    "language": "uz",
    "text": "Он спорит в чате: u yozdi «верни деньги», men yozmadim это сообщение."
  },
  {
    "source": "Вопрос про дом: qancha turadi аренда на неделю?",
    "expectedFragments": [
      "сколько стоит",
      "аренда на неделю"
    ],
    "forbiddenFragments": [
      "верните деньги"
    ],
    "language": "uz",
    "text": "Вопрос про дом: qancha turadi аренда на неделю?"
  },
  {
    "source": "Alex_yozolmayman 52 /warn: parol xato, а раскладка правильная.",
    "expectedFragments": [
      "Alex_yozolmayman",
      "52",
      "/warn",
      "пароль неверный"
    ],
    "forbiddenFragments": [
      "Alex_не могу писать"
    ],
    "language": "uz",
    "text": "Alex_yozolmayman 52 /warn: parol xato, а раскладка правильная."
  },
  {
    "source": "Старый SIM потерян: эски номерим йўқ, помогите сменить его.",
    "expectedFragments": [
      "старого номера у меня нет"
    ],
    "forbiddenFragments": [
      "номер привязан"
    ],
    "language": "uz",
    "text": "Старый SIM потерян: эски номерим йўқ, помогите сменить его."
  },
  {
    "source": "На скрине ник Sobir: meni sokdi deyapti, so'kinmasam ham, проверьте историю.",
    "expectedFragments": [
      "говорит: «меня оскорбили»",
      "хотя я не ругался",
      "ник Sobir"
    ],
    "forbiddenFragments": [
      "я оскорблял",
      "я оскорбил его",
      "меня оскорбил говорит"
    ],
    "language": "uz",
    "text": "На скрине ник Sobir: meni sokdi deyapti, so'kinmasam ham, проверьте историю."
  },
  {
    "id": "uk-help-dative",
    "text": "Мені потрібна допомога: не можу відкрити багажник.",
    "expectedFragments": [
      "мне",
      "нужна помощь",
      "не могу"
    ],
    "forbiddenFragments": [
      "меня нужна"
    ],
    "language": "uk"
  },
  {
    "id": "uk-source-quote",
    "text": "Він написав «не чіпай мене», а я не казав такого.",
    "expectedFragments": [
      "он написал",
      "не говорил"
    ],
    "preservedFragments": [
      "«не чіпай мене»"
    ],
    "language": "uk"
  },
  {
    "id": "uk-negated-action",
    "text": "Гравець не вбивав, запис є у мене.",
    "expectedFragments": [
      "игрок",
      "не убивал",
      "есть",
      "меня"
    ],
    "forbiddenFragments": [
      "игрок убил"
    ],
    "language": "uk"
  },
  {
    "id": "uk-general-refund",
    "text": "Чи можна повернути гроші за цей набір?",
    "expectedFragments": [
      "можно ли",
      "вернуть",
      "деньги"
    ],
    "language": "uk"
  },
  {
    "id": "uk-joined-inability",
    "text": "Неможу зайти в гру, але пароль приймає.",
    "expectedFragments": [
      "не могу зайти",
      "в игру",
      "но"
    ],
    "language": "uk"
  },
  {
    "id": "uk-ui-negation",
    "text": "Кнопка не тиснеться, хоча гроші вже списало.",
    "expectedFragments": [
      "не нажимается",
      "деньги",
      "уже"
    ],
    "language": "uk"
  },
  {
    "id": "uk-transliterated-source",
    "text": "Vin napysav, shcho ne mozhu zaity, dopomozhit.",
    "expectedFragments": [
      "он написал",
      "что",
      "не могу зайти",
      "помогите"
    ],
    "language": "uk"
  },
  {
    "id": "ru-participle-not-uk",
    "text": "Написав жалобу, я могу не приходить завтра.",
    "expectUnchanged": true,
    "language": "uk"
  },
  {
    "id": "ru-koli-not-uk",
    "text": "Коли уж ушёл, не возвращайся.",
    "expectUnchanged": true,
    "language": "uk"
  },
  {
    "id": "protected-evidence-not-uk",
    "text": "Посмотри ник De_Vin77 и ссылку https://example.test/мені, это /dopomozhit.",
    "expectUnchanged": true,
    "language": "uk"
  },
  {
    "id": "ru-pora",
    "text": "Пора перезапускать сервер, он завис.",
    "expectUnchanged": true
  },
  {
    "id": "ru-pul",
    "text": "Пул игроков для матча пуст, не могу начать.",
    "expectUnchanged": true
  },
  {
    "id": "mixed-uk-ru-participle",
    "text": "після оновлення, написав жалобу, я вышел.",
    "expectedFragments": [
      "после обновления"
    ],
    "preservedFragments": [
      "написав жалобу"
    ]
  },
  {
    "id": "mixed-uk-ru-infinitive",
    "text": "після оновлення я могу не приходить завтра.",
    "expectedFragments": [
      "после обновления"
    ],
    "preservedFragments": [
      "могу не приходить"
    ]
  },
  {
    "id": "mixed-uk-kk-comma",
    "text": "Мені потрібна допомога, мені ұрды.",
    "expectedFragments": [
      "мне нужна помощь",
      "меня ударил"
    ]
  },
  {
    "id": "mixed-uk-kk-sentence",
    "text": "Мені потрібна допомога. мені ұрды.",
    "expectedFragments": [
      "мне нужна помощь",
      "меня ударил"
    ]
  },
  {
    "id": "mixed-uz-english-men",
    "text": "pul kelmadi, в меню написано men vs women.",
    "expectedFragments": [
      "деньги не зачислились"
    ],
    "preservedFragments": [
      "men vs women"
    ]
  },
  {
    "id": "uk-nickname",
    "text": "Мій нік Pora, перевірте його.",
    "expectedFragments": [
      "проверьте"
    ],
    "preservedFragments": [
      "нік Pora"
    ]
  },
  {
    "id": "command-argument",
    "text": "/setnick pul",
    "expectUnchanged": true
  },
  {
    "id": "english-nickname-protected",
    "text": "nickname: Pora",
    "expectUnchanged": true
  },
  {
    "id": "protected-url-quotes",
    "text": "https://example.test/pora «pul kelmadi» `pultushmadi` @men",
    "expectUnchanged": true
  },
  {
    "id": "uz-quoted-source",
    "text": "u yozdi 'pul kelmadi', yordam bering.",
    "expectedFragments": [
      "он написал",
      "помогите"
    ],
    "preservedFragments": [
      "'pul kelmadi'"
    ]
  },
  {
    "id": "uz-positive-negative",
    "text": "pul yechilmadi; pul yechildi.",
    "expectedFragments": [
      "деньги не списались",
      "деньги списались"
    ]
  },
  {
    "id": "uz-cyrillic-negative",
    "text": "пул тушмади, ёрдам беринг.",
    "expectedFragments": [
      "деньги не зачислились",
      "помогите"
    ]
  },
  {
    "id": "uz-glued-negative",
    "text": "pultushmadi",
    "expectedFragments": [
      "деньги не зачислились"
    ]
  },
  {
    "id": "uk-glued-negative",
    "text": "неможузайти",
    "expectedFragments": [
      "не могу зайти"
    ]
  },
  {
    "id": "uk-negation-fragment",
    "text": "Гравець не вбивав і не обзивав.",
    "expectedFragments": [
      "игрок",
      "не убивал",
      "не обзывал"
    ]
  },
  {
    "id": "kk-cancellation",
    "text": "көмек керек емес",
    "expectedFragments": [
      "помощь не нужна"
    ]
  },
  {
    "id": "mixed-uk-uz-separated",
    "text": "Мені потрібна допомога; meni urdi.",
    "expectedFragments": [
      "мне нужна помощь",
      "меня ударил"
    ]
  },
  {
    "id": "english-common-words",
    "text": "No help needed, women and men",
    "expectUnchanged": true
  }
];
const normalize=(text: string)=>text.toLowerCase();
const check=(row: {text:string;expectUnchanged?:boolean;expectedFragments?:string[];preservedFragments?:string[];forbiddenFragments?:string[]},result: string)=>{
 const errors=[];
 if(row.expectUnchanged && result!==row.text)errors.push('changed');
 for(const fragment of [...(row.expectedFragments??[]),...(row.preservedFragments??[])])if(!normalize(result).includes(normalize(fragment)))errors.push(`missing: ${fragment}`);
 for(const fragment of row.forbiddenFragments??[])if(normalize(result).includes(normalize(fragment)))errors.push(`invented: ${fragment}`);
 return errors;
};
for(const [index,row] of cases.entries()) test(`multilingual semantic regression ${index+1}: ${row.text}`,()=>{
 const result=understandMessage(row.text).text;
 assert.deepEqual(check(row,result),[],result);
});
