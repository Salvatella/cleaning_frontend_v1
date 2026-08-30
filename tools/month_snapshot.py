#!/usr/bin/env python3
"""
tools/month_snapshot.py — congela un mes en un snapshot estático.

Se ejecuta una vez al final de cada mes:

    python tools/month_snapshot.py                # el mes que acaba de terminar
    python tools/month_snapshot.py --month 2026-06
    python tools/month_snapshot.py --month 2026-06 --no-tricount

De dónde saca los checks:
    --source db          db.json         (modo servidor local, por defecto)
    --source supabase    la nube         (modo estático; lee SUPABASE_URL y
                                          SUPABASE_KEY del entorno o de
                                          supabase/config.local.json)

Qué hace:
  1. Lee db.json (los checks que los tres han ido marcando durante el mes).
  2. Sincroniza con Tricount para tener los gastos definitivos del mes.
  3. Calcula las estadísticas del mes: cumplimiento, zonas olvidadas, rachas.
  4. Escribe snapshots/YYYY-MM.json y actualiza snapshots/index.json.

El resultado son ficheros ESTÁTICOS: se pueden publicar en GitHub Pages tal
cual, sin ningún servidor detrás. El dashboard los lee y ya.

Dependencias:  pip install requests cryptography
"""

import argparse
import json
import sys
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "db.json"
SNAP_DIR = ROOT / "snapshots"

MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
         "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]


# ---------------------------------------------------------------- Supabase ---

def load_dotenv():
    """
    Carga el .env del root del proyecto en el entorno, sin dependencias.

    Solo rellena lo que no esté ya definido: una variable de entorno real
    siempre gana sobre el fichero.
    """
    import os
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def load_tricount_url(db):
    """
    De dónde sale el enlace del tricount, por orden de preferencia:
      1. TRICOUNT_URL del entorno o del .env   ← recomendado
      2. el campo `tricount.url` de db.json    ← compatibilidad
    Ninguno de los dos se sube al repo: ambos están en .gitignore.
    """
    import os
    load_dotenv()
    return os.environ.get("TRICOUNT_URL") or (db.get("tricount") or {}).get("url") or ""


def load_supabase_config():
    """La URL y la clave anon, del entorno o de supabase/config.local.json."""
    import os
    load_dotenv()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    cfg = ROOT / "supabase" / "config.local.json"
    if (not url or not key) and cfg.exists():
        data = json.loads(cfg.read_text(encoding="utf8"))
        url = url or data.get("url")
        key = key or data.get("anonKey")
    if not url or not key:
        raise SystemExit(
            "Faltan las credenciales de Supabase.\n"
            "  export SUPABASE_URL=... y SUPABASE_KEY=...\n"
            "  o crea supabase/config.local.json con {\"url\": ..., \"anonKey\": ...}"
        )

    # El panel de Supabase enseña la URL con el sufijo /rest/v1/, y es fácil
    # copiarla entera. Lo quitamos: aquí solo queremos el host del proyecto.
    url = url.strip().rstrip("/")
    if url.endswith("/rest/v1"):
        url = url[: -len("/rest/v1")]

    if key.startswith("sb_secret_") or key.startswith("eyJ") and "service_role" in key:
        raise SystemExit(
            "Esa parece la clave SECRETA de Supabase. Usa la publishable\n"
            "(sb_publishable_...): la secreta salta todas las reglas RLS y no\n"
            "debe salir de un backend."
        )

    return url, key


def fetch_checks_from_supabase():
    """Los checks de la nube, con la forma que espera el resto del script."""
    import requests

    url, key = load_supabase_config()
    res = requests.get(f"{url}/rest/v1/checks", params={"select": "*"},
                       headers={"apikey": key, "Authorization": f"Bearer {key}"},
                       timeout=20)
    res.raise_for_status()
    return [{
        "occId": r["occ_id"],
        "shiftId": r["shift_id"],
        "zoneId": r["zone_id"],
        "week": r["week"],
        "day": r["day"],
        "by": r["person"],
        "at": r["created_at"],
    } for r in res.json()]


