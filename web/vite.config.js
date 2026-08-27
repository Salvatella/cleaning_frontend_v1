import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  // Rutas relativas: el build vale igual en la raíz de un dominio que en
  // https://usuario.github.io/cleaning_service_v1/
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0', // para poder abrirlo desde el móvil mientras desarrollas
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
  },
});
