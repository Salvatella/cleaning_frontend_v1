/**
 * server/db.js — la "base de datos": un JSON en el root del proyecto.
 *
 * Dos garantías:
 *  1. Escritura ATÓMICA (fichero temporal + rename). Si se va la luz a mitad,
 *     db.json queda entero, con el contenido de antes. Nunca a medias.
 *  2. Escrituras SERIALIZADAS por una cola de promesas. Tres personas marcando
 *     tareas a la vez no se pisan.
 *
 * Todo vive en memoria; el disco es solo la persistencia.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'db.json');
const TMP_PATH = join(ROOT, 'db.json.tmp');
const BAK_PATH = join(ROOT, 'db.bak.json');

let cache = null;
let queue = Promise.resolve();
let lastBackup = 0;

function emptyDb() {
  return {
    version: 1,
    home: 'Mi piso',
    people: [],
    cleaning: { shifts: [], rotation: [], anchorWeek: null },
    completions: [],
    shopping: [],
    tricount: {
      url: '',
      appInstallationId: null,
      lastSync: null,
      status: 'never',
      error: null,
      members: {},
      balances: [],
      expenses: [],
      total: 0,
    },
  };
}

/** Lee db.json (desde caché a partir de la primera vez). */
export function read() {
  if (cache) return cache;

  if (!existsSync(DB_PATH)) {
    cache = emptyDb();
    return cache;
  }

  try {
    cache = JSON.parse(readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    // Si el JSON está corrupto, intentamos el backup antes de rendirnos.
    if (existsSync(BAK_PATH)) {
      console.error(`⚠️  db.json ilegible (${err.message}). Recuperando db.bak.json`);
      cache = JSON.parse(readFileSync(BAK_PATH, 'utf8'));
    } else {
      throw new Error(`db.json corrupto y sin backup: ${err.message}`);
    }
  }

  // Migración suave: rellena claves que falten sin tocar las que hay.
  cache = { ...emptyDb(), ...cache };
  return cache;
}

/**
 * Modifica la base de datos. `mutator` recibe el objeto y lo cambia in-place
 * (o devuelve uno nuevo). Devuelve una promesa con el estado ya guardado.
 *
 *   await update(db => { db.shopping.push(item) })
 */
export function update(mutator) {
  queue = queue.then(async () => {
    const db = read();
    const result = mutator(db);
    if (result && typeof result === 'object') cache = result;

    // Backup como mucho una vez al día.
    const now = Date.now();
    if (existsSync(DB_PATH) && now - lastBackup > 24 * 60 * 60 * 1000) {
      try {
        copyFileSync(DB_PATH, BAK_PATH);
        lastBackup = now;
      } catch {
        /* un backup fallido no debe tumbar la escritura */
      }
    }

    writeFileSync(TMP_PATH, JSON.stringify(cache, null, 2), 'utf8');
    renameSync(TMP_PATH, DB_PATH); // atómico en el mismo sistema de ficheros
    return cache;
  });
  return queue;
}

/** Id corto y legible para elementos nuevos. */
export function newId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const paths = { ROOT, DB_PATH };
