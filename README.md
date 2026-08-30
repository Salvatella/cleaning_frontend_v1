# Cleaning Service v1

Dashboard de limpieza y gastos para un piso compartido. Corre en la red local
del piso: un solo servidor, una sola URL, sin login. La "base de datos" es
`db.json` en el root.

## Dos modos

La app funciona igual de las dos maneras. Lo decide `web/src/config.js`:

| | **Estático** (config rellena) | **Local** (config vacía) |
|---|---|---|
| Dónde vive la web | GitHub Pages, o el `index.html` a pelo | Express en tu máquina |
| Dónde viven los checks | Supabase | `db.json` |
| ¿Algo encendido en casa? | No | Sí |
| ¿Se ve desde fuera de casa? | Sí | No, solo la wifi del piso |
| Aviso al marcar otro | Al instante (realtime) | Refresco cada 20 s |

Los turnos, el estado de cada zona y las estadísticas **se calculan siempre en
el navegador** (`web/src/lib/`). Lo único que cambia es de dónde salen los
hechos. Por eso el mismo código sirve para los dos modos.

## Arrancar

```bash
npm install
npm run dev          # API en :3000 + Vite en :5173 (abre :5173)
```

Para el uso real en el piso:

```bash
npm run build        # compila el frontend a web/dist
npm start            # un solo puerto: http://<tu-ip>:3000
```

Al arrancar, la consola imprime la IP de tu red local. Esa es la URL que
Jimmy y Mel se guardan en el móvil (Compartir → Añadir a pantalla de inicio y
queda como una app).

## Las cuatro pestañas

- **Dashboard** — resumen **mensual** («Dashboard de Junio 2026») con navegación
  por meses anteriores. El mes en curso se calcula en vivo; los meses cerrados
  se leen de su snapshot congelado.
- **Horario** — los dos turnos de esta semana, quién descansa, las zonas de la
  casa y la rotación de las próximas seis semanas.
- **Esta semana** — una checklist por cada persona de guardia, con todas las
  zonas y una barra de progreso. Un click para marcar. Es la pestaña que se
  usa a diario.
- **Compra y gastos** — lista de la compra editable a la izquierda, balances
  de Tricount a la derecha.

## Cómo funciona el horario

Cada semana **limpian dos personas la casa entera**, con tres días cada una
para hacerlo:

- **Primer turno** — lunes, martes, miércoles
- **Segundo turno** — viernes, sábado, domingo

Como sois tres, la tercera persona descansa esa semana, y todo va rotando solo:

```
2026-W34   lun-mié Ferran · vie-dom Jimmy    descansa Mel
2026-W35   lun-mié Mel    · vie-dom Ferran   descansa Jimmy
2026-W36   lun-mié Jimmy  · vie-dom Mel      descansa Ferran
```

En doce semanas salen **8 turnos y 4 descansos por cabeza**, y cada uno alterna
entre semana y fin de semana — nadie se queda siempre con el sábado. La
rotación avanza sola desde `anchorWeek`: no hay que tocar nada nunca.

### Las zonas

La casa está dividida en zonas, y **cada persona de guardia tiene la checklist
entera** en la pestaña «Esta semana»: va marcando las que hace. Un turno solo
cuenta como completo cuando están las tres.

Las zonas son **Baño, Cocina y Salón y suelo**. Para añadir o quitar, edita
`cleaning.zones` — la interfaz se adapta sola al número que haya.

Una zona cuenta **a tiempo** si se marca dentro de los tres días del turno;
marcada después cuenta como hecha pero con retraso. El porcentaje del dashboard
se mide **por zona**, no por turno: alguien que hizo 2 de 3 no aparece como si
no hubiera hecho nada.

Para cambiar los días o el orden, edita `cleaning` en `db.json`:

```jsonc
"cleaning": {
  "zones": [
    { "id": "bano",   "name": "Baño" },
    { "id": "cocina", "name": "Cocina" },
    { "id": "salon",  "name": "Salón y suelo" }
  ],
  "shifts": [
    { "id": "t1", "label": "Primer turno",  "days": [1, 2, 3] },
    { "id": "t2", "label": "Segundo turno", "days": [5, 6, 7] }
  ],
  "rotation": ["ferran", "jimmy", "mel"],
  "anchorWeek": "2026-W34"
}
```

Los días van de 1 (lunes) a 7 (domingo). Si algún día entra un cuarto
compañero, lo añades a `people` y a `rotation` y la rotación se recalcula sola.

En `db.json` solo se guardan **hechos** (la config y quién marcó qué y cuándo).
Porcentajes, retrasos y rachas se calculan al vuelo en `server/schedule.js`,
así que nunca hay datos que resincronizar.

## Tricount

Solo lectura, con un cliente propio sin dependencias (`server/tricount.js`).
La primera vez, pega el enlace de vuestro Tricount en la pestaña de gastos.
A partir de ahí sincroniza cada 30 min y al arrancar.

