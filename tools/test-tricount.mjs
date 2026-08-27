#!/usr/bin/env node
/**
 * tools/test-tricount.mjs — prueba de humo del cliente de Tricount.
 *
 * Uso:
 *   node tools/test-tricount.mjs "https://tricount.com/es/tZqzdVuUqIcJBaTVmo"
 *   node tools/test-tricount.mjs <clave> --json   → nuestro formato normalizado
 *   node tools/test-tricount.mjs <clave> --raw    → la respuesta cruda de la API
 *
 * No toca db.json ni nada del proyecto: solo imprime lo que ve.
 * Si esto funciona, la Fase 5 va adelante. Si no, plan B (importar CSV).
 */

import { writeFileSync } from 'node:fs';
import { fetchTricount, settle } from '../server/tricount.js';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const asRaw = args.includes('--raw');
const target = args.find((a) => !a.startsWith('--'));

if (!target) {
  console.error('Uso: node tools/test-tricount.mjs <url-o-clave-del-tricount> [--json|--raw]');
  process.exit(1);
}

const eur = (n, c = '€') =>
  `${n > 0 ? '+' : n < 0 ? '−' : ' '}${Math.abs(n).toFixed(2).replace('.', ',')} ${c}`;

try {
  const t0 = Date.now();
  const data = await fetchTricount(target, { includeRaw: asRaw });
  const ms = Date.now() - t0;

  if (asRaw) {
    // La respuesta cruda es enorme: a archivo, no a consola.
    writeFileSync('tricount-raw.json', JSON.stringify(data.raw, null, 2));
    console.log('Respuesta cruda guardada en tricount-raw.json');
    console.log('Diagnóstico:', JSON.stringify(data.diagnostics, null, 2));
    process.exit(0);
  }

  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }

  const c = data.currency === 'EUR' ? '€' : (data.currency ?? '');

  console.log(`\n✅ Conectado en ${ms} ms`);
  console.log(`   Tricount: ${data.title ?? '(sin título)'}`);
  console.log(`   ${data.members.length} miembros · ${data.expenses.length} gastos · ${data.total.toFixed(2)} ${c} en total\n`);

  console.log('MIEMBROS');
  for (const m of data.members) console.log(`   · ${m.name}  (id ${m.id})`);

  console.log('\nBALANCES  (positivo = le deben)');
  const w = Math.max(...data.balances.map((b) => b.person.length), 8);
  for (const b of data.balances) {
    console.log(
      `   ${b.person.padEnd(w)}  ${eur(b.amount, c).padStart(12)}` +
        `   (pagó ${b.paid.toFixed(2)} · le toca ${b.share.toFixed(2)})`
    );
  }

  const moves = settle(data.balances);
  if (moves.length) {
    console.log('\nPARA SALDAR');
    for (const m of moves) console.log(`   ${m.from} → ${m.to}   ${m.amount.toFixed(2)} ${c}`);
  } else {
    console.log('\nPARA SALDAR\n   Todo cuadrado.');
  }

  console.log('\nÚLTIMOS GASTOS');
  for (const e of data.expenses.slice(0, 10)) {
    console.log(
      `   ${(e.date ?? '?').padEnd(11)} ${String(e.title).slice(0, 34).padEnd(36)}` +
        `${e.paidBy.padEnd(w + 2)} ${e.amount.toFixed(2).padStart(9)} ${c}`
    );
  }
  if (data.expenses.length > 10) console.log(`   … y ${data.expenses.length - 10} más`);

  // Si no hay gastos, decir POR QUÉ: ¿no vino nada, o lo filtramos nosotros?
  if (data.expenses.length === 0) {
    const d = data.diagnostics;
    console.log('   (ninguno)\n');
    if (d.rawEntries === 0) {
      console.log('ℹ️  La API devolvió 0 apuntes: el tricount está vacío de verdad.');
      console.log('   Añade un gasto de prueba en la app y vuelve a lanzar esto.');
      console.log(`   Claves del Registry: ${d.registryKeys.join(', ')}`);
    } else {
      console.log(`⚠️  Vinieron ${d.rawEntries} apuntes pero se filtraron todos:`);
      console.log(`   sin RegistryEntry: ${d.noRegistryEntry}`);
      console.log(`   descartados por status: ${d.skippedByStatus}  (vistos: ${d.statusesSeen.join(', ') || '—'})`);
      console.log(`   descartados por ser transferencia: ${d.skippedAsTransfer}  (tipos: ${d.typesSeen.join(', ') || '—'})`);
      console.log('   → es un bug de parseo. Lanza con --raw y pásame tricount-raw.json');
    }
  }
  console.log('');
} catch (err) {
  console.error('\n❌ Falló:', err.message);
  console.error('\nQué mirar:');
  console.error('  1. ¿La URL es el enlace de invitación del tricount (Compartir → Copiar enlace)?');
  console.error('  2. ¿Tienes conexión y no hay proxy/VPN de por medio?');
  console.error('  3. Si el error es 4xx en /v1/session-registry-installation, la API');
  console.error('     interna ha cambiado → toca plan B: exportar el CSV desde Tricount.');
  process.exit(1);
}
