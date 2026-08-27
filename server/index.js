/**
 * server/index.js — Express: la API y, en producción, también el frontend.
 *
 * Dev:  la API en :3000, Vite en :5173 con proxy hacia aquí.
 * Prod: `npm run build` genera web/dist y este mismo proceso lo sirve, así
 *       los móviles del piso solo necesitan una URL.
 */

import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

import api, { syncTricount } from './routes/index.js';
import * as db from './db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'web', 'dist');
const PORT = Number(process.env.PORT) || 3000;
const SYNC_MINUTES = Number(process.env.SYNC_MINUTES) || 30;

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, at: new Date().toISOString() }));

// Los snapshots mensuales también se sirven como ficheros estáticos: así el
// día que publiquéis esto en GitHub Pages funcionan sin cambiar nada.
app.use('/snapshots', express.static(join(ROOT, 'snapshots')));
app.use('/api', api);

// Los errores de la API salen como JSON, nunca como el HTML de Express.
app.use('/api', (err, req, res, _next) => {
  console.error('API error:', err);
  res.status(500).json({ error: err.message ?? 'Error interno' });
});

if (existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA: cualquier ruta que no sea /api devuelve el index y decide React Router.
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(join(DIST, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res
      .status(200)
      .type('text/plain')
      .send('API viva. El frontend aún no está compilado: usa `npm run dev` o `npm run build`.')
  );
}

/** IPs de la red local, para decirle a Jimmy y Mel dónde entrar. */
function localAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

app.listen(PORT, '0.0.0.0', () => {
  const data = db.read();
  console.log(`\n🧹  ${data.home ?? 'Piso'} — servidor levantado`);
  console.log(`    local:  http://localhost:${PORT}`);
  for (const ip of localAddresses()) console.log(`    red:    http://${ip}:${PORT}`);
  console.log(`    datos:  ${db.paths.DB_PATH}`);
  if (!existsSync(DIST)) console.log('    (sin frontend compilado — `npm run build`)');

  if (data.tricount?.url) {
    syncTricount().then((r) =>
      console.log(r.ok ? `    tricount: ${r.expenses} gastos` : `    tricount: ⚠️  ${r.error}`)
    );
    setInterval(() => syncTricount(), SYNC_MINUTES * 60 * 1000).unref();
  } else {
    console.log('    tricount: sin configurar (pégale la URL desde la app)');
  }
  console.log('');
});
