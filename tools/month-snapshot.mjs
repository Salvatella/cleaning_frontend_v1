#!/usr/bin/env node
/**
 * tools/month-snapshot.mjs — cierre de mes.
 *
 *   npm run snapshot                      # el mes que acaba de terminar
 *   npm run snapshot -- --month 2026-08    # un mes concreto
 *   npm run snapshot -- --this-month       # el mes en curso, tal como va
 *   npm run snapshot -- --no-tricount      # solo limpieza, sin tocar gastos
 *
 * Qué hace:
 *   1. Lee los checks de Supabase (o de db.json con --source db).
 *   2. Sincroniza Tricount desde tu máquina — el navegador no puede (CORS).
 *   3. Escribe snapshots/YYYY-MM.json, snapshots/index.json y
 *      snapshots/tricount.json: ficheros estáticos que la web publicada lee.
 *
 * Reutiliza EXACTAMENTE el mismo código que usa el frontend
 * (web/src/lib/monthly.js y web/src/config.js), así que no hay dos versiones
 * de la lógica que puedan desincronizarse.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CASA, SUPABASE_ANON_KEY, SUPABASE_URL } from '../web/src/config.js';
import { buildMonth, monthKey } from '../web/src/lib/monthly.js';
import { fetchTricount, settle } from '../server/tricount.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP_DIR = join(ROOT, 'snapshots');

// El .env manda sobre todo lo demás (Node 20.6+).
try {
  process.loadEnvFile?.(join(ROOT, '.env'));
} catch {
  /* sin .env: seguimos con config.js y db.json */
}

// ------------------------------------------------------------- argumentos ---

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};

function defaultMonth() {
  const now = new Date();
  if (has('--this-month')) return monthKey(now);
  // Por defecto: el mes que acaba de terminar.
  const prev = new Date(now.getFullYear(), now.getMonth(), 0);
  return monthKey(prev);
}

const month = valueOf('--month') ?? defaultMonth();
const source = valueOf('--source') ?? (SUPABASE_URL ? 'supabase' : 'db');
const skipTricount = has('--no-tricount');

if (!/^\d{4}-\d{2}$/.test(month)) {
  console.error(`❌ Mes inválido: "${month}". Formato esperado: YYYY-MM`);
  process.exit(1);
}

// ---------------------------------------------------------------- fuentes ---

/** El host del proyecto, tolerando que pegues la URL con /rest/v1. */
function supabaseHost() {
  let url = (process.env.SUPABASE_URL || SUPABASE_URL || '').trim().replace(/\/+$/, '');
  if (url.endsWith('/rest/v1')) url = url.slice(0, -'/rest/v1'.length);
  return url;
}

async function checksFromSupabase() {
  const host = supabaseHost();
  const key = process.env.SUPABASE_KEY || SUPABASE_ANON_KEY;

  if (!host || !key) {
    throw new Error(
      'Faltan las credenciales de Supabase. Rellena web/src/config.js, o pon\n' +
        '   SUPABASE_URL y SUPABASE_KEY en el .env.'
    );
  }
  if (key.startsWith('sb_secret_')) {
    throw new Error(
      'Esa es la clave SECRETA de Supabase. Usa la publishable (sb_publishable_...):\n' +
        '   la secreta salta todas las reglas RLS y no debe salir de un backend.'
    );
  }

  const res = await fetch(`${host}/rest/v1/checks?select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`Supabase respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  return (await res.json()).map((r) => ({
    occId: r.occ_id,
    shiftId: r.shift_id,
    zoneId: r.zone_id,
    week: r.week,
    day: r.day,
    by: r.person,
    at: r.created_at,
  }));
}

function checksFromDbJson() {
  const file = join(ROOT, 'db.json');
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')).completions ?? [];
}

// -------------------------------------------------------------------- main ---

const money = (n, c = 'EUR') =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: c || 'EUR' }).format(n ?? 0);

console.log(`\n📅 Cierre de ${month}  ·  checks desde ${source}\n`);

let completions = [];
try {
  completions = source === 'supabase' ? await checksFromSupabase() : checksFromDbJson();
  console.log(`   ✓ ${completions.length} checks`);
} catch (err) {
  console.error(`   ❌ No se pudieron leer los checks: ${err.message}`);
  process.exit(1);
}

// La config del piso sale de config.js: la misma que usa el frontend.
const db = { ...CASA, completions, tricount: {} };

let tricount = null;
if (!skipTricount) {
  const url = process.env.TRICOUNT_URL || '';
  if (!url) {
    console.log('   ⚠️  Sin TRICOUNT_URL en el .env — snapshot solo de limpieza.');
  } else {
    try {
      tricount = await fetchTricount(url, { appId: process.env.TRICOUNT_APP_ID || randomUUID() });
      console.log(`   ✓ Tricount: ${tricount.expenses.length} gastos · ${money(tricount.total, tricount.currency)}`);
    } catch (err) {
      // Que falle Tricount no debe impedir archivar el mes de limpieza.
      console.log(`   ⚠️  Tricount falló (${err.message}) — snapshot solo de limpieza.`);
    }
  }
}

if (tricount) {
  db.tricount = {
    url: '', // nunca en el snapshot: este fichero acaba publicado
    title: tricount.title,
    currency: tricount.currency,
    lastSync: tricount.fetchedAt,
    status: 'ok',
    balances: tricount.balances,
    expenses: tricount.expenses,
    total: tricount.total,
  };
}

// Mismo cálculo que ve el frontend, sin segunda implementación.
const snapshot = buildMonth(db, month);
snapshot.live = false; // congelado

mkdirSync(SNAP_DIR, { recursive: true });
writeFileSync(join(SNAP_DIR, `${month}.json`), JSON.stringify(snapshot, null, 2), 'utf8');

if (tricount) {
  writeFileSync(
    join(SNAP_DIR, 'tricount.json'),
    JSON.stringify(
      {
        url: '',
        title: tricount.title,
        currency: tricount.currency,
        lastSync: tricount.fetchedAt,
        status: 'ok',
        balances: tricount.balances,
        settlements: settle(tricount.balances),
        expenses: tricount.expenses,
        total: tricount.total,
      },
      null,
      2
    ),
    'utf8'
  );
}

const months = readdirSync(SNAP_DIR)
  .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
  .map((f) => f.replace('.json', ''))
  .sort();

writeFileSync(
  join(SNAP_DIR, 'index.json'),
  JSON.stringify({ months, latest: months.at(-1) ?? null, updatedAt: new Date().toISOString() }, null, 2),
  'utf8'
);

// ------------------------------------------------------------------ resumen ---

const st = snapshot.stats;
console.log(`\n✅ ${snapshot.title}`);
console.log(`   ${st.weeks} semanas · ${st.done}/${st.total} zonas (${st.pct ?? '—'}%)`);
for (const p of st.perPerson) {
  const pct = p.pct == null ? '—' : `${p.pct}%`;
  console.log(`     ${p.name.padEnd(10)} ${p.done}/${p.zones} zonas · ${pct} a tiempo`);
}
if (snapshot.tricount?.monthExpenses?.length) {
  console.log(`   Gastos del mes: ${money(snapshot.tricount.monthTotal, snapshot.tricount.currency)} (${snapshot.tricount.monthExpenses.length} apuntes)`);
}
console.log(`\n   Escrito en snapshots/  ·  meses: ${months.join(', ') || '(ninguno)'}`);
console.log('   Ahora: git add snapshots/ && git commit -m "Cierre de mes" && git push\n');
