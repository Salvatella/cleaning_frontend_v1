# Cleaning Service v1 — Stack, devcontainer y plan

Piso de 3 (Ferran, Jimmy, Mel). Web service en la red local del piso, sin login,
todos ven y editan lo mismo. Base de datos = un `db.json` en el root.

---

## 1. Stack

| Capa | Elección | Por qué |
|---|---|---|
| Runtime | **Node 22 LTS** | ESM nativo, `--watch` incorporado, sin nodemon |
| Backend | **Express 5** | 4 rutas REST, nada más |
| "BD" | **`db.json` en el root** + escritura atómica | lo que pediste; sin servidor de BD |
| Frontend | **React 19 + Vite 7** | HMR instantáneo, build a estáticos |
| Rutas front | **react-router-dom 7** | 4 pestañas |
| Estilos | **CSS plano** (un `styles.css` con variables) | el mockup ya está escrito así, copiar y pegar |
| Fechas | **date-fns** (locale `es`) | semanas ISO (lunes) sin dolor |
| Tricount | **cliente propio en `server/tricount.js`**, sin dependencias | ver §4 |
| Prod | Express sirve `web/dist` + la API en **un solo puerto** | una URL para los móviles |

Sin TypeScript, sin Tailwind, sin ORM. Si más adelante duele, se añade.

### Estructura

```
cleaning_service_v1/
├─ .devcontainer/
│  └─ devcontainer.json
├─ db.json                  ← la "base de datos" (en el root, como pediste)
├─ db.example.json          ← semilla para arrancar de cero
├─ package.json             ← workspaces: server + web
├─ server/
│  ├─ index.js              ← Express, sirve API + estáticos de web/dist
│  ├─ db.js                 ← load / save atómico + cola de escritura
│  ├─ stats.js              ← cálculo de KPIs (derivados, NO se guardan)
│  ├─ tricount.js           ← cliente no oficial, aislado tras una interfaz
│  └─ routes/
│     ├─ schedule.js        ← GET/PUT horario
│     ├─ tasks.js           ← GET semana actual, POST check/uncheck
│     ├─ shopping.js        ← CRUD lista de la compra
│     └─ expenses.js        ← GET balances, POST /sync
└─ web/
   ├─ index.html
   ├─ vite.config.js        ← proxy /api → localhost:3000 en dev
   └─ src/
      ├─ main.jsx, App.jsx, styles.css
      ├─ components/  Sidebar, StatTile, Bar, Pill, Checkbox
      └─ pages/  Dashboard.jsx  Horario.jsx  Semana.jsx  Compra.jsx
```

### Esquema de `db.json`

Solo se guardan **hechos**. Todo lo del dashboard (%, rachas, retrasos) se calcula
al vuelo en `stats.js` — así nunca hay datos incoherentes.

```jsonc
{
  "version": 1,
  "people": [
    { "id": "ferran", "name": "Ferran", "color": "#2a78d6" },
    { "id": "jimmy",  "name": "Jimmy",  "color": "#eb6834" },
    { "id": "mel",    "name": "Mel",    "color": "#1baf7a" }
  ],

  "schedule": [
    // days: 1=lunes … 7=domingo. La tarea vale por "hecha" si se marca en su ventana.
    { "id": "bano",    "zone": "Baño",          "assignee": "ferran", "days": [1,2,3], "perWeek": 1 },
    { "id": "salon",   "zone": "Salón y suelo", "assignee": "jimmy",  "days": [2,3,4], "perWeek": 1 },
    { "id": "cocina",  "zone": "Cocina",        "assignee": "mel",    "days": [5,6,7], "perWeek": 1 },
    { "id": "basura",  "zone": "Basura",        "assignee": "rotate", "days": [1,3,5,7], "perWeek": 4,
      "rotation": ["ferran","jimmy","mel"] }
  ],

  "completions": [
    // append-only. Una fila por vez que alguien marca algo.
    { "taskId": "bano", "week": "2026-W34", "day": 1,
      "by": "ferran", "at": "2026-08-17T20:15:00+02:00" }
  ],

  "shopping": [
    { "id": "it_01", "name": "Papel de cocina", "addedBy": "mel",
      "addedAt": "2026-08-16T10:00:00+02:00", "bought": false,
      "boughtBy": null, "boughtAt": null }
  ],

  "tricount": {
    "url": "https://tricount.com/es/…",     // el share link del piso
    "lastSync": "2026-08-18T12:04:00+02:00",
    "status": "ok",                          // ok | stale | error
    "appInstallationId": "0f2b…",            // UUID estable, no re-registrar cada sync
    "members": { "Ferran": "ferran", "Jimmy": "jimmy", "Mel": "mel" }, // mapeo nombres→ids
    "balances": [ { "person": "ferran", "amount": 64.10 } ],
    "expenses": [
      { "date": "2026-08-16", "title": "Compra semanal", "paidBy": "ferran", "amount": 78.20 }
    ]
  }
}
```

