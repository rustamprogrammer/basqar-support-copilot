import {test} from "node:test";
import assert from "node:assert/strict";
import {isSocialOnly} from "./message-trash.ts";
for(const text of ["Hi!","аааа","ладно это шутка","Приятной игры!"])test(`social only: ${text}`,()=>assert.equal(isSocialOnly(text),true));
for(const text of ["Hi help me","Спасибо, не могу зайти","ты идиот, шутка","Здравствуйте, «Connection failed»","Добрый вечер, меня ДМят","Привет /help","bilmadim","Помогите, аа", "в шутку он меня убил"])test(`preserve content: ${text}`,()=>assert.equal(isSocialOnly(text),false));
