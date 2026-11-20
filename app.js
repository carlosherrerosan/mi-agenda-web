import { detectCenter, extractSimpleSchedule, filterTasksByScope, getTaskContext, isValidDate, isValidTime, localISODate, parseCenterLines, normalize } from './src/logic.js';
import { getMonthGrid, moveMonth, monthLabel, dayLabel, tasksForDay, taskCountsByDay } from './src/calendar.js';
import { parseBackup, serializeBackup } from './src/backup.js';
import { AgendaCloud, createAgendaClient } from './src/cloud-sync.js';

// This application is static: no account, server, analytics or network requests for task data.
// Data remains in the local browser storage; export a backup before changing device/browser.
const STORAGE_KEY = 'mi-agenda-web-local-v1';
let cloud = null;
let cloudStatus = 'Solo en este iPhone.';
const defaultSettings = () => ({start:'08:00',end:'19:00',workDays:[1,2,3,4,5],silenceOutsideWork:true});
const blankData = () => ({tasks:[],centers:[],settings:defaultSettings()});
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const taskSort = (a,b) => (a.date||'0000-00-00').localeCompare(b.date||'0000-00-00')||(a.time||'00:00').localeCompare(b.time||'00:00');
const $ = id => document.getElementById(id);
let data = blankData();
let storageReadError = false;
let storageWriteError = false;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if(saved) data = parseBackup(saved);
} catch(error) {
  storageReadError = true;
  console.error('No se pudieron leer los datos locales',error);
}
const ui = {tab:'today',todayArea:'all',todayCenter:'',workCenter:'',calendarArea:'work',calendarMonth:localISODate(new Date()).slice(0,7),calendarDay:localISODate(new Date()),showCompleted:false,message:''};
const titles={today:'Hoy',work:'Trabajo',personal:'Personal',calendar:'Calendario',centers:'Mis centros',settings:'Ajustes'};
const week=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