Escritura: `writeFileSync(tmp)` + `rename()` (atómico), serializado con una
promesa-cola en `db.js`. Tres personas tocando el JSON a la vez no lo corrompe.
Copia de `db.json` a `db.bak.json` una vez al día.

### API

```
GET  /api/state            → todo lo que la UI necesita en una llamada
GET  /api/stats            → KPIs derivados (cumplimiento, rachas, zonas olvidadas)
PUT  /api/schedule         → editar el horario
POST /api/tasks/toggle     → { taskId, week, day, by }  marcar / desmarcar
POST /api/shopping         → añadir producto
PATCH/DELETE /api/shopping/:id
POST /api/expenses/sync    → fuerza una sync con Tricount
```

---

## 2. Devcontainer

`.devcontainer/devcontainer.json`:

```jsonc
{
  "name": "cleaning-service",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:22-bookworm",
  "forwardPorts": [3000, 5173],
  "portsAttributes": {
    "3000": { "label": "API + prod", "onAutoForward": "notify" },
    "5173": { "label": "Vite dev",   "onAutoForward": "openBrowser" }
  },
  "postCreateCommand": "npm install",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "dsznajder.es7-react-js-snippets"
      ],
      "settings": {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "esbenp.prettier-vscode"
      }
    }
  },
  "remoteEnv": { "TZ": "Europe/Madrid" }
}
```

**Aviso importante:** dentro del devcontainer la app solo es accesible desde tu
máquina. Para que Jimmy y Mel entren desde el móvil, en producción se arranca
**fuera del contenedor** (o con el puerto publicado en `0.0.0.0`). El devcontainer
es para desarrollar; el despliegue del piso es §5.

Scripts en el `package.json` raíz:

```jsonc
{
  "scripts": {
    "dev":   "concurrently \"npm:dev:api\" \"npm:dev:web\"",
    "dev:api": "node --watch server/index.js",
    "dev:web": "vite --host 0.0.0.0 --config web/vite.config.js",
    "build": "vite build --config web/vite.config.js",
    "start": "NODE_ENV=production node server/index.js"
  }
}
```

---

## 3. Un cuarto sitio que te propongo

Con lo que ya hay en el JSON sale casi gratis:

- **Notas / incidencias del piso** — "la bombilla del baño fundida", "el casero
  viene el jueves". Una lista simple con autor y fecha. Es lo que en la práctica
  acaba yendo al grupo de WhatsApp y se pierde.

Si prefieres algo más de "producto", la alternativa es un **historial de multas
simbólicas** (quien se salta la tarea invita a algo) — pero eso ya requiere reglas
y discusiones, y dijiste sencillito.

---

## 4. La parte frágil: Tricount

Tricount **no tiene API pública**. Lo que existe son clientes de ingeniería
inversa contra `api.tricount.bunq.com` — la API interna de la app Android
(Tricount es propiedad de bunq).

### Qué cliente usamos

Clientes disponibles, todos de ingeniería inversa:

