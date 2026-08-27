/**
 * server/routes/index.js — toda la API en un router.
 *
 * Convención: los endpoints de escritura devuelven el estado ya actualizado,
 * así el frontend no necesita una segunda petición para refrescar.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import * as db from '../db.js';
import {
  computeStats,
  lastWeeks,
  restingForWeek,
  rotationForWeek,
  statusForWeek,
  weekKey,
} from '../../web/src/lib/schedule.js';
import { fetchTricount, settle } from '../tricount.js';
import { buildMonth, monthKey } from '../../web/src/lib/monthly.js';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SNAP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'snapshots');

const router = Router();

/** Todo lo que la UI necesita para pintar, en una sola llamada. */
router.get('/state', (req, res) => {
  const data = db.read();
  const week = req.query.week || weekKey();
  res.json({
    home: data.home,
    people: data.people,
    cleaning: data.cleaning,
    rotation: rotationForWeek(data, week),
    resting: restingForWeek(data, week),
    week,
    tasks: statusForWeek(data, week),
    shopping: data.shopping,
    tricount: {
      ...data.tricount,
      settlements: settle(data.tricount.balances ?? []),
    },
    stats: computeStats(data),
  });
});

router.get('/stats', (req, res) => {
  res.json(computeStats(db.read(), { weeks: Number(req.query.weeks) || 8 }));
});

/** Historial: las últimas N semanas con su desglose. */
router.get('/history', (req, res) => {
  const data = db.read();
  const weeks = lastWeeks(Number(req.query.weeks) || 4);
  res.json(
    weeks
      .map((week) => ({ week, tasks: statusForWeek(data, week) }))
      .reverse()
  );
});

// --------------------------------------------------------------- rotación ---

router.put('/cleaning', async (req, res) => {
  const cleaning = req.body?.cleaning;
  if (!cleaning || !Array.isArray(cleaning.shifts) || !Array.isArray(cleaning.rotation)) {
    return res.status(400).json({ error: 'Se esperaba { cleaning: { shifts, rotation } }' });
  }
  const saved = await db.update((d) => {
    d.cleaning = { ...d.cleaning, ...cleaning };
  });
  res.json({ cleaning: saved.cleaning, rotation: rotationForWeek(saved, weekKey()) });
});

/** La rotación de las próximas N semanas, para que se vea quién viene después. */
router.get('/rotation', (req, res) => {
  const data = db.read();
  const n = Math.min(Number(req.query.weeks) || 6, 26);
  const now = new Date();
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = weekKey(new Date(now.getTime() + i * 7 * 86400000));
    out.push({ week: w, turns: rotationForWeek(data, w), resting: restingForWeek(data, w) });
  }
  res.json(out);
});

// ----------------------------------------------------------------- tareas ---

/** Marca o desmarca una ocurrencia. Idempotente por occId. */
router.post('/tasks/toggle', async (req, res) => {
  const { occId, by, day } = req.body ?? {};
  if (!occId) return res.status(400).json({ error: 'Falta occId' });

  const [shiftId, week, zoneId] = occId.split(':');
  if (!shiftId || !week || !zoneId) {
    return res.status(400).json({ error: 'occId mal formado (se espera turno:semana:zona)' });
  }

  const saved = await db.update((d) => {
    const i = d.completions.findIndex((c) => c.occId === occId);
    if (i >= 0) {
      d.completions.splice(i, 1); // desmarcar
      return;
    }
    const now = new Date();
    const todayISO = ((now.getDay() + 6) % 7) + 1;

    // OJO: guardamos el día en que se MARCA, no el día de vencimiento que
    // viene en el occId. Si no, marcar tarde contaría como hecho a tiempo.
    // Si la semana ya pasó, no hay "hoy" que valga: cuenta como tarde.
    d.completions.push({
      occId,
      shiftId,
      zoneId,
      week,
      day: day ?? (week === weekKey(now) ? todayISO : 8),
      by: by ?? null,
      at: now.toISOString(),
    });
  });

  res.json({ tasks: statusForWeek(saved, week), stats: computeStats(saved) });
});

// ------------------------------------------------------------------- meses ---

/** Qué meses hay disponibles: los congelados + el mes en curso, en vivo. */
router.get('/months', (req, res) => {
  const archived = existsSync(SNAP_DIR)
    ? readdirSync(SNAP_DIR)
        .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
        .map((f) => f.replace('.json', ''))
    : [];

  const current = monthKey();
  const months = [...new Set([...archived, current])].sort().reverse();

  res.json({
    months: months.map((m) => ({
      month: m,
      live: m === current,
      archived: archived.includes(m),
    })),
    current,
  });
});

