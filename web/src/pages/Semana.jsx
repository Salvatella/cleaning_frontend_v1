import { useEffect, useState } from 'react';
import { loadHistory, toggleZone } from '../store.js';
import { Check, DAY_SHORT, Pill, when } from '../components/bits.jsx';

export default function Semana({ state, setState }) {
  const { tasks, people, week, resting } = state;
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    loadHistory(4, state).then(setHistory).catch(() => {});
  }, [week, state]);

  async function marcar(turn, zone) {
    setBusy(zone.id);
    try {
      const res = await toggleZone(zone.id, turn.assignee, state);
      setState((s) => ({ ...s, tasks: res.tasks }));
      loadHistory(4, state).then(setHistory).catch(() => {});
    } catch (err) {
      alert(`No se pudo guardar: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  const totalZones = tasks.reduce((n, t) => n + t.zoneCount, 0);
  const doneZones = tasks.reduce((n, t) => n + t.doneCount, 0);
  const left = totalZones - doneZones;

  return (
    <>
      <div className="head">
        <div>
          <h1>Esta semana</h1>
          <p className="sub">
            {left === 0
              ? '¡Todo hecho! 🎉'
              : `Quedan ${left} ${left === 1 ? 'zona' : 'zonas'} por limpiar`}
            {resting?.length > 0 &&
              ` · descansa ${resting.map((id) => byId[id]?.name ?? id).join(', ')}`}
          </p>
        </div>
      </div>

      <div className="grid2 even">
        {tasks.map((turn) => (
          <TurnCard
            key={turn.id}
            turn={turn}
            person={byId[turn.assignee]}
            busy={busy}
            onToggle={(z) => marcar(turn, z)}
          />
        ))}
      </div>

      <div className="card mt">
        <h2>Historial</h2>
        <p className="cap">Zonas completadas por persona · últimas 4 semanas</p>
        <table>
          <thead>
            <tr>
              <th>Semana</th>
              {people.map((p) => <th key={p.id}>{p.name}</th>)}
              <th>Total piso</th>
            </tr>
          </thead>
          <tbody>
            {history.map(({ week: w, tasks: ts }) => {
              const active = ts.filter((t) => t.status !== 'upcoming');
              const zTotal = active.reduce((n, t) => n + t.zoneCount, 0);
              const zDone = active.reduce((n, t) => n + t.doneCount, 0);
              return (
                <tr key={w}>
                  <td>{w === week ? `${w} (actual)` : w}</td>
                  {people.map((p) => {
                    const mine = active.filter((t) => t.assignee === p.id);
                    if (!mine.length) {
                      return <td key={p.id} style={{ color: 'var(--muted)' }}>descansa</td>;
                    }
                    const d = mine.reduce((n, t) => n + t.doneCount, 0);
                    const tt = mine.reduce((n, t) => n + t.zoneCount, 0);
                    const cls = d === tt ? 'ok' : d === 0 ? 'late' : 'pend';
                    return (
                      <td key={p.id}>
                        <span className={`pill ${cls}`}>{d}/{tt}</span>
                      </td>
                    );
                  })}
                  <td>{zTotal ? `${Math.round((zDone / zTotal) * 100)}%` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** La checklist de una persona: todas las zonas, marcables una a una. */
function TurnCard({ turn, person, busy, onToggle }) {
  const pct = turn.zoneCount ? (turn.doneCount / turn.zoneCount) * 100 : 0;

  return (
    <div className="card">
      <div className="turn-head">
        <span className="avatar" style={{ background: person?.color ?? '#898781' }}>
          {person?.name?.[0] ?? '?'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 15 }}>{person?.name ?? turn.assignee}</h2>
          <p className="cap" style={{ margin: 0 }}>
            {turn.label} · {turn.days.map((d) => DAY_SHORT[d]).join(' · ')}
          </p>
        </div>
        <Pill status={turn.status} onTime={turn.onTime} daysLate={turn.daysLate} />
      </div>

      <div className="progress">
        <div className="track" style={{ flex: 1 }}>
          <div
            className="fill"
            style={{ width: `${pct}%`, background: person?.color ?? '#2a78d6' }}
          />
        </div>
        <span className="pct">{turn.doneCount}/{turn.zoneCount}</span>
      </div>

      {turn.zones.map((z) => (
        <div className={`chk${z.done ? ' is-done' : ''}`} key={z.id}>
          <Check
            done={z.done}
            onClick={() => onToggle(z)}
            title={z.done ? 'Desmarcar' : 'Marcar como hecha'}
          />
          <div className="t">
            <b>{z.name}</b>
            {z.done && (
              <span>
                {when(z.at)}
                {z.onTime === false && ' · con retraso'}
              </span>
            )}
          </div>
          {busy === z.id && <span className="cap">…</span>}
        </div>
      ))}
    </div>
  );
}
