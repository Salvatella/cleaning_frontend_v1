# Prompt para Claude Code

Copia todo lo que hay debajo de la línea y pégalo en Claude Code, abierto en
`C:\Users\ferra\Desktop\cleaning_service_v1`.

---

Estoy trabajando en `cleaning_service_v1`: un dashboard de limpieza y gastos
para un piso de tres (Ferran, Jimmy, Mel). Lee el `README.md` primero, está al
día y explica la arquitectura entera.

## Contexto en una frase

La app ya está construida y funcionando en modo local (Express + `db.json`).
Acabo de migrarla para que pueda funcionar **también** como web 100% estática
con Supabase, y quiero terminar esa migración y publicarla en GitHub Pages.

## Lo primero: limpiar restos de la migración

Hay tres ficheros que quedaron obsoletos y **hay que borrarlos**. Su contenido
se movió a `web/src/`, pero no pude borrarlos yo:

- `web/src/api.js`          → sustituido por `web/src/store.js`
- `server/schedule.js`      → movido a `web/src/lib/schedule.js`
- `server/monthly.js`       → movido a `web/src/lib/monthly.js`

Bórralos y comprueba que nada los importa (`grep -rn "api.js\|server/schedule\|server/monthly" server web --include=*.js --include=*.jsx`).
El servidor ya importa desde `../../web/src/lib/`.

Después: `npm install && npm run build` y confirma que compila.

## Cómo está montado (resumen; el detalle está en el README)

- **La lógica vive en `web/src/lib/`** (`schedule.js` = rotación de turnos y
  estado de cada zona; `monthly.js` = resumen de un mes). La usan tanto el
  frontend como el servidor Express. Se calcula **en el navegador**.
- **`web/src/store.js`** es la capa de datos, con dos modos que se eligen solos
  según si `web/src/config.js` tiene las credenciales de Supabase:
  - vacío → habla con el Express local (`/api/...`)
  - relleno → habla directo con Supabase, y la web no necesita servidor
- **`web/src/config.js`** tiene la config del piso (personas, zonas, turnos,
  rotación) y los dos huecos de Supabase.
- **Los checks** son filas en la tabla `checks`. El id es `turno:semana:zona`
  (ej. `t1:2026-W34:bano`).
- **Tricount** no se puede llamar desde el navegador (CORS, comprobado). Los
  gastos los genera `tools/month_snapshot.py` en un fichero estático.

## Reglas del dominio (no las cambies sin avisarme)

- Cada semana limpian **dos personas**, la tercera descansa. Turno 1 =
  lunes/martes/miércoles, turno 2 = viernes/sábado/domingo. La rotación avanza
  sola desde `anchorWeek` y sale equilibrada: 8 turnos y 4 descansos por cabeza
  cada 12 semanas, alternando entre semana y fin de semana.
- Cada persona de guardia tiene una **checklist de las 3 zonas** (Baño, Cocina,
  Salón y suelo). El turno solo cuenta como completo con las tres marcadas.
- Una zona cuenta **"a tiempo"** si se marca dentro de los días del turno.
  Se guarda el día en que se MARCA, nunca el de vencimiento (esto ya fue un bug
  una vez).
- El porcentaje se mide **por zona**, no por turno: 2 de 3 es 67%, no 0.

## Lo que quiero que hagas

1. **Borrar los tres ficheros obsoletos** y verificar que compila.

2. **Terminar el modo estático.** Yo crearé el proyecto en Supabase y ejecutaré
   `supabase/schema.sql`; luego rellenaré `web/src/config.js`. Necesito que:
   - Revises `web/src/store.js` a fondo. Está escrito pero **nunca se ha
     probado contra un Supabase real** — solo el modo local está verificado.
     Busca errores en el mapeo de columnas (`occ_id`, `shift_id`, `zone_id`,
     `person`, `day`, `created_at`) y en el realtime.
   - Compruebes que si Supabase falla o tarda, la app no se queda en blanco.

3. **Publicar en GitHub Pages.** Crear el workflow de GitHub Actions que haga
   `npm run build` y publique `web/dist` + la carpeta `snapshots/`. La app ya
   usa `HashRouter` y `base: './'` para que funcione bajo `/usuario/repo/`.

4. **Decidir qué hacer con `/api/notes`.** Está implementada en
   `server/routes/index.js` (CRUD completo) pero ninguna pantalla la usa: es
   código muerto. O le montas una pestaña de incidencias del piso ("la bombilla
   del baño está fundida"), o la borras. Tú decides, pero no la dejes a medias.

## Cómo verificar

El proyecto tiene Playwright. Haz pruebas de verdad en navegador, no asumas:

```bash
npm run dev        # Express en :3000 + Vite en :5173
npm run build && npm start   # producción en :3000
```

Comprueba siempre estas cuatro cosas antes de darme algo por terminado:
marcar y desmarcar una zona (y que persiste al recargar), añadir/comprar/borrar
en la lista, que el horario muestra 6 semanas de rotación, y que el dashboard
carga con el título "Dashboard de <Mes> <Año>".

**Aviso de un bug que ya me comí:** al cambiar imports se produjo una colisión
de nombres — una función local se llamaba igual que la importada del store y se
llamaba a sí misma. Compilaba sin quejarse y petaba en tiempo de ejecución.
Revisa que no haya nombres duplicados entre imports y funciones locales.

## Ojo con la duplicación

La lógica de turnos y estadísticas está escrita **dos veces**: en JS
(`web/src/lib/`) y en Python (`tools/month_snapshot.py`, para congelar los
meses). Están verificadas como equivalentes — misma rotación en 12 semanas y
mismos números para un mes dado. **Si cambias las reglas, cámbialas en los
dos sitios** y vuelve a cruzarlas.

## Lo que NO quiero

- Nada de pagar. Todo tiene que caber en capas gratuitas sin tarjeta.
- Nada de TypeScript, Tailwind, ni gestores de estado. Es JS plano, React y CSS.
- No metas la clave `service_role` de Supabase en el frontend. La `anon` sí va
  ahí, es lo correcto.
