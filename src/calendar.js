/** Calendario local de Mi Agenda. No accede a red ni modifica las tareas. */
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const WEEKDAYS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

function iso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function parseMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mes no válido');
  const [year,number] = month.split('-').map(Number);
  return [year,number-1];
}
export function moveMonth(month, offset) {
  const [year,index] = parseMonth(month);
  if (!Number.isInteger(offset)) throw new Error('Desplazamiento no válido');
  return iso(new Date(year,index+offset,1)).slice(0,7);
}
export function monthLabel(month) {
  const [year,index] = parseMonth(month);
  return `${MONTHS[index]} ${year}`;
}
export function dayLabel(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [y,m,d] = date.split('-').map(Number);
  const parsed = new Date(y,m-1,d);
  if (iso(parsed)!==date) return date;
  return `${WEEKDAYS[parsed.getDay()]}, ${d} de ${MONTHS[m-1]}`;
}
/** Celdas del mes de lunes a domingo, incluyendo días contiguos en gris. */
export function getMonthGrid(month) {
  const [year,index] = parseMonth(month);
  const first = new Date(year,index,1);
  const leading = (first.getDay()+6)%7;
  const days = new Date(year,index+1,0).getDate();
  const count = Math.max(35,Math.ceil((leading+days)/7)*7);
  return Array.from({length:count},(_,i)=>{
    const day = new Date(year,index,1-leading+i);
    return {date:iso(day),day:day.getDate(),inMonth:day.getMonth()===index};
  });
}
/** Tareas de una fecha exacta, incluidas las completadas; sin fecha no se pintan. */
export function tasksForDay(tasks, date, area) {
  return tasks.filter(t=>t.date===date&&t.area===area).sort((a,b)=>
    Number(Boolean(a.completedAt))-Number(Boolean(b.completedAt)) ||
    (a.time||'99:99').localeCompare(b.time||'99:99') ||
    (a.title||'').localeCompare(b.title||'','es')
  );
}
/** Recuento para las marcas del calendario: las completadas no son pendientes. */
export function taskCountsByDay(tasks, area) {
  const counts = Object.create(null);
  for (const task of tasks) {
    if (task.area!==area || !/^\d{4}-\d{2}-\d{2}$/.test(task.date||'')) continue;
    if (!counts[task.date]) counts[task.date]={pending:0,completed:0};
    if (task.completedAt) counts[task.date].completed++;
    else counts[task.date].pending++;
  }
  return counts;
}
