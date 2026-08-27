/**
 * server/schedule.js — expande el horario en "ocurrencias" y calcula KPIs.
 *
 * Idea central: en db.json solo guardamos HECHOS (el horario y quién marcó qué
 * y cuándo). Todo lo demás — pendientes, retrasos, porcentajes, rachas — se
 * deriva aquí al vuelo. Así nunca hay datos incoherentes que resincronizar.
 */

import {
  addWeeks,
  format,
  getISODay,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  startOfISOWeek,
} from 'date-fns';
import { es } from 'date-fns/locale';

/** "2026-W34" a partir de una fecha. */
export function weekKey(date = new Date()) {
  return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, '0')}`;
}

/** El lunes de esa semana ISO. */
export function weekStart(key) {
  const [year, w] = key.split('-W').map(Number);
  // 4 de enero cae siempre en la semana ISO 1.
  const jan4 = new Date(year, 0, 4);
  return addWeeks(startOfISOWeek(jan4), w - 1);
}

/** Las N semanas hasta `upTo` incluida, de más antigua a más reciente. */
export function lastWeeks(n, upTo = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(weekKey(addWeeks(upTo, -i)));
  return out;
}

/** Índice absoluto de semana, para que la rotación avance de forma estable. */
function weekIndex(key) {
  return Math.round(weekStart(key).getTime() / (7 * 24 * 3600 * 1000));
}

const DAY_NAMES = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DAY_SHORT = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export { DAY_NAMES, DAY_SHORT };

/**
 * Quién limpia esta semana. Dos turnos por semana, tres personas: cada uno
 * hace dos turnos cada tres semanas y descansa uno. La rotación avanza sola
 * a partir de `anchorWeek`, sin que nadie tenga que tocar nada.
 *
 *   semana 0 → turno1 Ferran · turno2 Jimmy   (descansa Mel)
 *   semana 1 → turno1 Mel    · turno2 Ferran  (descansa Jimmy)
 *   semana 2 → turno1 Jimmy  · turno2 Mel     (descansa Ferran)
 */
export function rotationForWeek(db, week) {
  const cfg = db.cleaning ?? {};
  const people = cfg.rotation ?? [];
  const shifts = cfg.shifts ?? [];
  if (!people.length || !shifts.length) return [];

  const offset = weekIndex(week) - weekIndex(cfg.anchorWeek || week);
  const n = people.length;

  return shifts.map((shift, i) => {
    const idx = (((offset * shifts.length + i) % n) + n) % n; // % seguro con negativos
    return { shift, assignee: people[idx] };
  });
}

/** Quién libra esta semana (los que no tienen ningún turno). */
export function restingForWeek(db, week) {
  const busy = new Set(rotationForWeek(db, week).map((r) => r.assignee));
  return (db.cleaning?.rotation ?? []).filter((p) => !busy.has(p));
}

/**
 * Convierte la rotación en los turnos concretos de esa semana. Cada turno
 * lleva su propia checklist con TODAS las zonas de la casa: la persona de
 * guardia va marcando las que hace.
 *
 * Los ids son estables (`turno:semana:zona`), así un check sobrevive a que
 * alguien reordene o renombre cosas en la config.
 */
export function occurrencesForWeek(db, week) {
  const zones = db.cleaning?.zones ?? [];

  return rotationForWeek(db, week).map(({ shift, assignee }) => {
    const days = [...(shift.days ?? [])].sort((a, b) => a - b);
    return {
      id: `${shift.id}:${week}`,
      shiftId: shift.id,
      label: shift.label,
      week,
      assignee,
      days,
      dueDay: days[days.length - 1],
      zones: zones.map((z) => ({
        id: `${shift.id}:${week}:${z.id}`,
        zoneId: z.id,
        name: z.name,
      })),
    };
  });
}

/**
 * Turnos + estado, con el detalle zona a zona.
 *
 * Un turno está `done` cuando TODAS sus zonas están marcadas. "A tiempo"
 * significa que la última zona se marcó dentro de la ventana de días; marcar
 * después cuenta como hecho, pero con retraso.
 */
export function statusForWeek(db, week, now = new Date()) {
  const done = new Map();
  for (const c of db.completions ?? []) if (c.week === week) done.set(c.occId, c);

  const currentWeek = weekKey(now);
  const today = getISODay(now);
  const isPast = week < currentWeek;
  const isFuture = week > currentWeek;

  return occurrencesForWeek(db, week).map((occ) => {
    const zones = occ.zones.map((z) => {
      const c = done.get(z.id);
      return c
        ? { ...z, done: true, by: c.by, at: c.at, onTime: c.day == null || c.day <= occ.dueDay }
        : { ...z, done: false, by: null, at: null, onTime: null };
    });

    const doneCount = zones.filter((z) => z.done).length;
    const allDone = zones.length > 0 && doneCount === zones.length;
    const base = { ...occ, zones, doneCount, zoneCount: zones.length };

    if (allDone) {
      const onTime = zones.every((z) => z.onTime);
      const last = zones.map((z) => z.at).filter(Boolean).sort().at(-1);
      return { ...base, status: 'done', onTime, at: last, by: zones.at(-1)?.by ?? null };
    }
    if (isFuture) return { ...base, status: 'upcoming', onTime: null };
    if (isPast) return { ...base, status: 'late', onTime: false, daysLate: null };
    if (today > occ.dueDay) {
      return { ...base, status: 'late', onTime: false, daysLate: today - occ.dueDay };
    }
    return { ...base, status: 'pending', onTime: null };
  });
}

/** KPIs del dashboard. Todo derivado, nada guardado. */
export function computeStats(db, { weeks = 8, now = new Date() } = {}) {
  const keys = lastWeeks(weeks, now);
  const people = db.people ?? [];

  // El grano de medida es la ZONA: un turno con 4 de 5 zonas hechas no es
  // "fallado del todo", y el porcentaje lo refleja.
  const allZones = (week) =>
    statusForWeek(db, week, now)
      .filter((o) => o.status !== 'upcoming')
      .flatMap((o) => o.zones.map((z) => ({ ...z, assignee: o.assignee, dueDay: o.dueDay })));

  const perWeek = keys.map((week) => {
    const zones = allZones(week);
    const doneCount = zones.filter((z) => z.done).length;
    return {
      week,
      total: zones.length,
      done: doneCount,
      pct: zones.length ? Math.round((doneCount / zones.length) * 100) : null,
    };
  });

  const perPerson = people.map((p) => {
    const mine = keys.flatMap(allZones).filter((z) => z.assignee === p.id);
    const onTime = mine.filter((z) => z.done && z.onTime).length;

    // Racha: semanas consecutivas con su turno entero hecho. Las semanas que
    // libra no cuentan ni a favor ni en contra: se saltan.
    let streak = 0;
    for (const w of [...keys].reverse()) {
      const turns = statusForWeek(db, w, now).filter(
        (o) => o.assignee === p.id && o.status !== 'upcoming'
      );
      if (!turns.length) continue;
      if (turns.every((o) => o.status === 'done')) streak++;
      else break;
    }

    return {
      id: p.id,
      name: p.name,
      color: p.color,
      total: mine.length,
      done: mine.filter((z) => z.done).length,
      onTime,
      pct: mine.length ? Math.round((onTime / mine.length) * 100) : null,
      streak,
    };
  });

  // Zonas que más se quedan sin hacer.
  const skipped = {};
  for (const w of keys) {
    for (const z of allZones(w)) {
      if (!z.done) skipped[z.name] = (skipped[z.name] ?? 0) + 1;
    }
  }
  const skippedZones = Object.entries(skipped)
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) => b.count - a.count);

  const thisWeek = statusForWeek(db, weekKey(now), now);
  const active = thisWeek.filter((o) => o.status !== 'upcoming');
  const zonesNow = active.flatMap((o) => o.zones);

  return {
    week: weekKey(now),
    weekLabel: format(weekStart(weekKey(now)), "'Semana' w · d 'de' MMMM", { locale: es }),
    perWeek,
    perPerson,
    skippedZones,
    resting: restingForWeek(db, weekKey(now)),
    current: {
      turns: thisWeek.length,
      turnsDone: thisWeek.filter((o) => o.status === 'done').length,
      total: zonesNow.length,
      done: zonesNow.filter((z) => z.done).length,
      pending: zonesNow.filter((z) => !z.done).length,
      late: thisWeek.filter((o) => o.status === 'late').length,
      pct: zonesNow.length
        ? Math.round((zonesNow.filter((z) => z.done).length / zonesNow.length) * 100)
        : null,
      previousPct: perWeek.at(-2)?.pct ?? null,
    },
    bestStreak: perPerson.reduce((a, b) => (b.streak > (a?.streak ?? -1) ? b : a), null),
  };
}

export { getISODay, parseISO };
