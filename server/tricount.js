/**
 * server/tricount.js — cliente de la API interna de Tricount (solo lectura).
 *
 * Cero dependencias: usa `fetch` y `node:crypto` nativos (Node 18+).
 *
 * Protocolo derivado de dos clientes de ingeniería inversa, ambos MIT:
 *   - https://github.com/melalj/tricount-exporter      (Node)
 *   - https://github.com/marinoo3/TricountAPI-python   (Python)
 *
 * ⚠️  Tricount NO tiene API pública. Esto habla con `api.tricount.bunq.com`,
 *     la API interna de la app Android (Tricount es de bunq). Puede dejar de
 *     funcionar sin aviso. Todo el proyecto debe tratar este módulo como una
 *     fuente que puede fallar: si falla, se sirve el último snapshot.
 *
 * Solo lectura. No existe forma de crear gastos por aquí.
 */

import { generateKeyPairSync, randomUUID } from 'node:crypto';

const BASE = 'https://api.tricount.bunq.com';

// La app Android se identifica así. Si cambian de versión y esto deja de
// funcionar, es el primer sitio donde mirar.
const USER_AGENT = 'com.bunq.tricount.android:RELEASE:7.0.7:3174:ANDROID:13:C';

/**
 * Extrae la clave pública del tricount desde su share link.
 *   https://tricount.com/es/tZqzdVuUqIcJBaTVmo  →  "tZqzdVuUqIcJBaTVmo"
 * Acepta también la clave suelta.
 */
export function parseTricountKey(urlOrKey) {
  if (!urlOrKey) throw new Error('Falta la URL o la clave del tricount');
  const trimmed = String(urlOrKey).trim().replace(/\/+$/, '');
  const key = trimmed.includes('/') ? trimmed.split('/').pop().split('?')[0] : trimmed;
  if (!key) throw new Error(`No se pudo extraer la clave de: ${urlOrKey}`);
  if (/^(VUESTRA_CLAVE|TU_CLAVE|CLAVE|AquíLaClaveReal)$/i.test(key)) {
    throw new Error(
      'Eso sigue siendo el texto de ejemplo. Pega el enlace real del tricount ' +
        '(en la app: Compartir → Copiar enlace).'
    );
  }
  return key;
}

/**
 * Abre una sesión anónima. Genera un par de claves RSA y manda solo la
 * pública — no se envía ninguna credencial vuestra ni contraseña.
 *
 * `appId` debería ser estable entre ejecuciones (guárdalo en db.json), para
 * no registrar una instalación nueva en cada sync.
 */
