import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { loadState, modo, subscribe } from './store.js';
import {
  IconCompra,
  IconDashboard,
  IconHorario,
  IconSemana,
} from './components/icons.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Horario from './pages/Horario.jsx';
import Semana from './pages/Semana.jsx';
import Compra from './pages/Compra.jsx';

export default function App() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      setState(await loadState());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    reload();

    // Tres personas usan esto a la vez y lo que marca uno debe aparecerle a
    // los otros. Con Supabase llega un aviso al instante; en modo local no hay
    // realtime, así que refrescamos cada 20 s.
    const unsubscribe = subscribe(reload);
    const t = modo === 'supabase' ? null : setInterval(reload, 20000);

    return () => {
      unsubscribe();
      if (t) clearInterval(t);
    };
  }, [reload]);

  if (error && !state) {
    return (
      <div style={{ padding: 40 }}>
        <h1>No se pudo cargar</h1>
        <p className="sub">{error}</p>
        <button className="btn" onClick={reload}>Reintentar</button>
      </div>
    );
  }

  if (!state) return <div style={{ padding: 40, color: '#898781' }}>Cargando…</div>;

  // El badge cuenta ZONAS pendientes, que es lo que la gente mira, no turnos.
  const pending = state.tasks.reduce((n, t) => n + (t.zoneCount - t.doneCount), 0);
  const ctx = { state, reload, setState };

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className="brand-dot" />
          <div>
            <b>{state.home}</b>
            <small>{state.people.map((p) => p.name).join(' · ')}</small>
          </div>
        </div>

        {/*
          Cada enlace lleva dos textos: el largo para el escritorio y uno corto
          que solo se ve en el móvil, donde no caben cuatro nombres completos.
        */}
        <nav>
          <div className="navlabel">Piso</div>

          <NavLink to="/" end>
            <IconDashboard className="ic" />
            <span className="lg">Dashboard</span>
            <span className="sm">Resumen</span>
          </NavLink>

          <NavLink to="/horario">
            <IconHorario className="ic" />
            <span className="lg">Horario</span>
            <span className="sm">Horario</span>
          </NavLink>

          <NavLink to="/semana">
            <IconSemana className="ic" />
            <span className="lg">Esta semana</span>
            <span className="sm">Semana</span>
            {pending > 0 && <span className="navbadge">{pending}</span>}
          </NavLink>

          <NavLink to="/compra">
            <IconCompra className="ic" />
            <span className="lg">Compra y gastos</span>
            <span className="sm">Compra</span>
          </NavLink>
        </nav>

        <div className="who">
          <span>{state.week}</span>
        </div>
      </aside>

      <main>
        <Routes>
          <Route path="/" element={<Dashboard {...ctx} />} />
          <Route path="/horario" element={<Horario {...ctx} />} />
          <Route path="/semana" element={<Semana {...ctx} />} />
          <Route path="/compra" element={<Compra {...ctx} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