function save(){
  if(storageReadError) { ui.message='No se guardaron cambios: primero recupera una copia válida.'; return false; }
  try { localStorage.setItem(STORAGE_KEY,serializeBackup(data)); storageWriteError=false; return true; }
  catch(error){storageWriteError=true;ui.message='No se pudieron guardar los datos en este dispositivo. Exporta una copia y revisa el almacenamiento.';console.error(error);return false;}
}
function change(mutator){
  const before=structuredClone(data);
  mutator();
  if(!save()){data=before;render();return;}
  try {cloud?.onLocalChange(before,data);} catch(error){
    data=before;save();ui.message=error.message;
  }
  render();
}
function centerName(id){return data.centers.find(c=>c.id===id)?.name??'Centro no disponible';}
function pill(label,active,action,extras=''){return `<button type="button" class="chip ${active?'active':''}" data-action="${action}" ${extras}>${esc(label)}</button>`;}
function tasksHtml(tasks,empty='No hay tareas en esta sección.'){
  if(!tasks.length)return `<p class="empty">${esc(empty)}</p>`;
  return tasks.map(t=>{
    const done=Boolean(t.completedAt),context=getTaskContext(t,data.centers);
    const when=[t.date||'Sin fecha',t.time].filter(Boolean).join(' · ');
    return `<article class="task-card ${t.area==='personal'?'personal':''}">
      <button type="button" class="task-check ${done?'done':''}" aria-label="${done?'Marcar pendiente':'Marcar completada'}: ${esc(t.title)}" aria-pressed="${done}" data-action="toggle-task" data-id="${esc(t.id)}">${done?'✓':''}</button>
      <div class="task-body"><div class="task-name ${done?'done':''}">${esc(t.title)}</div><div class="task-context">${esc(context)}</div><div class="task-meta">${esc(when)}</div></div>
      <button type="button" class="delete-btn" aria-label="Eliminar tarea ${esc(t.title)}" data-action="delete-task" data-id="${esc(t.id)}">×</button>
    </article>`;
  }).join('');
}
function section(title,tasks,empty){return `<section class="section"><div class="section-head"><div class="section-title">${esc(title)} <span class="count">(${tasks.length})</span></div></div>${tasksHtml(tasks,empty)}</section>`;}
function todayView(){
  const today=localISODate(new Date());
  const scoped = arr=>filterTasksByScope(arr,ui.todayArea,ui.todayArea==='work'?ui.todayCenter||null:null);
  const due=scoped(data.tasks.filter(t=>!t.completedAt&&(!t.date||t.date<=today)).sort(taskSort));
  const future=scoped(data.tasks.filter(t=>!t.completedAt&&t.date>today).sort(taskSort));
  const completed=scoped(data.tasks.filter(t=>Boolean(t.completedAt)).sort(taskSort));
  const filters=['all','work','personal'].map((x,i)=>pill(['Todas','Trabajo','Personal'][i],ui.todayArea===x,'today-area',`data-value="${x}"`)).join('');
  const centerPills=ui.todayArea==='work'?`<div class="chip-row" aria-label="Filtrar por centro">${pill('Todos los centros',!ui.todayCenter,'today-center','data-id=""')}${pill('Sin centro',ui.todayCenter==='unassigned','today-center','data-id="unassigned"')}${data.centers.map(c=>pill(c.name,ui.todayCenter===c.id,'today-center',`data-id="${esc(c.id)}"`)).join('')}</div>`:'';
  const scope=ui.todayArea==='all'?'Todas las tareas':ui.todayArea==='personal'?'Personal':`Trabajo / ${ui.todayCenter==='unassigned'?'Sin centro':ui.todayCenter?centerName(ui.todayCenter):'Todos los centros'}`;
  return `<div class="hero"><div class="hero-number">${due.length}</div><div><strong>Tareas para hoy</strong><div class="subtle">Incluye atrasadas y sin fecha</div></div></div>
    <div class="subtle">Ver tareas de</div><div class="chip-row" aria-label="Filtrar tareas">${filters}</div>${centerPills}<p class="scope">Hoy / ${esc(scope)}</p>
    ${section('Hoy y pendientes',due)}${section('Próximas',future)}<button type="button" class="text-btn" data-action="completed">${ui.showCompleted?'Ocultar':'Mostrar'} completadas (${completed.length})</button>${ui.showCompleted?section('Completadas',completed):''}`;
}
function workView(){
  const pending=data.tasks.filter(t=>t.area==='work'&&!t.completedAt&&(!ui.workCenter||(ui.workCenter==='unassigned'?!t.centerId:t.centerId===ui.workCenter))).sort(taskSort);
  return `<p class="subtle top-intro">Las tareas se agrupan por centro. Pulsa uno para filtrar.</p><div class="chip-row">${pill('Todos',!ui.workCenter,'work-center','data-id=""')}${pill('Sin centro',ui.workCenter==='unassigned','work-center','data-id="unassigned"')}${data.centers.map(c=>pill(c.name,ui.workCenter===c.id,'work-center',`data-id="${esc(c.id)}"`)).join('')}</div>
    ${section('Pendientes',pending)}<button type="button" class="text-btn" data-action="go-centers">Gestionar mis centros (${data.centers.length})</button>`;
}
function personalView(){return section('Pendientes personales',data.tasks.filter(t=>t.area==='personal'&&!t.completedAt).sort(taskSort));}
function calendarView(){
  const counts=taskCountsByDay(data.tasks,ui.calendarArea);
  const grid=getMonthGrid(ui.calendarMonth).map(cell=>{
    const selected=cell.date===ui.calendarDay;
    const today=cell.date===localISODate(new Date());
    const count=counts[cell.date];
    const dot=count?.pending>0?`<span class="calendar-dot ${ui.calendarArea==='personal'?'personal':''}"></span>`:count?.completed>0?'<span class="calendar-done">✓</span>':'<span class="calendar-space"></span>';
    return `<button type="button" class="calendar-day ${!cell.inMonth?'outside':''} ${selected?'selected':''} ${today?'today':''}" aria-label="${esc(cell.date)}: ${count?.pending??0} pendientes" aria-pressed="${selected}" data-action="calendar-day" data-date="${cell.date}"><span class="day-num">${cell.day}</span>${dot}</button>`;
  }).join('');
  const dayTasks=tasksForDay(data.tasks,ui.calendarDay,ui.calendarArea);
  return `<p class="subtle top-intro">Dos calendarios independientes, con las mismas tareas de tu agenda.</p><div class="chip-row">${pill('Trabajo',ui.calendarArea==='work','calendar-area','data-value="work"')}${pill('Personal',ui.calendarArea==='personal','calendar-area','data-value="personal"')}</div>
    <div class="calendar-bar"><button type="button" class="month-arrow" aria-label="Mes anterior" data-action="month-prev">‹</button><strong>${esc(monthLabel(ui.calendarMonth))}</strong><button type="button" class="month-arrow" aria-label="Mes siguiente" data-action="month-next">›</button></div>
    <div class="calendar-panel"><div class="calendar-grid">${week.map(d=>`<div class="calendar-weekday">${d}</div>`).join('')}${grid}</div></div>
    <div style="text-align:right"><button type="button" class="text-btn" data-action="calendar-today">Ir a hoy</button></div>
    <div class="selected-day-head"><h3>${esc(dayLabel(ui.calendarDay))}</h3><button type="button" class="text-btn" data-action="new-calendar-task">+ Añadir</button></div>
    <p class="subtle">${ui.calendarArea==='work'?'Trabajo · centros asociados':'Tareas personales'}</p>${tasksHtml(dayTasks,'No hay tareas para este día.')}`;
}
function centersView(){
  const pending=data.tasks.filter(t=>t.area==='work'&&!t.completedAt);
  const list=data.centers.map(c=>`<div class="center-row"><strong>${esc(c.name)}</strong><span>${pending.filter(t=>t.centerId===c.id).length} pendientes</span></div>`).join('');
  return `<p class="subtle">Los centros que importes o añadas se guardan únicamente en este dispositivo.</p>
    <div class="hero"><div class="hero-number">${data.centers.length}</div><div><strong>Centros de trabajo</strong><div class="subtle">Organizados en tu agenda</div></div></div>
    <div class="center-list">${list||'<p class="empty">Aún no hay centros. Importa tu copia de Expo Go para recuperar los tuyos.</p>'}</div>
    <div class="panel"><h3>Añadir centros</h3><p class="small-note">Escribe uno por línea. Puedes añadir alias con el formato: Centro | alias1, alias2.</p><label for="center-input">Nuevos centros</label><textarea id="center-input" rows="4" placeholder="Nombre del centro"></textarea><button type="button" class="primary-btn" data-action="add-centers">Añadir centros</button></div>`;
}
function settingsView(){
  const s=data.settings;
  const account=cloud?.account;
  const linked=cloud?.state.linked&&cloud.state.userId===account?.id;
  const cloudPanel=`<div class="panel"><h3>Sincronización privada</h3><p class="subtle" role="status">${esc(cloudStatus)}</p>${account?
    `<p class="small-note">Cuenta: ${esc(account.email||'Identificada')}</p>${linked?
      `<button type="button" class="secondary-btn" data-action="sync-now">Sincronizar ahora</button>`:
      `<button type="button" class="primary-btn" data-action="join-cloud">Unir esta agenda con mi cuenta</button>`}
    <button type="button" class="text-btn" data-action="sign-out">Cerrar sesión</button>`:
    `<p class="small-note">La cuenta es independiente de Apple y no requiere tener el mismo correo configurado en ambos iPhone.</p>
    <button type="button" class="primary-btn" data-action="open-login">Acceder o crear cuenta</button>`}</div>`;
  const days=['L','M','X','J','V','S','D'].map((name,i)=>`<label><input type="checkbox" name="work-day" value="${i+1}" ${s.workDays.includes(i+1)?'checked':''}>${name}</label>`).join('');
  return `${cloudPanel}<div class="notice"><strong>Versión web de prueba</strong>Esta aplicación funciona sin Expo Go, pero todavía <b>no envía recordatorios con la aplicación cerrada</b>. Mantén Expo Go para tus avisos habituales.</div>
    <div class="panel"><h3>Horario laboral</h3><div class="two-col"><div><label for="work-start">Desde</label><input type="time" id="work-start" value="${esc(s.start)}"></div><div><label for="work-end">Hasta</label><input type="time" id="work-end" value="${esc(s.end)}"></div></div>
    <label>Días de trabajo</label><div class="day-checks">${days}</div><div class="toggle-setting"><input type="checkbox" id="work-silence" ${s.silenceOutsideWork?'checked':''}><label for="work-silence">Respetar horario laboral al planificar avisos en la versión nativa</label></div>
    <button type="button" class="secondary-btn" data-action="save-settings">Guardar ajustes</button></div>
    <div class="panel"><h3>Copias de seguridad</h3><p class="subtle">Importa el archivo que guardaste desde Expo Go para traer tus tareas y centros a esta versión. La importación sustituye los datos locales de esta versión web, no los de Expo Go.</p>
    <div class="settings-actions"><button type="button" class="primary-btn" data-action="import-backup">Importar copia de Expo Go</button><button type="button" class="secondary-btn" data-action="export-backup">Descargar copia de esta agenda</button></div>
    <p class="privacy-note">Las copias se guardan en el iPhone. Cuando vincules tu cuenta, las tareas se sincronizarán de forma privada; conserva copias periódicas.</p></div>
    <div class="panel"><h3>Instalación en el iPhone</h3><p class="subtle">Abre esta página en Safari, pulsa Compartir y elige «Añadir a pantalla de inicio». La agenda tendrá su propio icono.</p></div>`;
}
function render(){
  $('page-title').textContent=titles[ui.tab];
  $('page-subtitle').textContent=ui.tab==='today'?dayLabel(localISODate(new Date())):'';
  $('add-task').hidden=ui.tab==='settings'||ui.tab==='centers';
  $('nav').querySelectorAll('button[data-tab]').forEach(b=>{const active=b.dataset.tab===ui.tab;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');});
  const body=({today:todayView,work:workView,personal:personalView,calendar:calendarView,centers:centersView,settings:settingsView})[ui.tab]();
  const issue=storageReadError?'<div class="notice"><strong>Atención</strong>No se pudieron leer los datos de esta instalación. Importa una copia válida antes de crear nuevas tareas.</div>':storageWriteError?'<div class="notice"><strong>Atención</strong>No se pudo guardar. Exporta una copia y comprueba el almacenamiento.</div>':'';
  $('main').innerHTML=`${issue}${ui.message?`<div class="notice" role="status">${esc(ui.message)}</div>`:''}${body}`;
}
function openTask(area=ui.tab==='personal'?'personal':ui.tab==='calendar'?ui.calendarArea:'work',date=ui.tab==='calendar'?ui.calendarDay:''){
  $('task-form').reset();$('task-error').textContent='';$('task-area').value=area;$('task-date').value=date;
  const options=['<option value="">Sin centro</option>',...data.centers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`)];
  $('task-center').innerHTML=options.join('');
  if(ui.tab==='work'&&ui.workCenter&&ui.workCenter!=='unassigned')$('task-center').value=ui.workCenter;
  $('center-hint').textContent='';syncTaskArea();$('task-dialog').showModal();$('task-title').focus();
}
function syncTaskArea(){$('task-center-wrap').hidden=$('task-area').value==='personal';}
function saveTaskFromForm(event){
  event.preventDefault();const title=$('task-title').value.trim(),area=$('task-area').value,centerId=area==='work'?$('task-center').value||null:null;
  const date=$('task-date').value,time=$('task-time').value;
  const error=$('task-error');error.textContent='';
  if(!title){error.textContent='Escribe o dicta una tarea.';return;}
  if(date&&!isValidDate(date)){error.textContent='Fecha no válida.';return;}
  if(time&&!isValidTime(time)){error.textContent='Hora no válida.';return;}
  if(time&&!date){error.textContent='Indica también la fecha.';return;}
  if(area==='work'&&!centerId&&!confirm('Esta tarea quedará en Trabajo sin centro. ¿Guardar igualmente?'))return;
  const task={id:newId(),title,area,centerId,date,time,completedAt:null,createdAt:new Date().toISOString()};
  change(()=>{data.tasks.unshift(task);ui.message='Tarea guardada en este dispositivo.';if(ui.tab==='calendar'&&date){ui.calendarArea=area;ui.calendarMonth=date.slice(0,7);ui.calendarDay=date;}else{ui.tab='today';ui.todayArea='all';ui.todayCenter='';}});
  $('task-dialog').close();
}
function importBackup(){
  if(cloud?.state.linked){$('import-error').textContent='Por seguridad, importa las copias antes de vincular este dispositivo.';return;}
  const raw=$('import-text').value.trim();const error=$('import-error');error.textContent='';
  if(!raw){error.textContent='Elige un archivo o pega el texto de la copia.';return;}
  let restored;
  try{restored=parseBackup(raw);}catch(err){error.textContent=err instanceof Error?err.message:'Copia no válida';return;}
  if(!confirm(`La copia contiene ${restored.tasks.length} tareas y ${restored.centers.length} centros. Sustituirá los datos de ESTA versión web, pero no los de Expo Go. ¿Importar?`))return;
  data={tasks:restored.tasks,centers:restored.centers,settings:restored.settings};
  storageReadError=false;ui.message=`Copia importada: ${data.tasks.length} tareas y ${data.centers.length} centros.`;
  ui.tab='today';ui.todayArea='all';ui.todayCenter='';ui.workCenter='';save();$('import-dialog').close();render();
}
function exportBackup(){
  try{
    const content=serializeBackup(data);
    const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`mi-agenda-copia-${localISODate(new Date())}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
    ui.message='Copia preparada. Comprueba la carpeta Descargas del dispositivo.';render();
  }catch(err){ui.message=`No se pudo crear la copia: ${err.message}`;render();}
}
$('nav').addEventListener('click',event=>{
  const button=event.target.closest('button[data-tab]');if(!button)return;
  ui.tab=button.dataset.tab;ui.message='';render();$('main').scrollTop=0;
});
$('add-task').addEventListener('click',()=>openTask());
$('task-area').addEventListener('change',syncTaskArea);
$('task-title').addEventListener('input',event=>{
  const title=event.target.value;const schedule=extractSimpleSchedule(title);
  if(schedule.date)$('task-date').value=schedule.date;
  if(schedule.time)$('task-time').value=schedule.time;
  const match=detectCenter(title,data.centers);
  if(match.status==='matched'){$('task-center').value=match.matches[0].id;$('center-hint').textContent=`Centro reconocido: ${match.matches[0].name}`;}
  else if(match.status==='ambiguous'){$('task-center').value='';$('center-hint').textContent='Hay varios centros posibles. Selecciona el correcto.';}
  else{$('center-hint').textContent='Puedes elegir un centro manualmente.';}
});
$('task-form').addEventListener('submit',saveTaskFromForm);
$('import-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>10_000_000){$('import-error').textContent='El archivo supera el límite de 10 MB.';return;}
  try{$('import-text').value=await file.text();$('import-error').textContent='';}catch{$('import-error').textContent='No se pudo leer el archivo.';}
});
$('import-confirm').addEventListener('click',importBackup);
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
$('main').addEventListener('click',event=>{
  const btn=event.target.closest('[data-action]');if(!btn)return;
  const action=btn.dataset.action,id=btn.dataset.id??'';
  if(action==='today-area'){ui.todayArea=btn.dataset.value;ui.todayCenter='';ui.message='';render();}
  else if(action==='today-center'){ui.todayCenter=id;render();}
  else if(action==='work-center'){ui.workCenter=id;render();}
  else if(action==='calendar-area'){ui.calendarArea=btn.dataset.value;render();}
  else if(action==='month-prev'||action==='month-next'){ui.calendarMonth=moveMonth(ui.calendarMonth,action==='month-prev'?-1:1);ui.calendarDay=`${ui.calendarMonth}-01`;render();}
  else if(action==='calendar-day'){ui.calendarDay=btn.dataset.date;ui.calendarMonth=ui.calendarDay.slice(0,7);render();}
  else if(action==='calendar-today'){ui.calendarDay=localISODate(new Date());ui.calendarMonth=ui.calendarDay.slice(0,7);render();}
  else if(action==='new-calendar-task'){openTask(ui.calendarArea,ui.calendarDay);}
  else if(action==='completed'){ui.showCompleted=!ui.showCompleted;render();}
  else if(action==='toggle-task'){change(()=>{data.tasks=data.tasks.map(t=>t.id===id?{...t,completedAt:t.completedAt?null:new Date().toISOString()}:t);ui.message='';});}
  else if(action==='delete-task'){
    if(confirm('¿Eliminar esta tarea? Esta acción no se puede deshacer.'))change(()=>{data.tasks=data.tasks.filter(t=>t.id!==id);ui.message='Tarea eliminada.';});
  }
  else if(action==='go-centers'){ui.tab='centers';ui.message='';render();}
  else if(action==='add-centers'){
    const input=$('center-input');const entries=parseCenterLines(input.value);const names=new Set(data.centers.map(c=>normalize(c.name)));
    const fresh=entries.filter(c=>!names.has(normalize(c.name)));
    if(!fresh.length){ui.message='No hay centros nuevos para añadir.';render();return;}
    change(()=>{data.centers.push(...fresh.map(c=>({...c,id:newId(),active:true})));ui.message=`Añadidos ${fresh.length} centros.`;});
  }
  else if(action==='save-settings'){
    const start=$('work-start').value,end=$('work-end').value,days=[...document.querySelectorAll('input[name="work-day"]:checked')].map(e=>Number(e.value));
    if(!isValidTime(start)||!isValidTime(end)||start>=end||!days.length){ui.message='Revisa el horario y selecciona al menos un día.';render();return;}
    change(()=>{data.settings={start,end,workDays:days,silenceOutsideWork:$('work-silence').checked};ui.message='Ajustes guardados.';});
  }
  else if(action==='open-login'){$('login-dialog').showModal();}
  else if(action==='join-cloud')void joinCloud();
  else if(action==='sync-now')void cloud?.sync();
  else if(action==='sign-out')void cloud?.signOut().then(()=>{cloudStatus=cloud.statusText();render();}).catch(e=>{ui.message=e.message;render();});
  else if(action==='import-backup'){$('import-text').value='';$('import-file').value='';$('import-error').textContent='';$('import-dialog').showModal();}
  else if(action==='export-backup')exportBackup();
});

async function joinCloud(){
  if(!cloud)return;
  try{
    const plan=await cloud.previewJoin();
    const count=plan.uploadTasks.length,centers=plan.uploadCenters.length;
    if(!confirm('Se conservarán los datos de ambos dispositivos. Este iPhone aportará '+count+' tareas y '+centers+' centros nuevos. Los registros con el mismo identificador se respetarán tal como están en la nube. ¿Continuar?'))return;
    const result=await cloud.join();
    ui.message='Agenda vinculada: '+result.tasks+' tareas y '+result.centers+' centros.';
  }catch(e){ui.message=e.message;}render();
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const email=$('login-email').value.trim(),password=$('login-password').value;
  const action=event.submitter?.value||'login';
  $('login-error').textContent='';
  if(!cloud){$('login-error').textContent='La conexión todavía no está disponible.';return;}
  try{
    if(action==='signup'){
      const active=await cloud.signUp(email,password);
      $('login-error').textContent=active?'Cuenta creada. Ya puedes vincular tu agenda.':'Revisa el correo para confirmar tu cuenta y después inicia sesión.';
      if(active)$('login-dialog').close();
    }else if(action==='recover'){
      await cloud.recover(email);
      $('login-error').textContent='Si existe la cuenta, recibirás instrucciones en tu correo.';
    }else{
      await cloud.signIn(email,password);
      $('login-dialog').close();
    }
    render();
  }catch(e){$('login-error').textContent=e.message;}
});
async function initializeCloud(){
  try{
    const client=await createAgendaClient();
    cloud=new AgendaCloud({
      client,storage:localStorage,getData:()=>structuredClone(data),
      setData:next=>{
        const checked=parseBackup(serializeBackup(next));
        const previous=data;data=checked;
        if(!save()){data=previous;throw new Error('No se pudo guardar la agenda combinada en este iPhone.');}
        render();
      },
      onStatus:message=>{cloudStatus=message;if(ui.tab==='settings')render();}
    });
    await cloud.refreshAccount();
    if(cloud.account&&cloud.state.linked&&cloud.state.userId===cloud.account.id)await cloud.sync();
  }catch(error){
    console.warn('Mi Agenda: nube no disponible',error);
    cloudStatus='Sin conexión con la nube. La agenda local sigue funcionando.';
  }
  render();
}
window.addEventListener('online',()=>void cloud?.sync());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void cloud?.sync();});
void initializeCloud();
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('Sin modo sin conexión',error));
render();
