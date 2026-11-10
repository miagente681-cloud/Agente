-- MiAgente: lo que agregan las fases 3 a 6 (Agente, voz y llamadas programadas).

-- ---------------------------------------------------------------------------
-- Sesiones: historial resumido y datos de la llamada
-- ---------------------------------------------------------------------------

alter table public.sessions
  -- Cuando la conversación crece, lo viejo se resume acá y deja de enviarse al modelo.
  add column history_summary text,
  add column history_summary_until timestamptz,
  -- Copiados de la rutina al crear la llamada: si después cambia la rutina,
  -- la llamada ya programada conserva lo que tenía.
  add column target_minutes integer,
  add column focus text;

-- ---------------------------------------------------------------------------
-- Uso de voz: suma atómica, solo para el servidor
-- ---------------------------------------------------------------------------

create or replace function public.sumar_uso_voz(p_user uuid, p_stt integer, p_tts integer)
returns table (stt_seconds integer, tts_chars integer)
language sql
security definer
set search_path = ''
as $$
  insert into public.voice_usage as v (user_id, month, stt_seconds, tts_chars)
  values (p_user, date_trunc('month', now())::date, greatest(p_stt, 0), greatest(p_tts, 0))
  on conflict (user_id, month) do update
    set stt_seconds = v.stt_seconds + excluded.stt_seconds,
        tts_chars = v.tts_chars + excluded.tts_chars
  returning v.stt_seconds, v.tts_chars;
$$;

-- Nadie la llama desde el navegador: solo la clave de servicio.
revoke all on function public.sumar_uso_voz(uuid, integer, integer) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.sumar_uso_voz(uuid, integer, integer) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sumar_uso_voz(uuid, integer, integer) to service_role;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Programador: pg_cron llama cada minuto a /api/cron/tick
-- ---------------------------------------------------------------------------
-- La dirección de la app y el secreto NO van en esta migración: se cargan una
-- vez en Vault (ver CREDENCIALES.md). Mientras falten, el programador no hace nada.
--
--   select vault.create_secret('https://TU-APP.vercel.app', 'miagente_app_url');
--   select vault.create_secret('EL-MISMO-CRON_SECRET-DE-VERCEL', 'miagente_cron_secret');

do $$
begin
  -- Fuera de Supabase (por ejemplo en las pruebas) estas extensiones no existen.
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    return;
  end if;

  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  create extension if not exists supabase_vault;

  execute $f$
    create or replace function public.miagente_tick()
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      v_url text;
      v_secreto text;
    begin
      select decrypted_secret into v_url from vault.decrypted_secrets where name = 'miagente_app_url';
      select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'miagente_cron_secret';
      if coalesce(v_url, '') = '' or coalesce(v_secreto, '') = '' then
        return; -- Todavía no se cargaron los valores.
      end if;
      perform net.http_post(
        url := rtrim(v_url, '/') || '/api/cron/tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_secreto
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      );
    end;
    $body$
  $f$;
  execute 'revoke all on function public.miagente_tick() from public, anon, authenticated';

  -- cron.schedule con el mismo nombre reemplaza el trabajo anterior.
  perform cron.schedule('miagente-tick', '* * * * *', 'select public.miagente_tick()');
  -- El historial de corridas crece un renglón por minuto: se limpia una vez por día.
  perform cron.schedule(
    'miagente-limpieza',
    '17 4 * * *',
    $l$delete from cron.job_run_details where end_time < now() - interval '2 days';
       delete from net._http_response where created < now() - interval '2 days'$l$
  );
end;
$$;
