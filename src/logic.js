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

/** Interpretación local de fechas, horas y agenda en órdenes dictadas. */
export function interpretTaskInput(text, now = new Date()) {
  const n = normalize(text);
  const raw = String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const base = extractSimpleSchedule(text, now);
  let { date, time } = base;

  const personal = /\b(?:agenda\s+personal|calendario\s+personal|en\s+personal|para\s+personal|tarea\s+personal)\b/.test(n);
  const work = /\b(?:agenda\s+(?:de\s+)?trabajo|calendario\s+(?:de\s+)?trabajo|agenda\s+laboral|en\s+(?:el\s+)?trabajo|para\s+(?:el\s+)?trabajo|tarea\s+laboral)\b/.test(n);
  const area = personal === work ? null : personal ? 'personal' : 'work';

  const words = {
    cero:0,una:1,uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,
    once:11,doce:12,trece:13,catorce:14,quince:15,dieciseis:16,diecisiete:17,dieciocho:18,
    diecinueve:19,veinte:20,veintiuna:21,veintiuno:21,veintidos:22,veintitres:23
  };
  const timeMatch = raw.match(/\ba\s+las?\s+(\d{1,2}|cero|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuna|veintiuno|veintidos|veintitres)\b(?:(?::|\.)\s*(\d{1,2})|\s+y\s+(media|cuarto|treinta|quince|\d{1,2})|\s+menos\s+cuarto|\s+horas?(?:\s+(\d{1,2}))?|\s+(\d{2})(?!\d))?/);
  if (timeMatch) {
    let hour = /^\d+$/.test(timeMatch[1]) ? Number(timeMatch[1]) : words[timeMatch[1]];
    let minute = 0;
    if (timeMatch[2] !== undefined) minute = Number(timeMatch[2]);
    else if (timeMatch[3] !== undefined) minute = ({media:30,cuarto:15,treinta:30,quince:15})[timeMatch[3]] ?? Number(timeMatch[3]);
    else if (timeMatch[4] !== undefined) minute = Number(timeMatch[4]);
    else if (timeMatch[5] !== undefined) minute = Number(timeMatch[5]);
    if (/\bmenos\s+cuarto\b/.test(timeMatch[0])) { hour = (hour + 23) % 24; minute = 45; }
    const tail = raw.slice(timeMatch.index + timeMatch[0].length);
    const period = tail.match(/^\s+de\s+la\s+(manana|tarde|noche|madrugada)\b/)?.[1];
    if ((period === 'tarde' || period === 'noche') && hour >= 1 && hour <= 11) hour += 12;
    else if (period === 'noche' && hour === 12) hour = 0;
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
      time = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
    }
  }

  if (!date) {
    const months = {enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12};
    const named = n.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/);
    const numeric = raw.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/);
    const day = named ? Number(named[1]) : numeric ? Number(numeric[1]) : null;
    const month = named ? months[named[2]] : numeric ? Number(numeric[2]) : null;
    const year = named ? (named[3] ? Number(named[3]) : null) : numeric ? (numeric[3] ? Number(numeric[3]) : null) : null;
    if (day !== null) {
      const candidate = y => `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      let chosen = candidate(year ?? now.getFullYear());
      if (year === null && isValidDate(chosen) && chosen < localISODate(now)) chosen = candidate(now.getFullYear()+1);
      if (isValidDate(chosen)) date = chosen;
    }
  }

  if (!date) {
    const weekday = n.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
    if (weekday) {
      const days = {lunes:1,martes:2,miercoles:3,jueves:4,viernes:5,sabado:6,domingo:0};
      let offset = (days[weekday[1]] - now.getDay() + 7) % 7;
      const nowTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      if (offset === 0 && ((time && time <= nowTime) || /\b(?:proximo|proxima)\s+(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(n))) offset = 7;
      date = localISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate()+offset));
    }
  }
  return {date, time, area};
}

/** Centros con más tareas pendientes primero; después, orden alfabético. */
export function sortCentersByPending(centers, tasks) {
  const counts = new Map();
  for (const task of tasks) {
    if (task.area === 'work' && !task.completedAt && task.centerId) {
      counts.set(task.centerId, (counts.get(task.centerId) ?? 0) + 1);
    }
  }
  return [...centers].sort((a,b) => {
    const ac = counts.get(a.id) ?? 0, bc = counts.get(b.id) ?? 0;
    return Number(bc > 0) - Number(ac > 0) || bc - ac || a.name.localeCompare(b.name,'es',{sensitivity:'base'});
  });
}
