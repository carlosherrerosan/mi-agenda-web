/**
 * Copias locales de Mi Agenda.
 * No usa red, no solicita permisos y no modifica datos al exportar.
 */
export const BACKUP_FORMAT = 'mi-agenda-centros-backup';
export const BACKUP_VERSION = 1;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validTask(t) {
  return object(t) && typeof t.id === 'string' && t.id.length > 0 &&
    typeof t.title === 'string' && (t.area === 'work' || t.area === 'personal') &&
    (t.centerId === null || typeof t.centerId === 'string') &&
    typeof t.date === 'string' && typeof t.time === 'string' &&
    (t.completedAt === null || typeof t.completedAt === 'string') &&
    typeof t.createdAt === 'string';
}
function validCenter(c) {
  return object(c) && typeof c.id === 'string' && c.id.length > 0 &&
    typeof c.name === 'string' && c.name.length > 0 &&
    Array.isArray(c.aliases) && c.aliases.every(x => typeof x === 'string') &&
    typeof c.active === 'boolean';
}
function validSettings(s) {
  return object(s) && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(s.end) &&
    Array.isArray(s.workDays) && s.workDays.every(d => Number.isInteger(d) && d >= 1 && d <= 7) &&
    typeof s.silenceOutsideWork === 'boolean';
}
function uniqueIds(items) {
  return new Set(items.map(x => x.id)).size === items.length;
}
export function serializeBackup({tasks, centers, settings}, exportedAt = new Date().toISOString()) {
  const data = {tasks, centers, settings};
  if (!isValidData(data)) throw new Error('Los datos actuales no tienen un formato válido para exportar.');
  return JSON.stringify({format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, data}, null, 2);
}
function isValidData(data) {
  return object(data) && Array.isArray(data.tasks) && data.tasks.length <= 10000 &&
    data.tasks.every(validTask) && uniqueIds(data.tasks) &&
    Array.isArray(data.centers) && data.centers.length <= 1000 &&
    data.centers.every(validCenter) && uniqueIds(data.centers) &&
    validSettings(data.settings);
}
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > 10_000_000) {
    throw new Error('La copia es demasiado grande o no contiene texto válido.');
  }
  let backup;
  try { backup = JSON.parse(text); }
  catch { throw new Error('El texto no es un archivo JSON válido.'); }
  if (!object(backup) || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
    throw new Error('La copia no pertenece a una versión compatible de Mi Agenda.');
  }
  if (!isValidData(backup.data)) {
    throw new Error('La copia está incompleta o contiene datos no válidos.');
  }
  // Recuperar únicamente los campos conocidos, sin confiar en metadatos adicionales.
  const {tasks, centers, settings} = backup.data;
  return {
    tasks: tasks.map(t => ({id:t.id,title:t.title,area:t.area,centerId:t.centerId,date:t.date,time:t.time,completedAt:t.completedAt,createdAt:t.createdAt})),
    centers: centers.map(c => ({id:c.id,name:c.name,aliases:[...c.aliases],active:c.active})),
    settings: {start:settings.start,end:settings.end,workDays:[...settings.workDays],silenceOutsideWork:settings.silenceOutsideWork},
    exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : null,
  };
}