/**
 * El resumen de un mes. Si está congelado se sirve el fichero tal cual; si es
 * el mes en curso se calcula al vuelo desde db.json.
 */
router.get('/months/:month', (req, res) => {
  const { month } = req.params;
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Formato de mes inválido (YYYY-MM)' });
  }

  const file = join(SNAP_DIR, `${month}.json`);
  const isCurrent = month === monthKey();

  // El mes en curso siempre se calcula en vivo, aunque exista un snapshot
  // viejo: los checks de hoy no estarían dentro.
  if (existsSync(file) && !isCurrent) {
    try {
      return res.json({ ...JSON.parse(readFileSync(file, 'utf8')), live: false });
    } catch (err) {
      return res.status(500).json({ error: `Snapshot ilegible: ${err.message}` });
    }
  }

  res.json(buildMonth(db.read(), month));
});

// ------------------------------------------------------------------ compra ---

router.post('/shopping', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Falta el nombre del producto' });

  const saved = await db.update((d) => {
    d.shopping.unshift({
      id: db.newId('it'),
      name,
      addedBy: req.body?.addedBy ?? null,
      addedAt: new Date().toISOString(),
      bought: false,
      boughtBy: null,
      boughtAt: null,
    });
  });
  res.json({ shopping: saved.shopping });
});

router.patch('/shopping/:id', async (req, res) => {
  const saved = await db.update((d) => {
    const item = d.shopping.find((x) => x.id === req.params.id);
    if (!item) return;
    if (typeof req.body?.name === 'string') item.name = req.body.name.trim();
    if (typeof req.body?.bought === 'boolean') {
      item.bought = req.body.bought;
      item.boughtBy = req.body.bought ? (req.body.by ?? null) : null;
      item.boughtAt = req.body.bought ? new Date().toISOString() : null;
    }
  });
  res.json({ shopping: saved.shopping });
});

router.delete('/shopping/:id', async (req, res) => {
  const saved = await db.update((d) => {
    d.shopping = d.shopping.filter((x) => x.id !== req.params.id);
  });
  res.json({ shopping: saved.shopping });
});

/** Vaciar lo ya comprado. */
router.post('/shopping/clear-bought', async (req, res) => {
  const saved = await db.update((d) => {
    d.shopping = d.shopping.filter((x) => !x.bought);
  });
  res.json({ shopping: saved.shopping });
});

// ------------------------------------------------------------------ gastos ---

/**
 * Sincroniza con Tricount. Si falla NO revienta: guarda el error, marca el
 * snapshot como "stale" y la UI sigue mostrando los últimos datos buenos.
 */
export async function syncTricount({ url } = {}) {
  const current = db.read();
  const target = url || current.tricount?.url;
  if (!target) return { ok: false, error: 'No hay ninguna URL de Tricount configurada' };

  const appId = current.tricount?.appInstallationId ?? randomUUID();

  try {
    const data = await fetchTricount(target, { appId });
    await db.update((d) => {
      d.tricount = {
        ...d.tricount,
        url: target,
        appInstallationId: appId,
        lastSync: data.fetchedAt,
        status: 'ok',
        error: null,
        title: data.title,
        currency: data.currency,
        members: Object.fromEntries(data.members.map((m) => [m.name, m.id])),
        balances: data.balances,
        expenses: data.expenses,
        total: data.total,
      };
    });
    return { ok: true, expenses: data.expenses.length };
  } catch (err) {
    await db.update((d) => {
      d.tricount = {
        ...d.tricount,
        url: target,
        appInstallationId: appId,
        status: d.tricount?.lastSync ? 'stale' : 'error',
        error: err.message,
      };
    });
    return { ok: false, error: err.message };
  }
}

router.post('/expenses/sync', async (req, res) => {
  const result = await syncTricount({ url: req.body?.url });
  const data = db.read();
  res.status(result.ok ? 200 : 502).json({
    ...result,
    tricount: { ...data.tricount, settlements: settle(data.tricount.balances ?? []) },
  });
});

router.put('/expenses/url', async (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  await db.update((d) => {
    d.tricount.url = url;
  });
  const result = await syncTricount({ url });
  const data = db.read();
  res.json({
    ...result,
    tricount: { ...data.tricount, settlements: settle(data.tricount.balances ?? []) },
  });
});

export default router;
