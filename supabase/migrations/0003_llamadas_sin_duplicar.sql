-- Una rutina genera como mucho una llamada original por horario. Si dos
-- corridas del programador se pisan, la segunda inserción falla en lugar de
-- duplicar la llamada. (Las reprogramadas tienen rescheduled_from y no entran.)
create unique index sessions_rutina_horario_idx
  on public.sessions (routine_id, scheduled_at)
  where routine_id is not null and rescheduled_from is null;
