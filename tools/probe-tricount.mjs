#!/usr/bin/env node
/**
 * tools/probe-tricount.mjs — diagnóstico temporal.
 *
 * Imprime CADA apunte del tricount tal y como llega de la API, con su
 * type_transaction y sus allocations. Sirve para saber qué tipos existen de
 * verdad (gastos, ingresos, reembolsos) antes de tocar el parser.
 *
 * Uso:
 *   node tools/probe-tricount.mjs "https://tricount.com/tyNQdppJtDwndKkuqS"
 *
 * No escribe nada. Solo lee e imprime. Bórralo cuando ya no haga falta.
 */

import { fetchTricount } from '../server/tricount.js';

const target = process.argv[2] ?? process.env.TRICOUNT_URL;
if (!target) {
  console.error('Uso: node tools/probe-tricount.mjs <url-del-tricount>');
  process.exit(1);
}

const nm = (m) => {
  const x = m?.RegistryMembershipNonUser ?? m;
  return x?.alias?.display_name ?? x?.alias?.pointer?.name ?? '?';
};

const data = await fetchTricount(target, { includeRaw: true, timeoutMs: 25000 });
const reg = data.raw?.Response?.[0]?.Registry;

console.log(`\ntitle: ${reg?.title}   currency: ${reg?.currency}`);
console.log('tipos vistos:    ', data.diagnostics.typesSeen.join(', ') || '(ninguno)');
console.log('estados vistos:  ', data.diagnostics.statusesSeen.join(', ') || '(ninguno)');
console.log('apuntes crudos:  ', data.diagnostics.rawEntries);
console.log('saltados por status:    ', data.diagnostics.skippedByStatus);
console.log('saltados por transfer:  ', data.diagnostics.skippedAsTransfer);

console.log('\n--- APUNTES ---');
for (const raw of reg?.all_registry_entry ?? []) {
  const e = raw?.RegistryEntry;
  if (!e) continue;
  console.log(
    `\ntype=${e.type_transaction}  status=${e.status}  date=${String(e.date).slice(0, 10)}\n` +
      `  desc=${JSON.stringify(e.description)}\n` +
      `  amount=${e.amount?.value} ${e.amount?.currency}   owner=${nm(e.membership_owned)}`
  );
  for (const a of e.allocations ?? []) {
    console.log(`    alloc: ${nm(a?.membership).padEnd(20)} ${a?.amount?.value}   type=${a?.type ?? '-'}`);
  }
}

console.log('\n--- BALANCES QUE CALCULAMOS AHORA (posiblemente mal) ---');
for (const b of data.balances) {
  console.log(`  ${b.person.padEnd(20)} ${String(b.amount).padStart(8)}   (pagó ${b.paid} · le toca ${b.share})`);
}
console.log('');
