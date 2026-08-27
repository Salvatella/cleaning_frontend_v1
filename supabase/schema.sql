-- ============================================================================
--  Cleaning Service — esquema de Supabase
--
--  Pega esto entero en: Supabase → tu proyecto → SQL Editor → Run
--  Es idempotente: puedes ejecutarlo varias veces sin romper nada.
-- ============================================================================

-- ---------------------------------------------------------------- checks ---
-- Una fila por zona marcada. Igual que "completions" en el db.json actual.
create table if not exists public.checks (
  occ_id      text primary key,           -- "t1:2026-W34:bano"
  shift_id    text not null,              -- "t1" | "t2"
  week        text not null,              -- "2026-W34"
  zone_id     text not null,              -- "bano" | "cocina" | "salon"
  person      text not null,              -- "ferran" | "jimmy" | "mel"
  day         smallint not null,          -- día ISO en que se MARCÓ (8 = fuera de plazo)
  created_at  timestamptz not null default now()
);

create index if not exists checks_week_idx on public.checks (week);

-- ---------------------------------------------------------------- compra ---
create table if not exists public.shopping (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  added_by    text,
  bought      boolean not null default false,
  bought_by   text,
  bought_at   timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists shopping_created_idx on public.shopping (created_at desc);

-- ============================================================================
--  SEGURIDAD (Row Level Security)
--
--  La clave pública (anon) va en el frontend a la vista de todos: eso es lo
--  normal y está diseñado así. Lo que protege los datos son ESTAS reglas.
--
--  Aquí abrimos lectura y escritura a cualquiera que tenga el enlace, porque
--  la app no tiene login. Para un piso es razonable: lo peor que puede pasar
--  es que alguien os desmarque el baño.
--
--  Fíjate en lo que NO se concede: nadie puede borrar la tabla, cambiar el
--  esquema, ni tocar ninguna otra tabla del proyecto. Solo estas dos, y solo
--  para las operaciones listadas.
-- ============================================================================

alter table public.checks   enable row level security;
alter table public.shopping enable row level security;

-- checks: leer, insertar y borrar (marcar / desmarcar). NO update: no hace falta.
drop policy if exists "checks lectura"  on public.checks;
drop policy if exists "checks insertar" on public.checks;
drop policy if exists "checks borrar"   on public.checks;

create policy "checks lectura"  on public.checks for select to anon using (true);
create policy "checks insertar" on public.checks for insert to anon with check (true);
create policy "checks borrar"   on public.checks for delete to anon using (true);

-- compra: CRUD completo.
drop policy if exists "compra lectura"    on public.shopping;
drop policy if exists "compra insertar"   on public.shopping;
drop policy if exists "compra actualizar" on public.shopping;
drop policy if exists "compra borrar"     on public.shopping;

create policy "compra lectura"    on public.shopping for select to anon using (true);
create policy "compra insertar"   on public.shopping for insert to anon with check (true);
create policy "compra actualizar" on public.shopping for update to anon using (true) with check (true);
create policy "compra borrar"     on public.shopping for delete to anon using (true);

-- ---------------------------------------------------------------- realtime ---
-- Para que lo que marca uno aparezca en la pantalla de los otros al instante,
-- sin recargar. Si la publicación ya existe, estos ALTER pueden dar error de
-- "ya es miembro": es inofensivo, ignóralo.
do $$
begin
  alter publication supabase_realtime add table public.checks;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.shopping;
exception when duplicate_object then null;
end $$;
