-- MiAgente: correcciones de la auditoría de seguridad.
--
-- Principio: nada que proteja plata o cupos depende de datos que el usuario
-- puede escribir desde el navegador. Cualquiera con sesión puede hablarle
-- directo a la API de Supabase, así que la base es la barrera.
--
-- No borra datos. Las restricciones nuevas se crean "not valid" (valen para
-- lo que se escriba desde ahora) y después se intenta validarlas sobre lo
-- existente; si algo viejo no cumple, quedan sin validar y se avisa.

-- ---------------------------------------------------------------------------
-- 1. Gasto de Claude: solo el servidor lo escribe
-- ---------------------------------------------------------------------------

drop policy if exists "propio: crear" on public.llm_usage;
drop policy if exists "propio: borrar" on public.llm_usage;
-- Además de RLS, sin permiso de escritura: un error claro en lugar de "0 filas".
revoke insert, update, delete, truncate on public.llm_usage from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke insert, update, delete, truncate on public.llm_usage from %I', r);
    end if;
  end loop;
end;
$$;

-- El servidor indica el user_id: sin valor por defecto que dependa de la sesión.
alter table public.llm_usage alter column user_id drop default;

create index if not exists llm_usage_mes_global_idx on public.llm_usage (mes);

-- Gasto del mes de una persona y de todo el despliegue. Lo suma la base: no
-- hay límite de filas que lo deje corto.
create or replace function public.gasto_claude_mes(p_user uuid, p_mes text)
returns table (propio numeric, global numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(cost_usd) filter (where user_id = p_user), 0)::numeric,
    coalesce(sum(cost_usd), 0)::numeric
  from public.llm_usage
  where mes = p_mes;
$$;