# ---------------------------------------------------------------- Tricount ---

BASE = "https://api.tricount.bunq.com"
USER_AGENT = "com.bunq.tricount.android:RELEASE:7.0.7:3174:ANDROID:13:C"


def parse_key(url_or_key: str) -> str:
    """https://tricount.com/tqQWpYEJCYRhBwPzjJ  ->  tqQWpYEJCYRhBwPzjJ"""
    s = str(url_or_key).strip().rstrip("/")
    return s.split("/")[-1].split("?")[0] if "/" in s else s


def fetch_tricount(url_or_key: str, app_id: str):
    """
    Mismo protocolo que server/tricount.js, en Python.

    Solo lectura. Genera un par RSA, registra una instalación anónima y pide
    el tricount por su clave pública. Ninguna credencial vuestra viaja.
    """
    import requests
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = parse_key(url_or_key)

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "app-id": app_id,
        "X-Bunq-Client-Request-Id": str(uuid.uuid4()),
        "Content-Type": "application/json",
    })

    auth = session.post(f"{BASE}/v1/session-registry-installation", json={
        "app_installation_uuid": app_id,
        "client_public_key": public_pem,
        "device_description": "Android",
    }, timeout=20)
    auth.raise_for_status()

    items = auth.json().get("Response", [])
    token = next((i["Token"]["token"] for i in items if "Token" in i), None)
    user_id = next((i["UserPerson"]["id"] for i in items if "UserPerson" in i), None)
    if not token or not user_id:
        raise RuntimeError("Respuesta de auth inesperada (¿cambió la API?)")

    session.headers["X-Bunq-Client-Authentication"] = token
    res = session.get(f"{BASE}/v1/user/{user_id}/registry",
                      params={"public_identifier_token": key}, timeout=20)
    res.raise_for_status()

    registry = (res.json().get("Response") or [{}])[0].get("Registry")
    if not registry:
        raise RuntimeError(f'Autenticación OK, pero no existe el tricount "{key}"')

    def member_name(m):
        e = (m or {}).get("RegistryMembershipNonUser") or m or {}
        alias = e.get("alias") or {}
        return alias.get("display_name") or (alias.get("pointer") or {}).get("name")

    members, paid, consumed, expenses = [], {}, {}, []
    currency = None

    for m in registry.get("memberships") or []:
        e = m.get("RegistryMembershipNonUser")
        if e:
            members.append({"id": str(e["id"]), "name": member_name(m)})

    for raw in registry.get("all_registry_entry") or []:
        e = raw.get("RegistryEntry")
        if not e or (e.get("status") and e["status"] != "ACTIVE"):
            continue
        if e.get("type_transaction") == "BALANCE":   # reembolso, no gasto
            continue

        amount = abs(float((e.get("amount") or {}).get("value") or 0))
        payer = member_name(e.get("membership_owned")) or "desconocido"
        currency = currency or (e.get("amount") or {}).get("currency")

        paid[payer] = paid.get(payer, 0) + amount

        allocations = {}
        for a in e.get("allocations") or []:
            who = member_name(a.get("membership")) or "desconocido"
            share = abs(float((a.get("amount") or {}).get("value") or 0))
            consumed[who] = consumed.get(who, 0) + share
            allocations[who] = round(allocations.get(who, 0) + share, 2)

        expenses.append({
            "date": str(e.get("date"))[:10] if e.get("date") else None,
            "title": e.get("description") or "(sin concepto)",
            "category": e.get("category"),
            "paidBy": payer,
            "amount": round(amount, 2),
            # Guardamos el reparto para poder recalcular balances mes a mes.
            "allocations": allocations,
        })

    expenses.sort(key=lambda x: x["date"] or "", reverse=True)

    # Positivo = le deben dinero.
    balances = [{
        "person": m["name"],
        "paid": round(paid.get(m["name"], 0), 2),
        "share": round(consumed.get(m["name"], 0), 2),
        "amount": round(paid.get(m["name"], 0) - consumed.get(m["name"], 0), 2),
    } for m in members]

    return {
        "title": registry.get("title"),
        "currency": currency or "EUR",
        "members": members,
        "balances": balances,
        "expenses": expenses,
        "total": round(sum(x["amount"] for x in expenses), 2),
        "fetchedAt": datetime.now().astimezone().isoformat(),
    }


