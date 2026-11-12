-- MiAgente: recordatorios por notificación push, en los días y a la hora que
-- cada persona elige (por ejemplo, para acordarse de entrar y documentar).

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message text not null default 'Entrá a documentar tu día.' check (char_length(message) between 1 and 200),
  weekdays smallint[] not null default '{1,2,3,4,5}', -- 0 = domingo ... 6 = sábado
  local_time time not null,                           -- en la zona horaria del perfil
  active boolean not null default true,
  -- Último día (en la zona de la persona) en que se envió: uno por día como mucho.
  last_sent_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
);

create index reminders_user_idx on public.reminders (user_id);
create index reminders_activos_idx on public.reminders (local_time) where active;

create trigger set_updated_at before update on public.reminders
  for each row execute function public.set_updated_at();

alter table public.reminders enable row level security;
create policy "propio: todo" on public.reminders for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- El programador los recorre todos: tope por persona, como las rutinas.
create trigger limitar_filas before insert on public.reminders
  for each row execute function public.limitar_filas_por_usuario('10');
