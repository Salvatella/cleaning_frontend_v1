/**
 * web/src/config.js — configuración del frontend.
 *
 * La clave publishable está DISEÑADA para ir aquí, a la vista, y puede subirse
 * a un repo público sin problema. No es un secreto: lo que protege los datos
 * son las reglas RLS de supabase/schema.sql.
 *
 * La otra clave, la `secret` / `service_role`, salta todas esas reglas y NUNCA
 * debe aparecer en el frontend ni en el repo.
 *
 * Dónde salen estos valores:
 *   Supabase → Settings → Data API      → Project URL
 *   Supabase → Settings → API Keys      → Publishable key (sb_publishable_...)
 */
export const SUPABASE_URL = 'https://auwfxgddhhuaenxyagoe.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_4nw8s_RO9eBVegqUJ3bAHg_FQkFu8Oj';

/** Con esto vacío la app arranca en modo local (contra el Express de siempre). */
export const useSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** La configuración del piso: estática, no cambia casi nunca. */
export const CASA = {
  home: 'Piso Prats',
  // `tricountName` es cómo se llama cada uno DENTRO de Tricount, que no tiene
  // por qué coincidir. Sirve para que los gastos se pinten con vuestro color.
  // Si lo dejas vacío, se intenta emparejar por la primera palabra del nombre.
  people: [
    { id: 'ferran', name: 'Ferran', color: '#2a78d6', tricountName: 'Ferran Salvatella' },
    { id: 'jimmy', name: 'Jimmy', color: '#eb6834', tricountName: 'Jing' },
    // El id se queda en 'mel': es lo que está guardado en Supabase.
    { id: 'mel', name: 'Miel', color: '#1baf7a', tricountName: 'Miel' },
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