def settle(balances):
    """Quién paga a quién, con el mínimo de transferencias."""
    creditors = sorted([dict(b) for b in balances if b["amount"] > 0.005],
                       key=lambda b: -b["amount"])
    debtors = sorted([dict(b) for b in balances if b["amount"] < -0.005],
                     key=lambda b: b["amount"])
    moves, i, j = [], 0, 0
    while i < len(debtors) and j < len(creditors):
        amount = min(-debtors[i]["amount"], creditors[j]["amount"])
        if amount > 0.005:
            moves.append({"from": debtors[i]["person"],
                          "to": creditors[j]["person"],
                          "amount": round(amount, 2)})
        debtors[i]["amount"] += amount
        creditors[j]["amount"] -= amount
        if abs(debtors[i]["amount"]) < 0.005:
            i += 1
        if abs(creditors[j]["amount"]) < 0.005:
            j += 1
    return moves


# ---------------------------------------------------------------- horario ---
# Réplica exacta de server/schedule.js. Si cambias la lógica ahí, cámbiala aquí.

MONDAY_EPOCH = date(1970, 1, 5)   # el primer lunes de la era Unix


def week_key(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def week_start(key: str) -> date:
    year, w = key.split("-W")
    return date.fromisocalendar(int(year), int(w), 1)


def week_index(key: str) -> int:
    return (week_start(key) - MONDAY_EPOCH).days // 7


def rotation_for_week(cleaning: dict, week: str):
    """Dos turnos por semana rotando entre las personas; la tercera descansa."""
    people = cleaning.get("rotation") or []
    shifts = cleaning.get("shifts") or []
    if not people or not shifts:
        return []
    offset = week_index(week) - week_index(cleaning.get("anchorWeek") or week)
    n = len(people)
    return [
        {"shift": shift, "assignee": people[(offset * len(shifts) + i) % n]}
        for i, shift in enumerate(shifts)
    ]


def turns_for_week(db: dict, week: str):
    """Los turnos de esa semana, cada uno con su checklist de zonas y su estado."""
    zones = db.get("cleaning", {}).get("zones") or []
    done = {c["occId"]: c for c in db.get("completions", []) if c.get("week") == week}

    out = []
    for entry in rotation_for_week(db.get("cleaning", {}), week):
        shift, assignee = entry["shift"], entry["assignee"]
        days = sorted(shift.get("days") or [])
        due = days[-1] if days else 7

        zs = []
        for z in zones:
            occ_id = f"{shift['id']}:{week}:{z['id']}"
            c = done.get(occ_id)
            zs.append({
                "zoneId": z["id"],
                "name": z["name"],
                "done": bool(c),
                "onTime": (c.get("day") is None or c["day"] <= due) if c else None,
                "at": c.get("at") if c else None,
            })

        done_count = sum(1 for z in zs if z["done"])
        out.append({
            "id": f"{shift['id']}:{week}",
            "label": shift.get("label"),
            "week": week,
            "assignee": assignee,
            "days": days,
            "dueDay": due,
            "zones": zs,
            "doneCount": done_count,
            "zoneCount": len(zs),
            "complete": len(zs) > 0 and done_count == len(zs),
        })
    return out


def weeks_of_month(month: str):
    """
    Las semanas ISO que pertenecen al mes.

    Criterio: una semana pertenece al mes de su LUNES. Así ninguna semana se
    cuenta dos veces ni se pierde en los cambios de mes.
    """
    year, mon = (int(x) for x in month.split("-"))
    d = date(year, mon, 1)
    end = date(year + (mon == 12), (mon % 12) + 1, 1)
    keys = []
    while d < end:
        if d.weekday() == 0:          # lunes
            keys.append(week_key(d))
        d += timedelta(days=1)
    return keys


# --------------------------------------------------------------- snapshot ---

def build_snapshot(db: dict, month: str, tricount: dict | None):
    people = db.get("people", [])
    by_id = {p["id"]: p for p in people}
    weeks = weeks_of_month(month)

    all_turns = [t for w in weeks for t in turns_for_week(db, w)]
    all_zones = [
        {**z, "assignee": t["assignee"], "week": t["week"]}
        for t in all_turns for z in t["zones"]
    ]

    total = len(all_zones)
    done = sum(1 for z in all_zones if z["done"])

    per_person = []
    for p in people:
        mine = [z for z in all_zones if z["assignee"] == p["id"]]
        my_turns = [t for t in all_turns if t["assignee"] == p["id"]]
        on_time = sum(1 for z in mine if z["done"] and z["onTime"])
        per_person.append({
            "id": p["id"], "name": p["name"], "color": p.get("color"),
            "zones": len(mine),
            "done": sum(1 for z in mine if z["done"]),
            "onTime": on_time,
            "pct": round(on_time / len(mine) * 100) if mine else None,
            "turns": len(my_turns),
            "turnsComplete": sum(1 for t in my_turns if t["complete"]),
        })

    per_week = []
    for w in weeks:
        ts = turns_for_week(db, w)
        zs = [z for t in ts for z in t["zones"]]
        d = sum(1 for z in zs if z["done"])
        per_week.append({
            "week": w,
            "total": len(zs),
            "done": d,
            "pct": round(d / len(zs) * 100) if zs else None,
            "turns": [{"assignee": t["assignee"], "label": t["label"],
                       "done": t["doneCount"], "total": t["zoneCount"]} for t in ts],
            "resting": [p["id"] for p in people
                        if p["id"] not in {t["assignee"] for t in ts}],
        })

    skipped = {}
    for z in all_zones:
        if not z["done"]:
            skipped[z["name"]] = skipped.get(z["name"], 0) + 1
    skipped_zones = sorted(
        ({"zone": k, "count": v} for k, v in skipped.items()),
        key=lambda x: -x["count"],
    )

    year, mon = (int(x) for x in month.split("-"))
    snapshot = {
        "month": month,
        "title": f"Dashboard de {MESES[mon]} {year}",
        "generatedAt": datetime.now().astimezone().isoformat(),
        "people": people,
        "cleaning": {
            "zones": db.get("cleaning", {}).get("zones", []),
            "shifts": db.get("cleaning", {}).get("shifts", []),
        },
        "stats": {
            "weeks": len(weeks),
            "total": total,
            "done": done,
            "pct": round(done / total * 100) if total else None,
            "turns": len(all_turns),
            "turnsComplete": sum(1 for t in all_turns if t["complete"]),
            "perPerson": per_person,
            "perWeek": per_week,
            "skippedZones": skipped_zones,
        },
        "tricount": None,
    }

    if tricount:
        # Gastos de ESTE mes, y balances recalculados solo con ellos.
        month_exp = [e for e in tricount["expenses"] if (e.get("date") or "").startswith(month)]
        paid, share = {}, {}
        for e in month_exp:
            paid[e["paidBy"]] = paid.get(e["paidBy"], 0) + e["amount"]
            for who, amt in (e.get("allocations") or {}).items():
                share[who] = share.get(who, 0) + amt

        month_balances = [{
            "person": m["name"],
            "paid": round(paid.get(m["name"], 0), 2),
            "share": round(share.get(m["name"], 0), 2),
            "amount": round(paid.get(m["name"], 0) - share.get(m["name"], 0), 2),
        } for m in tricount["members"]]

        snapshot["tricount"] = {
            "title": tricount.get("title"),
            "currency": tricount.get("currency", "EUR"),
            "syncedAt": tricount.get("fetchedAt"),
            "monthTotal": round(sum(e["amount"] for e in month_exp), 2),
            "monthExpenses": month_exp,
            "monthBalances": month_balances,
            # El balance acumulado de todo el tricount, no solo del mes.
            "overallBalances": tricount["balances"],
            "overallSettlements": settle(tricount["balances"]),
            "overallTotal": tricount.get("total"),
        }

    return snapshot


def main():
    ap = argparse.ArgumentParser(description="Congela un mes en snapshots/YYYY-MM.json")
    ap.add_argument("--month", help="YYYY-MM (por defecto: el mes que acaba de terminar)")
    ap.add_argument("--no-tricount", action="store_true", help="No sincronizar gastos")
    ap.add_argument("--db", default=str(DB_PATH), help="Ruta a db.json")
    ap.add_argument("--source", choices=["db", "supabase"], default="db",
                    help="De dónde salen los checks (por defecto: db.json)")
    args = ap.parse_args()

    if args.month:
        month = args.month
    else:
        today = date.today()
        last = today.replace(day=1) - timedelta(days=1)
        month = f"{last.year}-{last.month:02d}"

    db = json.loads(Path(args.db).read_text(encoding="utf8"))

    if args.source == "supabase":
        # La config del piso (zonas, turnos, rotación) sigue en db.json; solo
        # los checks vienen de la nube.
        db["completions"] = fetch_checks_from_supabase()
        print(f"✓ Supabase: {len(db['completions'])} checks")

    tricount = None
    if not args.no_tricount:
        url = load_tricount_url(db)
        if not url:
            print("⚠️  Sin TRICOUNT_URL (ni en .env ni en db.json) — "
                  "snapshot solo de limpieza.")
        else:
            app_id = (db.get("tricount") or {}).get("appInstallationId") or str(uuid.uuid4())
            try:
                tricount = fetch_tricount(url, app_id)
                print(f"✓ Tricount: {len(tricount['expenses'])} gastos en total")
            except Exception as err:
                # Que falle Tricount no debe impedir archivar el mes de limpieza.
                print(f"⚠️  Tricount falló ({err}) — snapshot solo de limpieza.")

    snapshot = build_snapshot(db, month, tricount)

    SNAP_DIR.mkdir(exist_ok=True)
    out = SNAP_DIR / f"{month}.json"
    out.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf8")

    # Los gastos actuales, para que la web estática los muestre sin llamar a
    # Tricount (su API no admite peticiones desde el navegador).
    if tricount:
        (SNAP_DIR / "tricount.json").write_text(json.dumps({
            # El enlace NO se escribe en el snapshot: ese fichero puede
            # acabar publicado. Solo van los datos ya resueltos.
            "url": "",
            "title": tricount.get("title"),
            "currency": tricount.get("currency"),
            "lastSync": tricount.get("fetchedAt"),
            "status": "ok",
            "balances": tricount["balances"],
            "settlements": settle(tricount["balances"]),
            "expenses": tricount["expenses"],
            "total": tricount.get("total"),
        }, ensure_ascii=False, indent=2), encoding="utf8")

    # Índice de meses disponibles, para que el dashboard sepa navegar.
    months = sorted(p.stem for p in SNAP_DIR.glob("*.json")
                    if p.stem not in ("index", "tricount"))
    index = {
        "months": months,
        "latest": months[-1] if months else None,
        "updatedAt": datetime.now().astimezone().isoformat(),
    }
    (SNAP_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf8")

    st = snapshot["stats"]
    print(f"\n✅ {snapshot['title']}  →  snapshots/{month}.json")
    print(f"   {st['weeks']} semanas · {st['done']}/{st['total']} zonas "
          f"({st['pct'] if st['pct'] is not None else '—'}%)")
    for p in st["perPerson"]:
        pct = f"{p['pct']}%" if p["pct"] is not None else "—"
        print(f"     {p['name']:<10} {p['done']}/{p['zones']} zonas · {pct} a tiempo")
    if snapshot["tricount"]:
        t = snapshot["tricount"]
        print(f"   Gastos del mes: {t['monthTotal']} {t['currency']} "
              f"({len(t['monthExpenses'])} apuntes)")
    print(f"   Meses archivados: {', '.join(months)}\n")


if __name__ == "__main__":
    main()
