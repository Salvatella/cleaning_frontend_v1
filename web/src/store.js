/**
 * web/src/store.js — de dónde salen y a dónde van los datos.
 *
 * Dos modos, misma interfaz para el resto de la app:
 *
 *   SUPABASE  (config.js relleno) — la web es 100% estática. El navegador
 *             habla directamente con Supabase. No hay servidor tuyo.
 *
 *   LOCAL     (config.js vacío)   — contra el Express de siempre, útil para
 *             desarrollar o si prefieres no usar servicios externos.
 *
 * Los turnos, el estado de cada zona y las estadísticas se calculan AQUÍ, en
 * el navegador, con la misma lógica que usaba el servidor (web/src/lib/).
 * Supabase solo guarda hechos: quién marcó qué y cuándo.
 */

import { createClient } from '@supabase/supabase-js';
import { CASA, SUPABASE_ANON_KEY, SUPABASE_URL, useSupabase } from './config.js';
import { lastWeeks, restingForWeek, rotationForWeek, statusForWeek, weekKey } from './lib/schedule.js';
import { buildMonth, monthKey } from './lib/monthly.js';

const sb = useSupabase ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export const modo = useSupabase ? 'supabase' : 'local';

// --------------------------------------------------------------- helpers ---

/** Las filas de Supabase, con la forma que espera la lógica de turnos. */
const toCompletion = (row) => ({
  occId: row.occ_id,
  shiftId: row.shift_id,
  zoneId: row.zone_id,
  week: row.week,
  day: row.day,
  by: row.person,
  at: row.created_at,
});

const toItem = (row) => ({
  id: row.id,
  name: row.name,
  addedBy: row.added_by,
  addedAt: row.created_at,
  bought: row.bought,
  boughtBy: row.bought_by,
  boughtAt: row.bought_at,
});

/**
 * Si Supabase tarda demasiado (red caída, proyecto pausado), no queremos que la
 * app se quede colgada en "Cargando…" para siempre. Cortamos y dejamos que el
 * error suba hasta la pantalla de reintento de App.jsx.
 */
