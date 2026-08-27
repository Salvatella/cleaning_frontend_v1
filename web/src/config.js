/**
 * web/src/config.js — configuración del frontend.
 *
 * La clave `anon` de Supabase está DISEÑADA para ir aquí, a la vista. No es un
 * secreto: lo que protege los datos son las reglas RLS de supabase/schema.sql.
 * La otra clave, la `service_role`, esa nunca debe aparecer en el frontend.
 *
 * Rellena estos dos valores con los de tu proyecto:
 *   Supabase → Project Settings → Data API → Project URL
 *   Supabase → Project Settings → API Keys → anon / publishable
 */
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

/** Con esto vacío la app arranca en modo local (contra el Express de siempre). */
export const useSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** La configuración del piso: estática, no cambia casi nunca. */
export const CASA = {
  home: 'Piso Prats',
  people: [
    { id: 'ferran', name: 'Ferran', color: '#2a78d6' },
    { id: 'jimmy', name: 'Jimmy', color: '#eb6834' },
    { id: 'mel', name: 'Mel', color: '#1baf7a' },
  ],
  cleaning: {
    zones: [
      { id: 'bano', name: 'Baño' },
      { id: 'cocina', name: 'Cocina' },
      { id: 'salon', name: 'Salón y suelo' },
    ],
    shifts: [
      { id: 't1', label: 'Primer turno', days: [1, 2, 3] },
      { id: 't2', label: 'Segundo turno', days: [5, 6, 7] },
    ],
    rotation: ['ferran', 'jimmy', 'mel'],
    anchorWeek: '2026-W34',
  },
};