-- Desglose por uso y modelo, para el panel.
create or replace function public.gasto_claude_desglose(p_user uuid, p_mes text)
returns table (uso text, model text, total numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select uso, model, sum(cost_usd)::numeric
  from public.llm_usage
  where user_id = p_user and mes = p_mes
  group by uso, model;
$$;

-- ---------------------------------------------------------------------------
-- 1. Sesiones: columnas que maneja solo el servidor
-- ---------------------------------------------------------------------------
-- Con la sesión de un usuario (roles anon y authenticated) no se puede:
--   · crear sesiones de tipo llamada_programada (las crea el programador);
--   · cambiar el tipo de una sesión;
--   · escribir providers_used, context_snapshot(_at), history_summary(_until).
-- La clave de servicio (el servidor) sí puede.

create or replace function public.sessions_proteger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.kind = 'llamada_programada' then
      raise exception 'Las llamadas programadas las crea solo el servidor'
        using errcode = '42501';
    end if;
    if coalesce(new.providers_used, '{}') <> '{}'
       or new.context_snapshot is not null or new.context_snapshot_at is not null
       or new.history_summary is not null or new.history_summary_until is not null then
      raise exception 'Esas columnas de la sesión las escribe solo el servidor'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.kind is distinct from old.kind then
    raise exception 'El tipo de una sesión no se cambia' using errcode = '42501';
  end if;
  if new.providers_used is distinct from old.providers_used
     or new.context_snapshot is distinct from old.context_snapshot
     or new.context_snapshot_at is distinct from old.context_snapshot_at
     or new.history_summary is distinct from old.history_summary
     or new.history_summary_until is distinct from old.history_summary_until then
    raise exception 'Esas columnas de la sesión las escribe solo el servidor'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists sessions_proteger on public.sessions;
create trigger sessions_proteger
  before insert or update on public.sessions
  for each row execute function public.sessions_proteger();

-- ---------------------------------------------------------------------------
-- 1. Tamaño de lo que puede terminar en un pedido al modelo
-- ---------------------------------------------------------------------------

alter table public.messages
  add constraint messages_content_largo check (content is null or char_length(content) <= 16000) not valid,
  add constraint messages_tool_calls_largo check (tool_calls is null or pg_column_size(tool_calls) <= 65536) not valid,
  add constraint messages_tool_result_largo check (tool_result is null or pg_column_size(tool_result) <= 65536) not valid;

alter table public.profiles
  add constraint profiles_name_largo check (name is null or char_length(name) <= 200) not valid,
  add constraint profiles_agent_config_largo check (pg_column_size(agent_config) <= 32768) not valid;
alter table public.areas
  add constraint areas_name_largo check (char_length(name) <= 200) not valid;
alter table public.projects
  add constraint projects_textos_largo check (
    char_length(name) <= 300
    and (goal is null or char_length(goal) <= 4000)
    and (description is null or char_length(description) <= 20000)
  ) not valid;
alter table public.tasks
  add constraint tasks_textos_largo check (
    char_length(title) <= 500
    and (description is null or char_length(description) <= 20000)
    and (blocked_reason is null or char_length(blocked_reason) <= 2000)
  ) not valid;
alter table public.memories
  add constraint memories_content_largo check (char_length(content) <= 4000) not valid;
alter table public.project_log
  add constraint project_log_content_largo check (char_length(content) <= 20000) not valid;
alter table public.call_routines
  add constraint call_routines_textos_largo check (
    char_length(name) <= 200 and (focus is null or char_length(focus) <= 2000)
  ) not valid;
alter table public.sessions
  add constraint sessions_textos_largo check (
    (summary is null or char_length(summary) <= 8000)
    and (focus is null or char_length(focus) <= 2000)
    and pg_column_size(commitments) <= 32768
  ) not valid;

-- ---------------------------------------------------------------------------
-- 3. Límite de frecuencia por usuario (por minuto y por día)
-- ---------------------------------------------------------------------------
-- Una fila por usuario y endpoint. Sin políticas: el navegador no la ve ni la
-- toca. La función hace la cuenta en una sola sentencia (atómica).

create table public.limites_frecuencia (
  user_id uuid not null references auth.users (id) on delete cascade,
  clave text not null check (char_length(clave) <= 40),
  minuto timestamptz not null,
  en_minuto integer not null default 0,
  dia date not null,
  en_dia integer not null default 0,
  primary key (user_id, clave)
);
alter table public.limites_frecuencia enable row level security;

create or replace function public.consumir_limite(
  p_user uuid, p_clave text, p_por_minuto integer, p_por_dia integer
)
returns table (permitido boolean, en_minuto integer, en_dia integer)
language sql
security definer
set search_path = ''
as $$
  insert into public.limites_frecuencia as l (user_id, clave, minuto, en_minuto, dia, en_dia)
  values (p_user, p_clave, date_trunc('minute', now()), 1, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, clave) do update set
    en_minuto = case when l.minuto = date_trunc('minute', now()) then l.en_minuto + 1 else 1 end,
    minuto = date_trunc('minute', now()),
    en_dia = case when l.dia = (now() at time zone 'utc')::date then l.en_dia + 1 else 1 end,
    dia = (now() at time zone 'utc')::date
  returning (l.en_minuto <= p_por_minuto and l.en_dia <= p_por_dia), l.en_minuto, l.en_dia;
$$;

-- ---------------------------------------------------------------------------
-- 4. Notificaciones push: solo servicios de push reales, con tope por usuario
-- ---------------------------------------------------------------------------
-- Chrome, Opera, Brave y Samsung: fcm.googleapis.com · Firefox:
-- updates.push.services.mozilla.com · Safari: web.push.apple.com (y otros
-- *.push.apple.com) · Edge: *.notify.windows.com. La misma lista está en
-- src/lib/push/destinos.ts, que se vuelve a revisar antes de cada envío.

alter table public.push_subscriptions
  add constraint push_endpoint_conocido check (
    char_length(endpoint) <= 1024
    and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)(:443)?/'
  ) not valid,
  add constraint push_claves_largo check (
    char_length(p256dh) <= 200 and char_length(auth) <= 100
    and (device_label is null or char_length(device_label) <= 100)
  ) not valid;

-- ---------------------------------------------------------------------------
-- 4 y 8. Máximo de filas por usuario
-- ---------------------------------------------------------------------------
-- El programador recorre rutinas y ventanas de todos: miles de filas de un
-- usuario lo demorarían para los demás.

create or replace function public.limitar_filas_por_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := tg_argv[0]::integer;
  v_n integer;
begin
  -- Un upsert de una suscripción que ya existe no suma una fila nueva.
  if tg_table_name = 'push_subscriptions' then
    if exists (select 1 from public.push_subscriptions p where p.endpoint = to_jsonb(new) ->> 'endpoint') then
      return new;
    end if;
  end if;
  -- Dos inserciones simultáneas del mismo usuario se ordenan acá.
  perform pg_advisory_xact_lock(hashtext(tg_table_name), hashtext(new.user_id::text));
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name)
    into v_n using new.user_id;
  if v_n >= v_max then
    raise exception 'Se llegó al máximo de % en %', v_max, tg_table_name
      using errcode = 'P0001', hint = 'limite_filas';
  end if;
  return new;
end;
$$;

create trigger limitar_filas before insert on public.push_subscriptions
  for each row execute function public.limitar_filas_por_usuario('10');
create trigger limitar_filas before insert on public.call_routines
  for each row execute function public.limitar_filas_por_usuario('20');
create trigger limitar_filas before insert on public.availability_windows
  for each row execute function public.limitar_filas_por_usuario('50');

-- ---------------------------------------------------------------------------
-- 5. Cupo de Azure: global para el despliegue
-- ---------------------------------------------------------------------------