const TIMEOUT_MS = 8000;
function withTimeout(promise, ms = TIMEOUT_MS, label = 'Supabase') {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: sin respuesta tras ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function localRequest(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

// ------------------------------------------------------------------ carga ---

/**
 * Todo lo que la app necesita para pintar. En modo Supabase se arma en el
 * navegador; en modo local lo da el servidor ya masticado.
 */
export async function loadState() {
  if (!useSupabase) return localRequest('/state');

  const [checks, shopping, tricount] = await withTimeout(Promise.all([
    sb.from('checks').select('*'),
    sb.from('shopping').select('*').order('created_at', { ascending: false }),
    loadTricount(),
  ]));

  if (checks.error) throw new Error(`Supabase (checks): ${checks.error.message}`);
  if (shopping.error) throw new Error(`Supabase (compra): ${shopping.error.message}`);

  const db = {
    ...CASA,
    completions: checks.data.map(toCompletion),
    shopping: shopping.data.map(toItem),
    tricount: tricount ?? { url: '', balances: [], expenses: [], total: 0, status: 'never' },
  };

  const week = weekKey();
  const tasks = statusForWeek(db, week);
  const busy = new Set(tasks.map((t) => t.assignee));

  return {
    home: db.home,
    people: db.people,
    cleaning: db.cleaning,
    week,
    tasks,
    resting: db.people.filter((p) => !busy.has(p.id)).map((p) => p.id),
    shopping: db.shopping,
    tricount: db.tricount,
    _db: db, // para calcular meses sin volver a pedir nada
  };
}

/**
 * Los gastos salen de un fichero estático que genera el script mensual.
 * No se llama a Tricount desde el navegador: su API no lo permite (CORS).
 */
async function loadTricount() {
  try {
    const res = await fetch('snapshots/tricount.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ meses ---

export async function loadMonths() {
  if (!useSupabase) return localRequest('/months');

  let archived = [];
  try {
    const res = await fetch('snapshots/index.json', { cache: 'no-cache' });
    if (res.ok) archived = (await res.json()).months ?? [];
  } catch { /* sin snapshots todavía */ }

  const current = monthKey();
  const months = [...new Set([...archived, current])].sort().reverse();
  return {
    months: months.map((m) => ({ month: m, live: m === current, archived: archived.includes(m) })),
    current,
  };
}

export async function loadMonth(month, state) {
  if (!useSupabase) return localRequest(`/months/${month}`);

  // El mes en curso se calcula al vuelo; los cerrados vienen del snapshot.
  if (month !== monthKey()) {
    const res = await fetch(`snapshots/${month}.json`, { cache: 'no-cache' });
    if (res.ok) return { ...(await res.json()), live: false };
  }
  return buildMonth(state._db, month);
}

/** Las últimas N semanas con su desglose, para la tabla de historial. */
export async function loadHistory(weeks = 4, state) {
  if (!useSupabase) return localRequest(`/history?weeks=${weeks}`);
  return lastWeeks(weeks)
    .map((week) => ({ week, tasks: statusForWeek(state._db, week) }))
    .reverse();
}

/** Quién limpia las próximas N semanas. */
export async function loadRotation(weeks = 6, state) {
  if (!useSupabase) return localRequest(`/rotation?weeks=${weeks}`);

  const db = state._db;
  const now = Date.now();
  return Array.from({ length: weeks }, (_, i) => {
    const w = weekKey(new Date(now + i * 7 * 86400000));
    return { week: w, turns: rotationForWeek(db, w), resting: restingForWeek(db, w) };
  });
}

// ----------------------------------------------------------------- checks ---

/** Marca o desmarca una zona. Devuelve los turnos de esa semana ya recalculados. */
export async function toggleZone(occId, person, state) {
  if (!useSupabase) {
    const res = await localRequest('/tasks/toggle', {
      method: 'POST',
      body: { occId, by: person },
    });
    return { tasks: res.tasks };
  }

  const [shiftId, week, zoneId] = occId.split(':');
  const existing = state._db.completions.find((c) => c.occId === occId);

  if (existing) {
    const { error } = await sb.from('checks').delete().eq('occ_id', occId);
    if (error) throw new Error(error.message);
    state._db.completions = state._db.completions.filter((c) => c.occId !== occId);
  } else {
    const now = new Date();
    const todayISO = ((now.getDay() + 6) % 7) + 1;
    // Guardamos el día en que se MARCA, no el de vencimiento: si no, marcar
    // tarde contaría como hecho a tiempo. Semana pasada → 8 (fuera de plazo).
    const row = {
      occ_id: occId,
      shift_id: shiftId,
      zone_id: zoneId,
      week,
      person,
      day: week === weekKey(now) ? todayISO : 8,
    };
    const { error } = await sb.from('checks').insert(row);
    if (error) throw new Error(error.message);
    state._db.completions.push(toCompletion({ ...row, created_at: now.toISOString() }));
  }

  return { tasks: statusForWeek(state._db, week) };
}

// ----------------------------------------------------------------- compra ---

export async function addItem(name, addedBy, state) {
  if (!useSupabase) return localRequest('/shopping', { method: 'POST', body: { name, addedBy } });

  const { data, error } = await sb
    .from('shopping')
    .insert({ name, added_by: addedBy })
    .select()
    .single();
  if (error) throw new Error(error.message);

  state._db.shopping = [toItem(data), ...state._db.shopping];
  return { shopping: state._db.shopping };
}

export async function updateItem(id, patch, state) {
  if (!useSupabase) return localRequest(`/shopping/${id}`, { method: 'PATCH', body: patch });

  const row = {};
  if (typeof patch.name === 'string') row.name = patch.name;
  if (typeof patch.bought === 'boolean') {
    row.bought = patch.bought;
    row.bought_by = patch.bought ? (patch.by ?? null) : null;
    row.bought_at = patch.bought ? new Date().toISOString() : null;
  }

  const { data, error } = await sb.from('shopping').update(row).eq('id', id).select().single();
  if (error) throw new Error(error.message);

  state._db.shopping = state._db.shopping.map((x) => (x.id === id ? toItem(data) : x));
  return { shopping: state._db.shopping };
}

export async function deleteItem(id, state) {
  if (!useSupabase) return localRequest(`/shopping/${id}`, { method: 'DELETE' });

  const { error } = await sb.from('shopping').delete().eq('id', id);
  if (error) throw new Error(error.message);

  state._db.shopping = state._db.shopping.filter((x) => x.id !== id);
  return { shopping: state._db.shopping };
}

export async function clearBought(state) {
  if (!useSupabase) return localRequest('/shopping/clear-bought', { method: 'POST' });

  const { error } = await sb.from('shopping').delete().eq('bought', true);
  if (error) throw new Error(error.message);

  state._db.shopping = state._db.shopping.filter((x) => !x.bought);
  return { shopping: state._db.shopping };
}

// --------------------------------------------------------------- realtime ---

/**
 * Avisa cuando otro cambia algo, para refrescar sin recargar.
 * En modo local no hay realtime: App.jsx hace polling cada 20 s.
 */
/**
 * Sincronizar Tricount solo tiene sentido con el servidor local: su API no se
 * puede llamar desde el navegador (CORS). En modo estático los gastos los
 * genera el script mensual de Python.
 */
export const puedeSincronizarTricount = !useSupabase;

export async function syncExpenses() {
  if (useSupabase) throw new Error('En modo estático los gastos los actualiza el script mensual.');
  return localRequest('/expenses/sync', { method: 'POST' });
}

export async function setTricountUrl(url) {
  if (useSupabase) throw new Error('En modo estático la URL va en el script mensual.');
  return localRequest('/expenses/url', { method: 'PUT', body: { url } });
}

export function subscribe(onChange) {
  if (!useSupabase) return () => {};

  const channel = sb
    .channel('piso')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'checks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping' }, onChange)
    .subscribe();

  return () => sb.removeChannel(channel);
}
