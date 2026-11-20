import test from 'node:test';
import assert from 'node:assert/strict';
import {planInitialMerge,diffAgenda,taskToRow,rowToTask,centerToRow,rowToCenter} from '../src/cloud-sync.js';

const settings={start:'08:00',end:'19:00',workDays:[1,2,3,4,5],silenceOutsideWork:true};
const task=(id,title)=>({id,title,area:'personal',centerId:null,date:'',time:'',completedAt:null,createdAt:'2026-11-20T10:00:00.000Z'});
const center=(id,name)=>({id,name,aliases:[],active:true});
const remoteRow=(t)=>({...taskToRow('u',t),updated_at:'2026-11-20T11:00:00Z'});
test('conserva tareas de ambos teléfonos por identificador sin duplicar',()=>{
  const local={tasks:[task('a','Uno'),task('b','Dos')],centers:[center('c','Centro')],settings};
  const remote={tasks:[remoteRow(task('a','Uno')),remoteRow(task('d','Otro'))],centers:[],settings:null};
  const plan=planInitialMerge(local,remote);
  assert.deepEqual(plan.uploadTasks.map(x=>x.id),['b']);
  assert.deepEqual(plan.merged.tasks.map(x=>x.id),['a','d','b']);
  assert.equal(plan.uploadSettings,true);
});
test('no resucita una tarea eliminada en la nube con mismo ID',()=>{
  const local={tasks:[task('a','Antigua')],centers:[],settings};
  const remote={tasks:[{...remoteRow(task('a','Antigua')),deleted_at:'2026-11-20T12:00:00Z'}],centers:[],settings:null};
  assert.deepEqual(planInitialMerge(local,remote).merged.tasks,[]);
});
test('detecta edición, creación y borrado conservando tombstone',()=>{
  const before={tasks:[task('a','Vieja'),task('b','Borrar')],centers:[],settings};
  const after={tasks:[task('a','Nueva'),task('c','Crear')],centers:[],settings};
  const changes=diffAgenda(before,after);
  assert.equal(changes.length,3);
  assert.equal(changes.find(x=>x.id==='b').deletedAt!==null,true);
  assert.equal(changes.find(x=>x.id==='a').value.title,'Nueva');
});
test('mapea campos sin perder centro ni finalización',()=>{
  const original={...task('x','Visita'),area:'work',centerId:'centro-1',date:'2026-11-25',time:'09:30',completedAt:'2026-11-25T10:00:00Z'};
  assert.deepEqual(rowToTask(taskToRow('u',original)),original);
  assert.deepEqual(rowToCenter(centerToRow('u',center('c','Lugones'))),center('c','Lugones'));
});
