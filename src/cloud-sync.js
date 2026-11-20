/**
 * Mi Agenda: sincronización privada con Supabase.
 * Sin credenciales secretas: la clave publishable solo identifica el proyecto.
 * No envía copias de seguridad a GitHub ni realiza importaciones destructivas.
 */
export const CLOUD_URL = 'https://usnaksgbvpvenxjjwyux.supabase.co';
export const CLOUD_PUBLISHABLE_KEY = 'sb_publishable_eJA9NdxTJlzt5q1ppi2-iA_3iW-UwDt';
export const SYNC_STORAGE_KEY = 'mi-agenda-sync-state-v1';

export function taskToRow(userId, task, deletedAt = null) {
  return {user_id:userId,id:task.id,title:task.title,area:task.area,center_id:task.centerId,
    task_date:task.date,task_time:task.time,completed_at:task.completedAt,
    created_at:task.createdAt,deleted_at:deletedAt};
}
export function centerToRow(userId, center, deletedAt = null) {
  return {user_id:userId,id:center.id,name:center.name,aliases:center.aliases,
    active:center.active,deleted_at:deletedAt};
}
export function settingsToRow(userId, settings) {
  return {user_id:userId,start_time:settings.start,end_time:settings.end,
    work_days:settings.workDays,silence_outside_work:settings.silenceOutsideWork};
}
export function rowToTask(row) {
  return {id:row.id,title:row.title,area:row.area,centerId:row.center_id,
    date:row.task_date,time:row.task_time,completedAt:row.completed_at,createdAt:row.created_at};
}
export function rowToCenter(row) {
  return {id:row.id,name:row.name,aliases:row.aliases,active:row.active};
}
export function rowToSettings(row) {
  return {start:row.start_time,end:row.end_time,workDays:row.work_days,
    silenceOutsideWork:row.silence_outside_work};
}
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const byId = items => new Map(items.map(item=>[item.id,item]));

export function planInitialMerge(local, remote) {
  const remoteTasks=byId(remote.tasks),remoteCenters=byId(remote.centers);
  const uploadTasks=local.tasks.filter(t=>!remoteTasks.has(t.id));
  const uploadCenters=local.centers.filter(c=>!remoteCenters.has(c.id));
  const sharedTasks=local.tasks.filter(t=>remoteTasks.has(t.id)).length;
  const sharedCenters=local.centers.filter(c=>remoteCenters.has(c.id)).length;
  return {
    uploadTasks,uploadCenters,uploadSettings:!remote.settings,
    sharedTasks,sharedCenters,
    merged:{
      tasks:[...remote.tasks.filter(r=>!r.deleted_at).map(rowToTask),...uploadTasks],
      centers:[...remote.centers.filter(r=>!r.deleted_at).map(rowToCenter),...uploadCenters],
      settings:remote.settings?rowToSettings(remote.settings):local.settings,
    },
  };
}

/** Devuelve solo cambios locales, incluidos borrados (tombstones). */
export function diffAgenda(before, after) {
  const changes=[];
  for(const kind of ['tasks','centers']){
    const previous=byId(before[kind]),current=byId(after[kind]);
    for(const [id,value] of current) {
      if(!previous.has(id)||!same(previous.get(id),value)) changes.push({kind,id,value,deletedAt:null});
    }
    for(const [id,value] of previous) {
      if(!current.has(id)) changes.push({kind,id,value,deletedAt:new Date().toISOString()});
    }
  }
  if(!same(before.settings,after.settings)) changes.push({kind:'settings',id:'settings',value:after.settings,deletedAt:null});
  return changes;
}
function emptyRevisions() {return {tasks:{},centers:{},settings:null};}
function blankState() {return {userId:null,linked:false,queue:[],revisions:emptyRevisions()};}
function revisionFor(state, op) {
  return op.kind==='settings'?state.revisions.settings:state.revisions[op.kind]?.[op.id]??null;
}
function setRevision(state,kind,id,updatedAt) {
  if(kind==='settings')state.revisions.settings=updatedAt;
  else state.revisions[kind][id]=updatedAt;
}
function remoteRevision(remote,op) {
  if(op.kind==='settings')return remote.settings?.updated_at??null;
  return remote[op.kind].find(row=>row.id===op.id)?.updated_at??null;
}
function equivalentRemote(op,remote) {
  const row=op.kind==='settings'?remote.settings:remote[op.kind].find(r=>r.id===op.id);
  if(!row)return false;
  if(op.kind==='settings')return same(rowToSettings(row),op.value);
  if(op.deletedAt)return row.deleted_at===op.deletedAt;
  return !row.deleted_at && same(op.kind==='tasks'?rowToTask(row):rowToCenter(row),op.value);
}
function errorMessage(error) {
  return error?.message || 'No se pudo completar la conexión con la nube.';
}