create or replace function public.uso_voz_global(p_month date)
returns table (stt_seconds bigint, tts_chars bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(v.stt_seconds), 0)::bigint, coalesce(sum(v.tts_chars), 0)::bigint
  from public.voice_usage v
  where v.month = p_month;
$$;

-- ---------------------------------------------------------------------------
-- Funciones solo para la clave de servicio
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'public.gasto_claude_mes(uuid, text)',
    'public.gasto_claude_desglose(uuid, text)',
    'public.consumir_limite(uuid, text, integer, integer)',
    'public.uso_voz_global(date)'
  ] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Referencias entre tablas: siempre del mismo dueño
-- ---------------------------------------------------------------------------
-- Cada referencia pasa a ser (id, user_id): una fila solo puede apuntar a una
-- fila del mismo usuario. Lo controla la base, aunque la fila de destino no se
-- vea por RLS.

alter table public.areas add constraint areas_id_user_key unique (id, user_id);
alter table public.projects add constraint projects_id_user_key unique (id, user_id);
alter table public.tasks add constraint tasks_id_user_key unique (id, user_id);
alter table public.sessions add constraint sessions_id_user_key unique (id, user_id);
alter table public.messages add constraint messages_id_user_key unique (id, user_id);
alter table public.call_routines add constraint call_routines_id_user_key unique (id, user_id);

alter table public.tasks
  drop constraint if exists tasks_project_id_fkey,
  drop constraint if exists tasks_parent_id_fkey,
  add constraint tasks_project_mismo_dueno foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade not valid,
  add constraint tasks_parent_mismo_dueno foreign key (parent_id, user_id)
    references public.tasks (id, user_id) on delete cascade not valid;

alter table public.projects
  drop constraint if exists projects_area_id_fkey,
  add constraint projects_area_mismo_dueno foreign key (area_id, user_id)
    references public.areas (id, user_id) on delete set null (area_id) not valid;

alter table public.messages
  drop constraint if exists messages_session_id_fkey,
  add constraint messages_session_mismo_dueno foreign key (session_id, user_id)
    references public.sessions (id, user_id) on delete cascade not valid;

alter table public.project_log
  drop constraint if exists project_log_project_id_fkey,
  drop constraint if exists project_log_session_id_fkey,
  add constraint project_log_project_mismo_dueno foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade not valid,
  add constraint project_log_session_mismo_dueno foreign key (session_id, user_id)
    references public.sessions (id, user_id) on delete set null (session_id) not valid;

alter table public.memories
  drop constraint if exists memories_source_session_id_fkey,
  add constraint memories_session_mismo_dueno foreign key (source_session_id, user_id)
    references public.sessions (id, user_id) on delete set null (source_session_id) not valid;

alter table public.change_log
  drop constraint if exists change_log_session_id_fkey,
  drop constraint if exists change_log_message_id_fkey,
  add constraint change_log_session_mismo_dueno foreign key (session_id, user_id)
    references public.sessions (id, user_id) on delete set null (session_id) not valid,
  add constraint change_log_message_mismo_dueno foreign key (message_id, user_id)
    references public.messages (id, user_id) on delete set null (message_id) not valid;

alter table public.sessions
  drop constraint if exists sessions_routine_id_fkey,
  drop constraint if exists sessions_rescheduled_from_fkey,
  add constraint sessions_routine_mismo_dueno foreign key (routine_id, user_id)
    references public.call_routines (id, user_id) on delete set null (routine_id) not valid,
  add constraint sessions_reprogramada_mismo_dueno foreign key (rescheduled_from, user_id)
    references public.sessions (id, user_id) on delete set null (rescheduled_from) not valid;

alter table public.llm_usage
  drop constraint if exists llm_usage_session_id_fkey,
  add constraint llm_usage_session_mismo_dueno foreign key (session_id, user_id)
    references public.sessions (id, user_id) on delete set null (session_id) not valid;

-- Índices para las columnas que apuntan a otra tabla (borrados en cascada).
create index if not exists project_log_session_idx on public.project_log (session_id);
create index if not exists memories_session_idx on public.memories (source_session_id);
create index if not exists change_log_message_idx on public.change_log (message_id);
create index if not exists sessions_rescheduled_idx on public.sessions (rescheduled_from);

-- ---------------------------------------------------------------------------
-- Validar lo existente, sin borrar nada
-- ---------------------------------------------------------------------------

do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tabla, conname
    from pg_constraint
    where connamespace = 'public'::regnamespace and not convalidated
  loop
    begin
      execute format('alter table %s validate constraint %I', c.tabla, c.conname);
    exception when others then
      raise notice 'Queda sin validar % en % (hay filas viejas que no cumplen): %', c.conname, c.tabla, sqlerrm;
    end;
  end loop;
end;
$$;