| Proyecto | Lenguaje | Nota |
|---|---|---|
| [`melalj/tricount-exporter`](https://github.com/melalj/tricount-exporter) | Node, MIT | El único en nuestro stack. Exporta a HTML/CSV |
| [`marinoo3/TricountAPI-python`](https://github.com/marinoo3/TricountAPI-python) | Python | Explícitamente read-only. 0 estrellas, 13 commits |
| [`tricount-api`](https://libraries.io/pypi/tricount-api) (PyPI) | Python | Publicado en PyPI |
| [`mlaily/TricountApi`](https://github.com/mlaily/TricountApi) | C# / notebook | Útil como documentación del protocolo |

**Decisión: ninguno como dependencia.** Ninguno está en npm, son proyectos
pequeños de una persona y el protocolo son ~150 líneas. Está **vendorizado** en
`server/tricount.js`: código propio, sin dependencias (`fetch` y `node:crypto`
nativos), con crédito y licencia MIT en la cabecera. Ventajas: no hay `git clone`
en el `package.json`, no hace falta Python en el devcontainer (adiós al problema
de los dos runtimes que tenía la versión anterior de este documento), y el día
que bunq cambie algo lo arreglas tú en un archivo que entiendes.

### El protocolo, en cuatro pasos

1. Generar un par de claves RSA 2048 (solo se envía la pública).
2. `POST /v1/session-registry-installation` con `{app_installation_uuid,
   client_public_key, device_description}` y el `User-Agent` de la app Android.
3. De la respuesta salen `Token.token` y `UserPerson.id`.
4. `GET /v1/user/{id}/registry?public_identifier_token={clave}` con la cabecera
   `X-Bunq-Client-Authentication`.

La "clave" es el trozo final del share link:
`tricount.com/es/tZqzdVuUqIcJBaTVmo` → `tZqzdVuUqIcJBaTVmo`.
**No se envía ninguna credencial vuestra ni contraseña.** El `app_installation_uuid`
se guarda en `db.json` para no registrar una instalación nueva en cada sync.

De ahí sacamos `Registry.memberships[]` (los tres) y `Registry.all_registry_entry[]`
(los gastos: fecha, concepto, quién pagó, importe, categoría y el reparto en
`allocations`). Los balances los calculamos nosotros —
`pagado − lo que le toca`, positivo = le deben — y el "para saldar cuentas" con
un algoritmo de mínimas transferencias en `settle()`.

### Consecuencias que hay que aceptar de entrada

1. **Solo lectura.** La app muestra balances y gastos; para *añadir* un gasto se
   abre Tricount. La lista de la compra sí es nuestra y sí es editable.
2. **Se puede romper sin aviso** si Tricount cambia su API. Por eso va aislado en
   `server/tricount.js` detrás de una interfaz de dos funciones
   (`fetchBalances()`, `fetchExpenses()`).
3. **Degrada, no revienta.** Si la sync falla, la app sirve el último snapshot
   guardado en `db.json` y enseña "◷ datos de hace X" en amarillo. Nunca pantalla
   en blanco.
4. **Plan B ya listo:** importar el CSV/Excel que exporta Tricount. Mismo formato
   de destino en el JSON, así que es cambiar la fuente y nada más.

### Sin verificar todavía

El código está escrito pero **no he podido probarlo contra un tricount real**:
el sandbox donde trabajo bloquea la salida hacia `api.tricount.bunq.com`
(`403 Host not in allowlist` — es mi proxy, no Tricount). Lo que sí está probado
aquí: el parseo del share link, el cálculo de balances y el algoritmo de saldo.

La prueba de fuego la haces tú en un comando:

```bash
node tools/test-tricount.mjs "https://tricount.com/es/VUESTRA_CLAVE"
```

Imprime miembros, balances, quién paga a quién y los últimos gastos. **Si eso
sale, la Fase 5 es media tarde. Si no sale, plan B y seguimos igual.**

---

## 5. Pasos

**Fase 0 — Andamio** *(~1 h)*
Crear repo, `.devcontainer`, `package.json` con workspaces, `db.example.json`.
Levantar un Express que devuelve `{"ok":true}` y un Vite que pinta "hola".

**Fase 1 — Datos y horario** *(~2 h)*
`db.js` con carga + escritura atómica en cola. Semilla del `db.json` con las 3
personas y el horario real. `GET /api/state`. Pantalla **Horario** en React
leyendo de la API (aún sin editar).

**Fase 2 — La pestaña que de verdad se usa** *(~3 h)*
`POST /api/tasks/toggle` + pantalla **Esta semana**: pendientes, hechas,
detección de retraso (`hoy > último día de la ventana && !completada`).
Esta es la fase que decide si el proyecto sirve — pruébala una semana real
antes de seguir.

**Fase 3 — Lista de la compra** *(~2 h)*
CRUD completo, sin Tricount todavía. Media pantalla de **Compra y gastos** ya
funcionando.

**Fase 4 — Dashboard** *(~3 h)*
`stats.js`: cumplimiento por persona, tendencia semanal, zonas más olvidadas,
rachas. Pantalla **Dashboard** con los tiles y las barras del mockup.

**Fase 5 — Tricount** *(~2 h, la de riesgo — el cliente ya está escrito)*
`server/tricount.js` y `tools/test-tricount.mjs` ya están en el repo. Primer
paso: correr el script con vuestro share link. Si imprime los balances,
integrarlo (sync cada 30 min, snapshot en `db.json`, badge de frescura, botón
"Sincronizar"). Si falla, plan B (CSV) y seguir sin bloquearse.

> Esta fase se puede adelantar y hacer **hoy**, antes que ninguna otra: es la
> única con riesgo real, y saber si funciona cambia el plan.

**Fase 6 — Ponerlo en el piso** *(~2 h)*
`npm run build`, Express sirviendo estáticos, IP fija en el router, arranque
automático (`pm2` o un servicio systemd si va en Raspberry). Añadir a la
pantalla de inicio del móvil con un `manifest.json` — se ve como una app.

**Fase 7 — Extras si apetece**
Notas/incidencias, recordatorio por Telegram el domingo por la noche, rotación
automática del horario cada 4 semanas.

---

## Decisiones que quedan abiertas

1. **Basura rotativa** — ¿es realmente rotativa o cada uno tiene sus días fijos?
   El mockup asume rotación; el esquema soporta ambas.
2. **¿Qué cuenta como "a tiempo"?** Ahora mismo: marcado dentro de la ventana de
   días. Si se marca después, cuenta pero como "con retraso".
3. **La semana empieza el lunes** y se identifica como `2026-W34` (ISO).
4. **Zona horaria** fijada a `Europe/Madrid` en todo el stack.
5. **URL del Tricount** — hace falta el share link para la Fase 5.
