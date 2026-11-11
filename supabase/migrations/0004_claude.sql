-- MiAgente: Claude como cerebro del Agente, con registro de gasto.

-- Lo que el Agente sabe al empezar la sesión (memorias y estado), congelado:
-- así el principio del pedido no cambia entre turnos y el caché de prompts
-- de Claude se reutiliza. Se rehace si la sesión dura más de una hora.
alter table public.sessions
  add column context_snapshot text,
  add column context_snapshot_at timestamptz;

-- Cada pedido a Claude, con sus tokens y su costo estimado.
create table public.llm_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  provider text not null default 'claude',
  model text not null,
  uso text not null check (uso in ('chat', 'llamada', 'entrevista', 'fondo')),
  mes text not null check (mes ~ '^\d{4}-\d{2}$'), -- en la zona horaria de la persona
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_write_5m_tokens integer not null default 0,
  cache_write_1h_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index llm_usage_mes_idx on public.llm_usage (user_id, mes);
create index llm_usage_session_idx on public.llm_usage (session_id);

alter table public.llm_usage enable row level security;
-- Lo escribe el servidor con la sesión de la persona. No hay política de
-- edición: un registro de gasto no se corrige, se agrega.
create policy "propio: leer" on public.llm_usage for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "propio: crear" on public.llm_usage for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "propio: borrar" on public.llm_usage for delete to authenticated
  using ((select auth.uid()) = user_id);