Probar la conexión por separado:

```bash
npm run test:tricount -- "https://tricount.com/es/VUESTRA_CLAVE"
```

Si la sync falla, la app **no se rompe**: sigue mostrando el último snapshot
y marca los datos como antiguos. Para añadir un gasto hay que abrir Tricount:
la API interna no permite escribir.

## Publicarlo como web estática

1. **Crea el proyecto en Supabase** (gratis, sin tarjeta).
2. **SQL Editor → pega `supabase/schema.sql` → Run.** Crea las dos tablas y sus
   reglas de seguridad.
3. **Rellena `web/src/config.js`** con la Project URL y la clave `anon`
   (Project Settings → Data API / API Keys).
   > La clave `anon` va en el frontend a la vista: está diseñada así. Lo que
   > protege los datos son las reglas RLS del paso 2. La `service_role` **nunca**
   > se pone aquí.
4. `npm run build` → todo queda en `web/dist/`.
5. Sube el contenido de `web/dist` (más la carpeta `snapshots/`) a GitHub Pages.

Ya está: no hay servidor, no hay despliegue, no hay nada encendido. Los tres
entráis por la URL y los checks se comparten al instante.

Un par de detalles que evitan sorpresas:

- La app usa **rutas con `#`** (`/#/semana`). Así funciona igual en la raíz de
  un dominio, en `usuario.github.io/repo/`, o abriendo el fichero a pelo — sin
  configurar nada en el servidor.
- **Sin login**, cualquiera que tenga la URL puede marcar. Para un piso suele
  dar igual; si molesta, se añade un PIN en las reglas RLS.
- **Tricount no se puede llamar desde el navegador** (su API interna no lo
  permite). En modo estático los gastos los genera el script mensual, que los
  deja en `snapshots/tricount.json`.

## El cierre de mes

Cuando quieras actualizar los gastos y congelar un mes:

```bash
npm run snapshot
git add snapshots/ && git commit -m "Cierre de mes" && git push
```

El `push` dispara el workflow de GitHub Actions, que recompila y republica.
Un minuto después la web tiene los datos nuevos.

Por defecto congela **el mes que acaba de terminar**. Otras formas:

```bash
npm run snapshot -- --month 2026-08    # un mes concreto
npm run snapshot -- --this-month       # el mes en curso, tal como va
npm run snapshot -- --no-tricount      # solo limpieza, sin tocar los gastos
npm run snapshot -- --source db        # checks desde db.json en vez de Supabase
```

Genera tres ficheros en `snapshots/`:

| Fichero | Qué lleva |
|---|---|
| `2026-08.json` | las estadísticas de ese mes, ya calculadas |
| `tricount.json` | balances y gastos actuales |
| `index.json` | qué meses hay, para que el dashboard sepa navegar |

Si Tricount falla, el snapshot se genera igual con los datos de limpieza — no
se pierde el mes por un problema de red. Y el enlace del tricount **nunca** se
escribe dentro: esos ficheros acaban publicados.

### Por qué esto importa

Los snapshots son **ficheros estáticos**. El dashboard los lee con un `fetch`
normal, sin ningún servidor detrás. Solo hacen falta credenciales para
*generarlos*, y eso ocurre en tu máquina.

> El script reutiliza el mismo código que el frontend
> (`web/src/lib/monthly.js` y `web/src/config.js`), así que los números del
> mes congelado y los del mes en curso salen del mismo sitio. No hay dos
> implementaciones que puedan desincronizarse.

## Estructura

```
db.json                  la base de datos
server/
  index.js               Express: API + estáticos en producción
  db.js                  lectura, escritura atómica y cola de escrituras
  schedule.js            rotación de turnos, zonas y cálculo de KPIs
  monthly.js             resumen del mes en curso (mismo formato que el snapshot)
  tricount.js            cliente de la API interna de Tricount
  routes/index.js        toda la API
web/
  src/config.js          URL y clave de Supabase + la config del piso
  src/store.js           de dónde salen los datos (Supabase o Express)
  src/lib/               turnos y estadísticas — compartido con el servidor
supabase/schema.sql      tablas y reglas de seguridad (pegar en el SQL Editor)
snapshots/               los meses cerrados y los gastos, en ficheros estáticos
tools/
  test-tricount.mjs      prueba de humo de la conexión
  sync-tricount.mjs      sincroniza Tricount sin arrancar el servidor
  month-snapshot.mjs     cierre de mes: congela el mes en un JSON estático
```

## Notas

- **Escrituras seguras**: fichero temporal + `rename`, y una cola de promesas.
  Probado con 20 escrituras simultáneas sin corromper el JSON.
- **Backup**: `db.bak.json` se genera como mucho una vez al día. Si `db.json`
  se corrompe, se recupera solo desde ahí al arrancar.
- **Editar el horario** se hace a mano en `db.json` por ahora.
- **Cambiar de casa o de gente**: `people` + `cleaning.rotation` y listo.
