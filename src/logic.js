/** Funciones puras; no leen ni modifican información personal. */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function parseCenterLines(text) {
  const results = [];
  const seen = new Set();
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const [rawName, ...rawAliases] = raw.split('|');
    const name = (rawName ?? '').trim();
    if (!name) continue;
    const key = normalize(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const aliases = rawAliases.join('|').split(',').map(x => x.trim()).filter(Boolean);
    results.push({ name, aliases: [...new Set(aliases.filter(x => normalize(x) !== key))] });
  }
  return results;
}

export function detectCenter(text, centers) {
  const normalized = ` ${normalize(text)} `;
  const matched = [];
  for (const center of centers) {
    if (center.active === false) continue;
    const tokens = [center.name, ...(center.aliases ?? [])];
    const hit = tokens.some(token => {
      const normalizedToken = normalize(token);
      // Ignorar alias demasiado genéricos para evitar asignaciones falsas.
      return normalizedToken.length >= 4 && normalized.includes(` ${normalizedToken} `);
    });
    if (hit) matched.push(center);
  }
  return { status: matched.length === 1 ? 'matched' : matched.length > 1 ? 'ambiguous' : 'none', matches: matched };
}

export function localISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Expresiones relativas del dictado: "en 11 minutos", "dentro de media hora",
 * "en una hora y media". Devuelve minutos, o null si no hay una expresión
 * que podamos interpretar con seguridad.
 */
function relativeMinutes(normalized) {
  const numberWords = {
    un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11,
    doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20,
    treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  };
  const amount = '(\\d{1,4}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|media|medio)';
  const re = new RegExp(`\\b(?:en|dentro de)\\s+${amount}\\s+(minutos?|mins?|horas?)\\b(?:\\s+y\\s+(media|medio|\\d{1,3}\\s+minutos?))?`);
  const match = normalized.match(re);
  if (!match) return null;
  const n = /^\d+$/.test(match[1]) ? Number(match[1]) : numberWords[match[1]];
  const isHour = match[2].startsWith('hora');
  if (match[1] === 'media' || match[1] === 'medio') {
    if (!isHour) return null;
  }
  let total = (match[1] === 'media' || match[1] === 'medio') ? 30 : n * (isHour ? 60 : 1);
  if (match[3]) {
    if (!isHour) return null;
    if (match[3] === 'media' || match[3] === 'medio') total += 30;
    else total += Number(match[3].split(' ')[0]);
  }
  // Evitar programaciones absurdas ante un dictado mal transcrito.
  return Number.isFinite(total) && total >= 1 && total <= 10080 ? total : null;
}

export function extractSimpleSchedule(text, now = new Date()) {
  const n = normalize(text);
  const minutesFromNow = relativeMinutes(n);
  if (minutesFromNow !== null) {
    const target = new Date(now.getTime() + minutesFromNow * 60000);
    // La app guarda HH:MM (sin segundos). Redondeamos hacia arriba para
    // no adelantar el aviso ni convertirlo accidentalmente en pasado.
    if (target.getSeconds() || target.getMilliseconds()) {
      target.setMinutes(target.getMinutes() + 1);
      target.setSeconds(0, 0);
    }
    return {
      date: localISODate(target),
      time: `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`,
    };
  }
  let offset = null;
  if (/\bpasado manana\b/.test(n)) offset = 2;
  else if (/\bmanana\b/.test(n)) offset = 1;
  else if (/\bhoy\b/.test(n)) offset = 0;
  let date = '';
  if (offset !== null) {
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    date = localISODate(target);
  }
  const timeMatch = String(text).toLowerCase().match(/\ba las\s+(\d{1,2})(?::(\d{2})|\s+y\s+media)?\b/);
  let time = '';
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = timeMatch[2] ? Number(timeMatch[2]) : /y\s+media/.test(timeMatch[0]) ? 30 : 0;
    if (hour <= 23 && minute <= 59) time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  return { date, time };
}

export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  const date = new Date(y, m-1, d);
  return date.getFullYear() === y && date.getMonth() === m-1 && date.getDate() === d;
}

export function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Filtro de ámbito y centro, compartido por Hoy, Próximas y Completadas.
 * @param {any[]} tasks
 * @param {string} [area]
 * @param {string|null} [centerId]
 */
export function filterTasksByScope(tasks, area = 'all', centerId = null) {
  return tasks.filter(task => {
    if (area !== 'all' && task.area !== area) return false;
    if (area === 'work' && centerId === 'unassigned') return task.area === 'work' && !task.centerId;
    if (area === 'work' && centerId) return task.area === 'work' && task.centerId === centerId;
    return true;
  });
}

/** Etiqueta inequívoca en Hoy: Tarea / Trabajo / Centro. */
export function getTaskContext(task, centers) {
  if (task.area !== 'work') return 'Personal';
  if (!task.centerId) return 'Trabajo / Sin centro';
  const center = centers.find(c => c.id === task.centerId);
  return `Trabajo / ${center?.name ?? 'Centro no disponible'}`;
}