export class AgendaCloud {
  constructor({client,storage,getData,setData,onStatus=()=>{}}) {
    this.client=client;this.storage=storage;this.getData=getData;this.setData=setData;this.onStatus=onStatus;
    this.busy=false;this.generation=0;this.account=null;
    try {
      const saved=JSON.parse(storage.getItem(SYNC_STORAGE_KEY)||'null');
      this.state=saved&&typeof saved==='object'&&Array.isArray(saved.queue)&&saved.revisions? saved:blankState();
    } catch {this.state=blankState();}
    this.status='local';
  }
  statusText() {
    if(this.status==='syncing')return 'Sincronizando cambios…';
    if(this.status==='ready')return 'Sincronizada con tu cuenta privada.';
    if(this.status==='pending')return 'Cambios guardados en el iPhone, pendientes de sincronizar.';
    if(this.status==='conflict')return 'Conflicto entre dispositivos. Los cambios locales están protegidos; no se sobrescribirán.';
    if(this.status==='error')return 'Sin conexión o error de sincronización. Tus tareas siguen guardadas aquí.';
    if(this.account&&!this.state.linked)return 'Sesión iniciada. Falta unir la agenda de este iPhone.';
    return 'Solo en este iPhone. Inicia sesión para sincronizar.';
  }
  notify(status) {this.status=status;this.onStatus(this.statusText());}
  persist() {this.storage.setItem(SYNC_STORAGE_KEY,JSON.stringify(this.state));}
  async refreshAccount() {
    const {data,error}=await this.client.auth.getUser();
    if(error||!data.user){this.account=null;this.notify('local');return null;}
    this.account=data.user;
    if(this.state.userId&&this.state.userId!==data.user.id){
      this.notify('conflict');return data.user;
    }
    this.notify(this.state.linked?'pending':'local');
    return data.user;
  }
  async signIn(email,password) {
    const {error}=await this.client.auth.signInWithPassword({email,password});
    if(error)throw new Error(errorMessage(error));
    await this.refreshAccount();
    if(this.state.linked&&this.state.userId===this.account?.id)await this.sync();
  }
  async signUp(email,password) {
    const {data,error}=await this.client.auth.signUp({
      email,password,options:{emailRedirectTo:'https://carlosherrerosan.github.io/mi-agenda-web/'}
    });
    if(error)throw new Error(errorMessage(error));
    if(data.session)await this.refreshAccount();
    return Boolean(data.session);
  }
  async recover(email) {
    const {error}=await this.client.auth.resetPasswordForEmail(email,{
      redirectTo:'https://carlosherrerosan.github.io/mi-agenda-web/'
    });
    if(error)throw new Error(errorMessage(error));
  }
  async signOut() {
    const {error}=await this.client.auth.signOut();
    if(error)throw new Error(errorMessage(error));
    this.account=null;this.notify('local');
    // Nunca borrar datos locales al cerrar sesión.
  }
  onLocalChange(before,after) {
    if(!this.state.linked||this.account?.id!==this.state.userId)return;
    const operations=diffAgenda(before,after);
    if(!operations.length)return;
    for(const op of operations){
      const existing=this.state.queue.find(q=>q.kind===op.kind&&q.id===op.id);
      op.baseline=existing?existing.baseline:revisionFor(this.state,op);
      this.state.queue=this.state.queue.filter(q=>!(q.kind===op.kind&&q.id===op.id));
      this.state.queue.push(op);
    }
    this.generation++;
    try {this.persist();this.notify('pending');}
    catch {this.notify('error');throw new Error('No se pudo guardar la cola de sincronización en este iPhone.');}
    if(!this.busy&&typeof navigator!=='undefined'&&navigator.onLine!==false)void this.sync();
  }
  async allRows(table) {
    const rows=[];
    for(let start=0;start<20000;start+=500) {
      const {data,error}=await this.client.from(table).select('*').order(table==='agenda_settings'?'user_id':'id').range(start,start+499);
      if(error)throw new Error(errorMessage(error));
      rows.push(...(data||[]));
      if((data||[]).length<500)return rows;
    }
    throw new Error('Hay demasiados registros para una sincronización segura.');
  }
  async fetchRemote() {
    const [tasks,centers,settings]=await Promise.all([
      this.allRows('agenda_tasks'),this.allRows('agenda_centers'),this.allRows('agenda_settings')
    ]);
    return {tasks,centers,settings:settings[0]||null};
  }
  recordRevisions(remote) {
    const revisions=emptyRevisions();
    for(const kind of ['tasks','centers']){
      for(const row of remote[kind])revisions[kind][row.id]=row.updated_at;
    }
    revisions.settings=remote.settings?.updated_at??null;
    this.state.revisions=revisions;
  }
  async uploadRows(kind,items,userId) {
    if(!items.length)return;
    const table=kind==='tasks'?'agenda_tasks':'agenda_centers';
    for(let i=0;i<items.length;i+=100) {
      const batch=items.slice(i,i+100).map(op=>kind==='tasks'
        ?taskToRow(userId,op.value,op.deletedAt):centerToRow(userId,op.value,op.deletedAt));
      const {data,error}=await this.client.from(table).upsert(batch,{onConflict:'user_id,id'}).select('id,updated_at');
      if(error)throw new Error(errorMessage(error));
      for(const row of data||[])setRevision(this.state,kind,row.id,row.updated_at);
      // Si la red falla después de confirmar el lote, los datos siguen en la cola hasta el siguiente intento.
      for(const op of items.slice(i,i+100))this.removeCompleted(op);
      this.persist();
    }
  }
  async uploadSettings(op,userId) {
    const {data,error}=await this.client.from('agenda_settings')
      .upsert(settingsToRow(userId,op.value),{onConflict:'user_id'}).select('updated_at').single();
    if(error)throw new Error(errorMessage(error));
    setRevision(this.state,'settings','settings',data.updated_at);
    this.removeCompleted(op);this.persist();
  }
  removeCompleted(op) {
    this.state.queue=this.state.queue.filter(q=>!(q.kind===op.kind&&q.id===op.id&&same(q.value,op.value)&&q.deletedAt===op.deletedAt));
    const next=this.state.queue.find(q=>q.kind===op.kind&&q.id===op.id);
    if(next)next.baseline=revisionFor(this.state,op);
  }
  async previewJoin() {
    if(!this.account)throw new Error('Inicia sesión primero.');
    if(this.state.userId&&this.state.userId!==this.account.id)throw new Error('Este iPhone conserva datos vinculados a otra cuenta. No se mezclarán.');
    const remote=await this.fetchRemote();
    return planInitialMerge(this.getData(),remote);
  }
  async join() {
    if(this.busy)throw new Error('Ya hay una operación en curso.');
    if(!this.account)throw new Error('Inicia sesión primero.');
    if(this.state.userId&&this.state.userId!==this.account.id)throw new Error('Los datos pertenecen a otra cuenta.');
    if(this.state.linked)throw new Error('Este dispositivo ya está vinculado.');
    this.busy=true;this.notify('syncing');
    try {
      const remote=await this.fetchRemote();
      const plan=planInitialMerge(this.getData(),remote);
      const userId=this.account.id;
      // Primero subir las tareas exclusivas. Ante fallo, no sustituir datos locales.
      await this.uploadRows('centers',plan.uploadCenters.map(value=>({kind:'centers',id:value.id,value,deletedAt:null})),userId);
      await this.uploadRows('tasks',plan.uploadTasks.map(value=>({kind:'tasks',id:value.id,value,deletedAt:null})),userId);
      if(plan.uploadSettings)await this.uploadSettings({kind:'settings',id:'settings',value:this.getData().settings,deletedAt:null},userId);
      const complete=await this.fetchRemote();
      const merged=planInitialMerge(this.getData(),complete).merged;
      this.setData(merged); // Valida y guarda antes de declarar la unión completada.
      this.state.userId=userId;this.state.linked=true;this.state.queue=[];
      this.recordRevisions(complete);this.persist();this.notify('ready');
      return {tasks:merged.tasks.length,centers:merged.centers.length};
    } catch(e) {this.notify('error');throw e;}
    finally {this.busy=false;}
  }
  async sync() {
    if(this.busy||!this.state.linked||!this.account||this.state.userId!==this.account.id)return;
    this.busy=true;this.notify('syncing');
    const startedGeneration=this.generation;
    try {
      const remote=await this.fetchRemote();
      const pending=[...this.state.queue];
      const conflicts=[];
      for(const op of pending) {
        if(equivalentRemote(op,remote)){
          setRevision(this.state,op.kind,op.id,remoteRevision(remote,op));
          this.removeCompleted(op);continue;
        }
        if(op.baseline!==remoteRevision(remote,op))conflicts.push(op);
      }
      if(conflicts.length){
        this.persist();this.notify('conflict');return;
      }
      await this.uploadRows('centers',pending.filter(op=>op.kind==='centers'&&this.state.queue.includes(op)),this.account.id);
      await this.uploadRows('tasks',pending.filter(op=>op.kind==='tasks'&&this.state.queue.includes(op)),this.account.id);
      for(const op of pending.filter(op=>op.kind==='settings'&&this.state.queue.includes(op)))
        await this.uploadSettings(op,this.account.id);
      const latest=await this.fetchRemote();
      this.recordRevisions(latest);this.persist();
      if(this.generation!==startedGeneration||this.state.queue.length){
        this.notify('pending');return;
      }
      const merged=planInitialMerge({tasks:[],centers:[],settings:this.getData().settings},latest).merged;
      this.setData(merged);this.notify('ready');
    } catch(e) {
      console.warn('Mi Agenda: sincronización pendiente',e);
      this.notify('error');
    } finally {
      this.busy=false;
      if(this.state.queue.length&&this.status==='pending'&&typeof navigator!=='undefined'&&navigator.onLine!==false)
        queueMicrotask(()=>void this.sync());
    }
  }
}

/** Carga el SDK únicamente cuando hay conexión: la agenda local funciona sin él. */
export async function createAgendaClient() {
  const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.57.0?bundle');
  return createClient(CLOUD_URL,CLOUD_PUBLISHABLE_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'mi-agenda-private-auth-v1'}
  });
}
