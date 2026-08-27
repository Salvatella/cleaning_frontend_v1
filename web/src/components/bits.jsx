/** Piezas pequeñas y reutilizables. Nada de librerías de componentes. */

export const DAY_SHORT = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export const money = (n, currency = 'EUR') =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: currency || 'EUR' }).format(n ?? 0);

export const when = (iso) =>
  iso
    ? new Intl.DateTimeFormat('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(
        new Date(iso)
      )
    : '';

export const ago = (iso) => {
  if (!iso) return 'nunca';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
};

export function Tile({ label, value, unit, children, color }) {
  return (
    <div className="card tile">
      <p className="lbl">{label}</p>
      <div className="val" style={color ? { color } : undefined}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {children && <div className="delta">{children}</div>}
    </div>
  );
}

export function Bar({ label, value, max = 100, color, display, dot }) {
  const pct = max ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="barrow">
      <div className="nm">
        {dot && <span className="dot" style={{ background: dot, marginRight: 6 }} />}
        {label}
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${pct}%`, background: color ?? '#2a78d6' }} />
      </div>
      <div className="pct">{display ?? value}</div>
    </div>
  );
}

const PILL = {
  done: ['ok', '✓ A tiempo'],
  late: ['late', '● Con retraso'],
  pending: ['pend', '◷ Pendiente'],
  upcoming: ['soon', '· Más adelante'],
};

export function Pill({ status, onTime, daysLate }) {
  let [cls, text] = PILL[status] ?? ['soon', status];
  if (status === 'done' && onTime === false) [cls, text] = ['late', '✓ Tarde'];
  if (status === 'late' && daysLate) text = `● ${daysLate} ${daysLate === 1 ? 'día' : 'días'} tarde`;
  return <span className={`pill ${cls}`}>{text}</span>;
}

export function Check({ done, onClick, title }) {
  return (
    <button
      className={`box${done ? ' done' : ''}`}
      onClick={onClick}
      title={title}
      aria-pressed={done}
    >
      {done ? '✓' : ''}
    </button>
  );
}

/** Línea de tendencia. Sin librería de charts: es un polyline y ya. */
export function Trend({ points, color = '#2a78d6' }) {
  const values = points.filter((p) => p.pct != null);
  if (values.length < 2) return <p className="empty">Aún no hay historial suficiente.</p>;

  const W = 460;
  const H = 120;
  const x = (i) => 10 + (i * (W - 30)) / (values.length - 1);
  const y = (v) => 100 - (v / 100) * 80;
  const d = values.map((p, i) => `${x(i)},${y(p.pct)}`).join(' ');
  const last = values.at(-1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
         aria-label="Tendencia de cumplimiento semanal">
      {[20, 60, 100].map((yy) => (
        <line key={yy} x1="0" y1={yy} x2={W} y2={yy} stroke={yy === 100 ? '#c3c2b7' : '#e1e0d9'} strokeWidth="1" />
      ))}
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"
                strokeLinecap="round" points={d} />
      <circle cx={x(values.length - 1)} cy={y(last.pct)} r="4.5" fill={color}
              stroke="#fcfcfb" strokeWidth="2" />
      <text x={x(values.length - 1) - 8} y={y(last.pct) - 10} fontSize="11" fill="#0b0b0b"
            textAnchor="end" fontWeight="600">{last.pct}%</text>
      <text x="10" y="115" fontSize="10" fill="#898781">{values[0].week}</text>
      <text x={W - 10} y="115" fontSize="10" fill="#898781" textAnchor="end">{last.week}</text>
    </svg>
  );
}
