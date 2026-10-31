import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processMessageWithTrace} from './message-processing.ts';
const cases: [string,string|null][]=[
 ['На ферме смена зациклилась, сколько ни сдаю урожай, прогресс ноль. Помогите.','help'],
 ['Поясните, для чего нужна медкарта перед трудоустройством?','question'],
 ['Как пригласить соседа в квартиру?','question'],
 ['В квартире посторонний после удаления из списка, проверьте доступ.','help'],
 ['Науқасқа медициналық картаны қалай алуға болады?','question'],
 ['Көлікті қайдан сатып алуға болады?','question'],
 ['Донат келмеді, төлемді тексеріңіздерші.','help'],
 ['Маған көмек керек.','help'],
 ['Скільки коштує ремонт автомобіля?','question'],
 ['Де шукати налаштування камери?','question'],
 ['Не можу завершити замовлення таксі, перевірте його.','help'],
 ['Після евакуації машину не знайти, допоможіть.','help'],
 ['Taklifni qayerdan bekor qilish mumkin?','question'],
 ['Oilaga taklifni qayerdan yuboraman?','question'],
 ['Oilamning xazinasidan pul yo‘qoldi, tekshirib bering.','help'],
 ['Yordam kerak, mashina yo‘qoldi.','help'],
 ['onadan so\'kmadim ДМ',null],
 ['Опять эта штука.',null],
 ['Что такое ДМ? Помогите понять термин.','question'],
 ['Не согласен с наказанием, а не просто спрашиваю что такое ДМ.','help'],
 ['Где мои купленные монеты? Деньги списали, а монет до сих пор нет.','help'],
 ['Де моє авто? Воно зникло після перезапуску сервера.','help'],
 ['Де шукати авто, якщо воно колись зникне?','question'],
];
for(const [text,route]of cases)test(`multilingual purpose: ${text}`,()=>assert.equal(processMessageWithTrace(text).processing.route,route));
