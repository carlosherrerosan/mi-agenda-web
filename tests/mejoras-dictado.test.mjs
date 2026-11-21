import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretTaskInput, sortCentersByPending, detectCenter} from '../src/logic.js';

const now=new Date(2026,10,20,21,0);
const examples=[
  ['Revisar pedido de Lugones el miércoles a las 21:30','2026-11-25','21:30',null],
  ['Ponme en agenda personal dentista el lunes a las nueve y media','2026-11-23','09:30','personal'],
  ['Llamar el viernes a las 10','2026-11-27','10:00',null],
  ['Anotar el sábado a las 21 30','2026-11-21','21:30',null],
  ['Anotar el martes a las ocho menos cuarto','2026-11-24','07:45',null],
  ['Agenda de trabajo: revisar el lunes a las 9:15','2026-11-23','09:15','work'],
  ['El 25 de noviembre a las nueve de la noche','2026-11-25','21:00',null],
  ['El 25/11/2026 a las 9 y 30','2026-11-25','09:30',null],
  ['El miércoles a las 25:99','2026-11-25','',null],
];
for(const [input,date,time,area] of examples){
  test(input,()=>assert.deepEqual(interpretTaskInput(input,now),{date,time,area}));
}
test('Los centros con más pendientes aparecen primero, sin alterar los originales',()=>{
  const centers=[{id:'a',name:'Alfa'},{id:'b',name:'Beta'},{id:'c',name:'Centro'}];
  const tasks=[{area:'work',centerId:'c',completedAt:null},{area:'work',centerId:'c',completedAt:null},{area:'work',centerId:'b',completedAt:null},{area:'work',centerId:'a',completedAt:'2026-11-20'}];
  assert.deepEqual(sortCentersByPending(centers,tasks).map(c=>c.id),['c','b','a']);
  assert.deepEqual(centers.map(c=>c.id),['a','b','c']);
});
test('Reconocer centro sin revelar datos privados en el repositorio',()=>{
  assert.equal(detectCenter('Llamar a tienda de Lugones',[{id:'1',name:'Lugones',active:true,aliases:[]}]).status,'matched');
});
