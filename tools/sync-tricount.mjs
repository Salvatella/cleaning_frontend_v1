#!/usr/bin/env node
/**
 * tools/sync-tricount.mjs — sincroniza Tricount y escribe db.json, sin
 * levantar el servidor.
 *
 *   npm run sync
 *
 * Útil cuando el servidor no está corriendo y quieres dejar los gastos al día,
 * o para forzar una actualización sin esperar al ciclo de 30 min. El servidor
 * hace exactamente esto mismo por su cuenta mientras está encendido.
 */

import { randomUUID } from 'node:crypto';
import * as db from '../server/db.js';
import { fetchTricount, settle } from '../server/tricount.js';

// Carga el .env si existe (Node 20.6+). Una variable de entorno real gana.
try {
  process.loadEnvFile?.(new URL('../.env', import.meta.url));
} catch {
  /* no hay .env: seguimos con el argumento o con db.json */
}

const urlArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
const current = db.read();

// Orden: argumento → TRICOUNT_URL del .env → db.json (compatibilidad).
const url = urlArg || process.env.TRICOUNT_URL || current.tricount?.url;

if (!url) {
  console.error('❌ No hay URL de Tricount. Ponla en .env como TRICOUNT_URL,');
  console.error('   o pásala como argumento:');
  console.error('   npm run sync -- "https://tricount.com/VUESTRA_CLAVE"');
  process.exit(1);
}

const appId = current.tricount?.appInstallationId ?? randomUUID();
const money = (n, c) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: c || 'EUR' }).format(n ?? 0);

try {
  const data = await fetchTricount(url, { appId });

  await db.update((d) => {
    d.tricount = {
      ...d.tricount,
      url,
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

  console.log(`\n✅ db.json actualizado — ${data.title ?? 'tricount'}`);
  console.log(`   ${data.expenses.length} gastos · ${money(data.total, data.currency)} en total\n`);

  for (const b of data.balances) {
    console.log(`   ${b.person.padEnd(10)} ${money(b.amount, data.currency).padStart(12)}`);
  }

  const moves = settle(data.balances);
  if (moves.length) {
    console.log('\n   Para saldar:');
    for (const m of moves) {
      console.log(`     ${m.from} → ${m.to}  ${money(m.amount, data.currency)}`);
    }
  }
  console.log('');
} catch (err) {
  // No dejamos db.json a medias: marcamos el fallo y conservamos el snapshot
  // anterior, igual que hace el servidor.
  await db.update((d) => {
    d.tricount = {
      ...d.tricount,
      url,
      appInstallationId: appId,
      status: d.tricount?.lastSync ? 'stale' : 'error',
      error: err.message,
    };
  });
  console.error(`\n❌ Falló: ${err.message}`);
  console.error('   Se conservan los datos de la última sync buena.\n');
  process.exit(1);
}
