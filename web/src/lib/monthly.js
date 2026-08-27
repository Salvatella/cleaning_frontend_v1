/**
 * server/monthly.js — construye el resumen de un mes con el MISMO formato que
 * genera tools/month_snapshot.py.
 *
 * Por qué existen los dos:
 *   - Python congela los meses ya cerrados en snapshots/YYYY-MM.json (estáticos,
 *     publicables en GitHub Pages sin servidor).
 *   - Este módulo calcula el mes EN CURSO al vuelo, para que el dashboard no
 *     esté vacío hasta que acabe el mes.
 *
 * Ambos deben devolver la misma forma. Si tocas uno, toca el otro.
 */

import { statusForWeek, weekKey } from './schedule.js';

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** "2026-08" → el mes al que pertenece cada semana, por su lunes. */
export function weeksOfMonth(month) {
  const [year, mon] = month.split('-').map(Number);
  const keys = [];
  const d = new Date(year, mon - 1, 1);
  while (d.getMonth() === mon - 1) {
    if (d.getDay() === 1) keys.push(weekKey(d)); // lunes
    d.setDate(d.getDate() + 1);
  }
  return keys;
}

export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function buildMonth(db, month, now = new Date()) {
  const people = db.people ?? [];
  const weeks = weeksOfMonth(month);

  const allTurns = weeks.flatMap((w) => statusForWeek(db, w, now));
  // Las semanas futuras no cuentan: aún no han pasado.
  const counted = allTurns.filter((t) => t.status !== 'upcoming');
  const allZones = counted.flatMap((t) =>
    t.zones.map((z) => ({ ...z, assignee: t.assignee, week: t.week }))
  );

  const total = allZones.length;
  const done = allZones.filter((z) => z.done).length;

  const perPerson = people.map((p) => {
    const mine = allZones.filter((z) => z.assignee === p.id);
    const myTurns = counted.filter((t) => t.assignee === p.id);
    const onTime = mine.filter((z) => z.done && z.onTime).length;
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      zones: mine.length,
      done: mine.filter((z) => z.done).length,
      onTime,
      pct: mine.length ? Math.round((onTime / mine.length) * 100) : null,
      turns: myTurns.length,
      turnsComplete: myTurns.filter((t) => t.status === 'done').length,
    };
  });

  const perWeek = weeks.map((w) => {
    const ts = statusForWeek(db, w, now).filter((t) => t.status !== 'upcoming');
    const zs = ts.flatMap((t) => t.zones);
    const d = zs.filter((z) => z.done).length;
    const busy = new Set(ts.map((t) => t.assignee));
    return {
      week: w,
      total: zs.length,
      done: d,
      pct: zs.length ? Math.round((d / zs.length) * 100) : null,
      turns: ts.map((t) => ({
        assignee: t.assignee,
        label: t.label,
        done: t.doneCount,
        total: t.zoneCount,
      })),
      resting: people.filter((p) => !busy.has(p.id)).map((p) => p.id),
    };
  });

  const skipped = {};
  for (const z of allZones) if (!z.done) skipped[z.name] = (skipped[z.name] ?? 0) + 1;
  const skippedZones = Object.entries(skipped)
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) => b.count - a.count);

  const [year, mon] = month.split('-').map(Number);
  const t = db.tricount ?? {};
  const monthExpenses = (t.expenses ?? []).filter((e) => (e.date ?? '').startsWith(month));

  return {
    month,
    title: `Dashboard de ${MESES[mon]} ${year}`,
    generatedAt: new Date().toISOString(),
    live: month === monthKey(now),
    people,
    cleaning: { zones: db.cleaning?.zones ?? [], shifts: db.cleaning?.shifts ?? [] },
    stats: {
      weeks: weeks.length,
      total,
      done,
      pct: total ? Math.round((done / total) * 100) : null,
      turns: counted.length,
      turnsComplete: counted.filter((x) => x.status === 'done').length,
      perPerson,
      perWeek,
      skippedZones,
    },
    tricount: t.url
      ? {
          title: t.title ?? null,
          currency: t.currency ?? 'EUR',
          syncedAt: t.lastSync,
          monthTotal: Math.round(monthExpenses.reduce((s, e) => s + e.amount, 0) * 100) / 100,
          monthExpenses,
          overallBalances: t.balances ?? [],
          overallTotal: t.total ?? 0,
        }
      : null,
  };
}
