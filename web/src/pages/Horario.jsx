import { useEffect, useState } from 'react';
import { loadRotation } from '../store.js';

const DAY_NAMES = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const todayISO = () => ((new Date().getDay() + 6) % 7) + 1;

export default function Horario({ state }) {
  const { cleaning, people, tasks, week, resting } = state;
  const today = todayISO();
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const [next, setNext] = useState([]);

  useEffect(() => {
    loadRotation(6, state).then(setNext).catch(() => {});
  }, [week, state]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Horario</h1>
          <p className="sub">
            Cada semana limpian dos personas, tres días cada una. La tercera descansa y va rotando.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Esta semana</h2>
        <p className="cap">{week}</p>

        <div className="scroll-x">
          <div className="cal">
            <div />
            {DAY_NAMES.slice(1).map((d) => (
              <div className="h" key={d}>{d}</div>
            ))}

            {tasks.map((t) => {
              const person = byId[t.assignee];
              return (
                <Row key={t.id} label={t.label} person={person} days={t.days} today={today} />
              );
            })}
          </div>
        </div>

        <div className="legend">
          {people.map((p) => (
            <span key={p.id}><i style={{ background: p.color }} />{p.name}</span>
          ))}
          <span style={{ color: 'var(--muted)' }}>
            Recuadro negro = hoy ({DAY_NAMES[today].toLowerCase()})
          </span>
        </div>

        {resting?.length > 0 && (
          <div className="settle">
            <b>Descansa esta semana:</b>{' '}
            {resting.map((id) => byId[id]?.name ?? id).join(', ')}
          </div>
        )}
      </div>

      <div className="card mt">
        <h2>Zonas de la casa</h2>
        <p className="cap">
          Cada persona de guardia tiene esta checklist entera en «Esta semana»
        </p>
        <div className="zonelist">
          {(cleaning?.zones ?? []).map((z) => (
            <span className="zonechip" key={z.id}>{z.name}</span>
          ))}
        </div>
      </div>

      <div className="card mt">
        <h2>Próximas semanas</h2>
        <p className="cap">La rotación avanza sola, no hay que tocar nada</p>
        <table>
          <thead>
            <tr>
              <th>Semana</th>
              {(cleaning?.shifts ?? []).map((s) => (
                <th key={s.id}>{s.label} ({s.days.map((d) => DAY_NAMES[d]).join('·')})</th>
              ))}
              <th>Descansa</th>
            </tr>
          </thead>
          <tbody>
            {next.map((row) => (
              <tr key={row.week}>
                <td>{row.week === week ? <b>{row.week} (actual)</b> : row.week}</td>
                {row.turns.map((t) => (
                  <td key={t.shift.id}>
                    <div className="person">
                      <span className="dot" style={{ background: byId[t.assignee]?.color }} />
                      {byId[t.assignee]?.name ?? t.assignee}
                    </div>
                  </td>
                ))}
                <td style={{ color: 'var(--muted)' }}>
                  {row.resting.map((id) => byId[id]?.name ?? id).join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="sub" style={{ marginTop: 14, color: 'var(--muted)' }}>
        Las zonas, los días de cada turno y el orden de la rotación se cambian en{' '}
        <code>cleaning</code> dentro de <code>db.json</code>.
      </p>
    </>
  );
}

function Row({ label, person, days, today }) {
  return (
    <>
      <div className="task">
        <span className="dot" style={{ background: person?.color ?? '#898781' }} />
        <span>
          {person?.name ?? '—'}
          <br />
          <small style={{ color: 'var(--muted)', fontWeight: 400 }}>{label}</small>
        </span>
      </div>
      {[1, 2, 3, 4, 5, 6, 7].map((d) => {
        const on = days.includes(d);
        return (
          <div
            key={d}
            className={`cell${on ? ' on' : ''}${d === today ? ' today' : ''}`}
            style={on ? { background: person?.color } : undefined}
            title={on ? `${person?.name} · ${label}` : ''}
          >
            {on ? person?.name?.[0] : ''}
          </div>
        );
      })}
    </>
  );
}
