import { useState } from 'react';
import {
  addItem,
  clearBought,
  deleteItem,
  puedeSincronizarTricount,
  setTricountUrl,
  syncExpenses,
  updateItem,
} from '../store.js';
import { Check, ago, matchPerson, money } from '../components/bits.jsx';

export default function Compra({ state, setState, reload }) {
  const { shopping, people, tricount } = state;
  const [name, setName] = useState('');
  const [who, setWho] = useState(people[0]?.id ?? '');
  const [syncing, setSyncing] = useState(false);
  const [urlDraft, setUrlDraft] = useState(tricount.url ?? '');

  const patch = (partial) => setState((s) => ({ ...s, ...partial }));

  async function add(e) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    setName('');
    try {
      patch(await addItem(value, who, state));
    } catch (err) {
      alert(err.message);
    }
  }

  const pending = shopping.filter((i) => !i.bought);
  const bought = shopping.filter((i) => i.bought);
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? id;

  // Escala común para las barras de balance: el mayor valor absoluto.
  const maxAbs = Math.max(1, ...(tricount.balances ?? []).map((b) => Math.abs(b.amount)));

  async function sync() {
    setSyncing(true);
    try {
      const res = await syncExpenses();
      patch({ tricount: res.tricount });
    } catch (err) {
      alert(`Sync falló: ${err.message}`);
      reload();
    } finally {
      setSyncing(false);
    }
  }

  async function saveUrl(e) {
    e.preventDefault();
    setSyncing(true);
    try {
      const res = await setTricountUrl(urlDraft.trim());
      patch({ tricount: res.tricount });
      if (!res.ok) alert(`Guardada, pero la sync falló: ${res.error}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Compra y gastos</h1>
          <p className="sub">Lista común del piso · balances desde Tricount</p>
        </div>
        {tricount.url && puedeSincronizarTricount && (
          <button className="btn" onClick={sync} disabled={syncing}>
            {syncing ? 'Sincronizando…' : '↻ Sincronizar Tricount'}
          </button>
        )}
      </div>

      <div className="grid2">
        {/* ------------------------------------------------ lista de la compra */}
        <div className="card">
          <h2>Lista de la compra</h2>
          <p className="cap">
            {pending.length} {pending.length === 1 ? 'pendiente' : 'pendientes'}
            {bought.length > 0 && ` · ${bought.length} ya comprado`}
          </p>

          <form className="additem" onSubmit={add}>
            <input
              placeholder="Añadir producto…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
            <select
              className="btn"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              title="Quién lo añade"
            >
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn primary" type="submit">Añadir</button>
          </form>

          {shopping.length === 0 && <p className="empty">La lista está vacía.</p>}

          {[...pending, ...bought].map((item) => (
            <div className={`item${item.bought ? ' bought' : ''}`} key={item.id}>
              <Check
                done={item.bought}
                onClick={async () =>
                  patch(await updateItem(item.id, { bought: !item.bought, by: who }, state))
                }
                title={item.bought ? 'Desmarcar' : 'Marcar como comprado'}
              />
              <div className="nm">{item.name}</div>
              <div className="by">
                {item.bought ? `comprado ${nameOf(item.boughtBy) ?? ''}` : `añadió ${nameOf(item.addedBy)}`}
              </div>
              <button
                className="x"
                title="Borrar"
                onClick={async () => patch(await deleteItem(item.id, state))}
              >
                ×
              </button>
            </div>
          ))}

          {bought.length > 0 && (
            <button
              className="btn mt"
              onClick={async () => patch(await clearBought(state))}
            >
              Vaciar lo comprado
            </button>
          )}
        </div>

        {/* --------------------------------------------------------- balances */}
        <div className="card">
          <h2>Balance del piso</h2>
          <p className="cap">
            {tricount.title ? `${tricount.title} · ` : ''}
            {money(tricount.total, tricount.currency)} en total
          </p>

          {/*
            Qué enseñar se decide por si HAY BALANCES, no por si hay `url`:
            el snapshot publicado no lleva el enlace dentro a propósito (acaba
            en un repo público), así que mirar la url daba un falso negativo.
          */}
          {(tricount.balances ?? []).length === 0 ? (
            puedeSincronizarTricount && !tricount.url ? (
            <form onSubmit={saveUrl}>
              <p className="empty" style={{ paddingBottom: 8 }}>
                Pega el enlace de vuestro Tricount para empezar.
              </p>
              <div className="additem">
                <input
                  placeholder="https://tricount.com/…"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                />
                <button className="btn primary" type="submit" disabled={syncing}>
                  {syncing ? '…' : 'Conectar'}
                </button>
              </div>
            </form>
            ) : (
              <p className="empty">
                Todavía no hay balances. Genera los datos con
                <br />
                <code>npm run snapshot</code>
              </p>
            )
          ) : (
            <>
              {[...tricount.balances]
                .sort((a, b) => b.amount - a.amount)
                .map((b) => {
                  const w = (Math.abs(b.amount) / maxAbs) * 45;
                  const positive = b.amount >= 0;
                  const person = matchPerson(people, b.person);
                  return (
                    <div className="bal" key={b.person}>
                      <div className="nm">{person?.name ?? b.person}</div>
                      <div className="balbar">
                        <div className="zero" />
                        <div
                          className="b"
                          style={{
                            left: positive ? '50%' : `${50 - w}%`,
                            width: `${w}%`,
                            background: person?.color ?? (positive ? '#1baf7a' : '#eb6834'),
                          }}
                        />
                      </div>
                      <div
                        className="amt"
                        style={{ color: positive ? '#006300' : 'var(--critical)' }}
                      >
                        {money(b.amount, tricount.currency)}
                      </div>
                    </div>
                  );
                })}

              {tricount.settlements?.length > 0 && (
                <div className="settle">
                  <b>Para saldar cuentas</b>
                  <br />
                  {tricount.settlements.map((m, i) => (
                    <span key={i}>
                      {matchPerson(people, m.from)?.name ?? m.from} →{' '}
                      {matchPerson(people, m.to)?.name ?? m.to}{' '}
                      <b>{money(m.amount, tricount.currency)}</b>
                      <br />
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {tricount.url && (
            <div className={`sync${tricount.status === 'stale' ? ' warn' : ''}${tricount.status === 'error' ? ' err' : ''}`}>
              ◷ Última sync: {ago(tricount.lastSync)} · solo lectura
              {tricount.error && <span> · ⚠️ {tricount.error}</span>}
            </div>
          )}
        </div>
      </div>

      {(tricount.expenses ?? []).length > 0 && (
        <div className="card mt">
          <h2>Últimos gastos</h2>
          <p className="cap">Importados de Tricount · para añadir uno nuevo, abre la app</p>
          <table>
            <thead>
              <tr><th>Fecha</th><th>Concepto</th><th>Pagó</th><th className="num">Importe</th></tr>
            </thead>
            <tbody>
              {tricount.expenses.slice(0, 12).map((e, i) => {
                const person = matchPerson(people, e.paidBy);
                return (
                  <tr key={i}>
                    <td>{e.date ?? '—'}</td>
                    <td>{e.title}</td>
                    <td>
                      <div className="person">
                        <span className="dot" style={{ background: person?.color ?? '#898781' }} />
                        {e.paidBy}
                      </div>
                    </td>
                    <td className="num">{money(e.amount, e.currency ?? tricount.currency)}</td>
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
