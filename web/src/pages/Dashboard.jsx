import { useEffect, useState } from 'react';
import { loadMonth, loadMonths } from '../store.js';
import { Bar, Tile, matchPerson, money } from '../components/bits.jsx';

const MES_CORTO = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const MES_LARGO = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const label = (m) => {
  const [y, mo] = m.split('-');
  return `${MES_CORTO[Number(mo)]} ${y}`;
};

/** "2026-09" → "septiembre de 2026". Para decir en cada sitio de qué va esto. */
const periodo = (m) => {
  const [y, mo] = m.split('-');
  return `${MES_LARGO[Number(mo)]} de ${y}`;
};

/** "semanas 36–40", o "semana 36" si el mes solo tiene una. */
function rangoSemanas(perWeek = []) {
  const nums = perWeek.map((w) => Number(w.week.split('-W')[1])).filter(Number.isFinite);
  if (!nums.length) return null;
  const a = Math.min(...nums);
  const b = Math.max(...nums);
  return a === b ? `semana ${a}` : `semanas ${a}–${b}`;
}

export default function Dashboard({ state }) {
  const [months, setMonths] = useState([]);
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadMonths()
      .then((res) => {
        setMonths(res.months);
        setSelected(res.current);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setData(null);
    loadMonth(selected, state).then(setData).catch((e) => setError(e.message));
  }, [selected, state]);

  if (error) return <p className="empty">No se pudo cargar: {error}</p>;
  if (!selected || !data) return <p className="empty">Cargando…</p>;

  const idx = months.findIndex((m) => m.month === selected);
  const older = months[idx + 1];   // la lista viene de más nuevo a más viejo
  const newer = months[idx - 1];
  const { stats, people, tricount } = data;
  const maxSkipped = Math.max(1, ...stats.skippedZones.map((z) => z.count));
  const ranked = [...stats.perPerson].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  const best = ranked.find((p) => p.zones > 0);

  // El mes del que habla TODA esta página. Se repite en cada bloque a
  // propósito: antes no se sabía si un KPI era del mes o de la semana.
  const mes = periodo(data.month);
  const semanas = rangoSemanas(stats.perWeek);

  return (
    <>
      <div className="head">
        <div>
          <h1>{data.title}</h1>
          <p className="sub">
            {mes}
            {semanas ? ` · ${semanas}` : ''} ·{' '}
            {data.live ? (
              <span className="tag live">● En curso</span>
            ) : (
              <span className="tag">Archivado</span>
            )}
          </p>
          <p className="sub hint">
            Todo lo de esta página es del <strong>mes entero</strong>. Lo que toca hacer
            ahora está en «Esta semana».
          </p>
        </div>

        <div className="monthnav">
          <button className="btn" disabled={!older} onClick={() => setSelected(older.month)}>
            ←
          </button>
          <select
            className="btn"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {label(m.month)}{m.live ? ' · en curso' : ''}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!newer} onClick={() => setSelected(newer.month)}>
            →
          </button>
        </div>
      </div>

      <div className="grid4">
        <Tile
          label="Cumplimiento"
          scope="todo el mes"
          value={stats.pct ?? '—'}
          unit={stats.pct != null ? '%' : ''}
        >
          {stats.done} de {stats.total} zonas del mes
        </Tile>
        <Tile
          label="Turnos completos"
          scope="todo el mes"
          value={stats.turnsComplete}
          unit={`/${stats.turns}`}
        >
          {stats.turns - stats.turnsComplete} quedaron a medias
        </Tile>
        <Tile
          label="Quien mejor cumple"
          scope="todo el mes"
          value={best?.pct != null ? `${best.pct}%` : '—'}
          color={best?.color}
        >
          {best?.name ?? 'sin datos'}
        </Tile>
        <Tile
          label="Gastos"
          scope="todo el mes"
          value={tricount ? money(tricount.monthTotal, tricount.currency) : '—'}
        >
          {tricount
            ? `${tricount.monthExpenses.length} apuntes en ${mes}`
            : 'Tricount sin configurar'}
        </Tile>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Cumplimiento por persona</h2>
          <p className="cap">% de zonas hechas a tiempo en {mes}</p>
          {ranked.every((p) => p.pct == null) ? (
            <p className="empty">Sin datos este mes.</p>
          ) : (
            ranked.map((p) => (
              <Bar key={p.id} label={p.name} value={p.pct ?? 0} color={p.color} dot={p.color}
                   display={p.pct == null ? '—' : `${p.pct}%`} />
            ))
          )}

          <h2 style={{ marginTop: 22 }}>Semana a semana</h2>
          <p className="cap">
            Una barra por cada semana de {mes}
            {semanas ? ` (${semanas})` : ''}
          </p>
          <WeekBars weeks={stats.perWeek} people={people} />
        </div>

        <div className="card">
          <h2>Zonas más olvidadas</h2>
          <p className="cap">Veces que se quedó sin hacer en {mes}</p>
          {stats.skippedZones.length === 0 ? (
            <p className="empty">Ninguna zona saltada. 👏</p>
          ) : (
            stats.skippedZones.map((z) => (
              <Bar key={z.zone} label={z.zone} value={z.count} max={maxSkipped} color="#9ec5f4" />
            ))
          )}

          <h2 style={{ marginTop: 22 }}>Reparto del mes</h2>
          <p className="cap">Turnos y zonas de cada uno en {mes}</p>
          <table>
            <thead>
              <tr><th>Persona</th><th>Turnos</th><th>Zonas</th><th>A tiempo</th></tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const s = stats.perPerson.find((x) => x.id === p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="person">
                        <span className="dot" style={{ background: p.color }} />{p.name}
                      </div>
                    </td>
                    <td>{s?.turnsComplete ?? 0}/{s?.turns ?? 0}</td>
                    <td>{s?.done ?? 0}/{s?.zones ?? 0}</td>
                    <td>{s?.pct == null ? '—' : `${s.pct}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {tricount?.monthExpenses?.length > 0 && (
        <div className="card mt">
          <h2>Gastos de {mes}</h2>
          <p className="cap">
            Solo los apuntes con fecha de {mes} · {money(tricount.monthTotal, tricount.currency)} en
            total. Los pagos entre nosotros no cuentan aquí: solo ajustan el balance.
          </p>
          <table className="stack-sm">
            <thead>
              <tr><th>Fecha</th><th>Concepto</th><th>Pagó</th><th className="num">Importe</th></tr>
            </thead>
            <tbody>
              {tricount.monthExpenses.map((e, i) => {
                const person = matchPerson(people, e.paidBy);
                return (
                  <tr key={i}>
                    <td>{e.date ?? '—'}</td>
                    <td>
                      {e.title}
                      {e.kind === 'income' && <span className="scope inline">ingreso</span>}
                    </td>
                    <td>
                      <div className="person">
                        <span className="dot" style={{ background: person?.color ?? '#898781' }} />
                        {e.paidBy}
                      </div>
                    </td>
                    <td className="num">{money(e.amount, tricount.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Una barra por semana del mes, con quién limpió debajo. */
function WeekBars({ weeks, people }) {
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const active = weeks.filter((w) => w.total > 0);
  if (!active.length) return <p className="empty">Todavía sin semanas cerradas.</p>;

  return (
    <div className="weekbars">
      {active.map((w) => (
        <div className="weekbar" key={w.week}>
          <div className="col">
            <div className="colfill" style={{ height: `${w.pct ?? 0}%` }} />
          </div>
          <span className="wk">sem {w.week.split('-W')[1]}</span>
          <span className="wpct">{w.pct}%</span>
          <span className="who">
            {w.turns.map((t) => (
              <i key={t.assignee} style={{ background: byId[t.assignee]?.color }}
                 title={`${byId[t.assignee]?.name}: ${t.done}/${t.total}`} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
