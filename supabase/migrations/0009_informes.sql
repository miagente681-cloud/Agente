-- MiAgente: informes.
--
-- Un informe es lo que el Agente arma cuando se le pide una medición, un
-- gráfico o una lista de tareas de un período («mis tareas hechas del mes»).
-- Los números los calcula el servidor (src/lib/informes/calcular.ts) y se
-- guardan acá ya calculados: un informe viejo sigue diciendo lo que decía el
-- día en que se armó, aunque las tareas hayan cambiado.
--
-- No protege plata ni cupos: son datos de la persona, derivados de sus propias
-- tareas, así que puede leerlos, borrarlos y (por la API) escribirlos. Por eso
-- la app valida la forma de `datos` antes de mostrarlo.

create table public.informes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- La conversación en la que se pidió, si todavía existe.
  session_id uuid,
  titulo text not null check (char_length(titulo) between 1 and 160),
  desde date not null,
  hasta date not null,
  -- Bloques ya calculados (ver DatosInforme en src/lib/informes/tipos.ts).
  datos jsonb not null check (pg_column_size(datos) <= 262144),
  -- Lectura breve escrita por el Agente a partir de esos números. Opcional.
  analisis text check (analisis is null or char_length(analisis) <= 2000),
  created_at timestamptz not null default now(),
  check (hasta >= desde),
  constraint informes_session_mismo_dueno foreign key (session_id, user_id)
    references public.sessions (id, user_id) on delete set null (session_id)
);

create index informes_user_idx on public.informes (user_id, created_at desc);

alter table public.informes enable row level security;
create policy "propio: todo" on public.informes for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Tope por persona, como en las otras tablas que crecen con el uso.
create trigger limitar_filas before insert on public.informes
  for each row execute function public.limitar_filas_por_usuario('200');
