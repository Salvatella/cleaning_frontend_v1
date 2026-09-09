/**
 * Iconos en SVG. Antes eran caracteres sueltos (◧ ▦ ✓ 🛒), que se ven distintos
 * en cada sistema y en el móvil quedaban desalineados. Un SVG se ve igual en
 * todas partes, escala sin pixelarse y hereda el color del texto.
 */

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

/** Panel: un bloque grande y dos pequeños. */
export const IconDashboard = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="8" height="18" rx="1.5" />
    <rect x="14" y="3" width="7" height="8" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

/** Calendario. */
export const IconHorario = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

/** Check dentro de un círculo. */
export const IconSemana = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </svg>
);

/** Carrito de la compra. */
export const IconCompra = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 3h2.2l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.1a1.6 1.6 0 0 0 1.6-1.2l1.6-6.3H6" />
    <circle cx="9.5" cy="20" r="1.4" />
    <circle cx="17.5" cy="20" r="1.4" />
  </svg>
);