async function openSession(appId) {
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const headers = {
    'User-Agent': USER_AGENT,
    'app-id': appId,
    'X-Bunq-Client-Request-Id': randomUUID(),
    'Content-Type': 'application/json',
  };

  const res = await fetch(`${BASE}/v1/session-registry-installation`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      app_installation_uuid: appId,
      client_public_key: publicKey,
      device_description: 'Android',
    }),
  });

  if (!res.ok) {
    throw new Error(`Auth falló: HTTP ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const items = json?.Response ?? [];

  // Los clientes originales acceden por índice fijo (Response[1], Response[3]).
  // Buscamos por clave: sobrevive a que bunq reordene el array.
  const token = items.find((i) => i?.Token)?.Token?.token;
  const userId = items.find((i) => i?.UserPerson)?.UserPerson?.id;

  if (!token || !userId) {
    throw new Error(
      'Respuesta de auth inesperada (¿cambió la API?): ' +
        JSON.stringify(json).slice(0, 400)
    );
  }

  return { token, userId, headers: { ...headers, 'X-Bunq-Client-Authentication': token } };
}

const num = (v) => (v == null ? 0 : Number.parseFloat(v));
const round2 = (n) => Math.round(n * 100) / 100;

/** Nombre visible de un miembro, con los dos caminos que usan los clientes. */
function memberName(m) {
  const e = m?.RegistryMembershipNonUser ?? m;
  return e?.alias?.display_name ?? e?.alias?.pointer?.name ?? null;
}

/**
 * Descarga un tricount y lo normaliza al formato que guardamos en db.json.
 *
 * @param {string} urlOrKey  share link del tricount, o su clave
 * @param {object} opts
 * @param {string} opts.appId  UUID estable de instalación (recomendado)
 * @param {number} opts.timeoutMs
 * @returns {Promise<{title,currency,members,balances,expenses,fetchedAt}>}
 */
export async function fetchTricount(
  urlOrKey,
  { appId = randomUUID(), timeoutMs = 15000, includeRaw = false } = {}
) {
  const key = parseTricountKey(urlOrKey);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const session = await openSession(appId);

    const url = `${BASE}/v1/user/${session.userId}/registry?public_identifier_token=${encodeURIComponent(key)}`;
    const res = await fetch(url, { headers: session.headers, signal: ac.signal });

    if (!res.ok) {
      throw new Error(
        `No se pudo leer el tricount: HTTP ${res.status}. ` +
          `¿La clave "${key}" es correcta y el tricount es accesible por enlace?`
      );
    }

    const json = await res.json();
    const registry = json?.Response?.[0]?.Registry;
    if (!registry) {
      // Ojo: si llegamos hasta aquí, la autenticación SÍ funcionó (tenemos
      // token y user id). El problema es la clave del tricount, no la API.
      throw new Error(
        `Autenticación OK, pero no existe ningún tricount con la clave "${key}". ` +
          'Copia el enlace desde la app: Compartir → Copiar enlace.'
      );
    }

    // ---- Miembros -------------------------------------------------------
    const members = (registry.memberships ?? [])
      .map((m) => {
        const e = m?.RegistryMembershipNonUser;
        if (!e) return null;
        return { id: String(e.id), name: memberName(m) };
      })
      .filter(Boolean);

    // ---- Gastos ---------------------------------------------------------
    const paid = new Map();     // nombre → total adelantado
    const consumed = new Map(); // nombre → total que le corresponde
    const expenses = [];
    let currency = null;

    // Diagnóstico: distingue "no vino nada" de "vino pero lo filtré todo".
    const entryList = registry.all_registry_entry ?? [];
    const diag = {
      rawEntries: entryList.length,
      noRegistryEntry: 0,
      skippedByStatus: 0,
      skippedAsTransfer: 0,
      statusesSeen: new Set(),
      typesSeen: new Set(),
      registryKeys: Object.keys(registry),
    };

    for (const raw of entryList) {
      const e = raw?.RegistryEntry;
      if (!e) {
        diag.noRegistryEntry++;
        continue;
      }
      if (e.status) diag.statusesSeen.add(e.status);
      if (e.type_transaction) diag.typesSeen.add(e.type_transaction);
      if (e.status && e.status !== 'ACTIVE') {
        diag.skippedByStatus++;
        continue;
      }

      // BALANCE = un reembolso entre personas, no un gasto del piso.
      const isTransfer = e.type_transaction === 'BALANCE';
      if (isTransfer) diag.skippedAsTransfer++;

      const amount = Math.abs(num(e.amount?.value ?? e.amount_local?.value));
      const payer = memberName(e.membership_owned) ?? 'desconocido';
      currency ??= e.amount?.currency ?? null;

      paid.set(payer, (paid.get(payer) ?? 0) + (isTransfer ? 0 : amount));

      for (const a of e.allocations ?? []) {
        const who = memberName(a?.membership) ?? 'desconocido';
        const share = Math.abs(num(a?.amount?.value));
        if (!isTransfer) consumed.set(who, (consumed.get(who) ?? 0) + share);
      }

      if (!isTransfer) {
        expenses.push({
          date: e.date ? String(e.date).slice(0, 10) : null,
          title: e.description ?? '(sin concepto)',
          category: e.category ?? null,
          paidBy: payer,
          amount: round2(amount),
          currency: e.amount?.currency ?? currency,
        });
      }
    }

    expenses.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    // ---- Balances -------------------------------------------------------
    // Convención de la app y del mockup: POSITIVO = te deben dinero.
    // (El exporter original usa el signo contrario; aquí lo invertimos.)
    const balances = members.map(({ name }) => ({
      person: name,
      paid: round2(paid.get(name) ?? 0),
      share: round2(consumed.get(name) ?? 0),
      amount: round2((paid.get(name) ?? 0) - (consumed.get(name) ?? 0)),
    }));

    return {
      title: registry.title ?? null,
      currency: currency ?? registry.currency ?? null,
      members,
      balances,
      expenses,
      total: round2(expenses.reduce((s, x) => s + x.amount, 0)),
      fetchedAt: new Date().toISOString(),
      diagnostics: {
        ...diag,
        statusesSeen: [...diag.statusesSeen],
        typesSeen: [...diag.typesSeen],
      },
      ...(includeRaw ? { raw: json } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quién le paga a quién para saldar cuentas, con el mínimo de transferencias.
 * (Esto es nuestro, no de la API: Tricount lo calcula igual.)
 */
export function settle(balances) {
  const creditors = balances.filter((b) => b.amount > 0.005).map((b) => ({ ...b }));
  const debtors = balances.filter((b) => b.amount < -0.005).map((b) => ({ ...b }));
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => a.amount - b.amount);

  const moves = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(-debtors[i].amount, creditors[j].amount);
    if (amount > 0.005) {
      moves.push({ from: debtors[i].person, to: creditors[j].person, amount: round2(amount) });
    }
    debtors[i].amount += amount;
    creditors[j].amount -= amount;
    if (Math.abs(debtors[i].amount) < 0.005) i++;
    if (Math.abs(creditors[j].amount) < 0.005) j++;
  }
  return moves;
}
