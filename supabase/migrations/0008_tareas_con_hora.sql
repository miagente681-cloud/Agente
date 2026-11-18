-- MiAgente: día y hora en que la persona va a hacer cada tarea.
--
-- La fecha límite (`due_date`) dice para cuándo tiene que estar; esto dice
-- cuándo la piensa hacer («el miércoles a las 15:00»). Son independientes:
-- una tarea puede vencer el viernes y estar planificada para el miércoles.
--
-- `plan_fecha` y `plan_hora` son de reloj de pared en la zona horaria del
-- perfil, igual que `call_routines.local_time`. La hora es opcional, pero no
-- puede haber hora sin día.
--
-- `plan_avisado_para` guarda para qué instante ya se mandó la notificación
-- «es la hora». Si la persona cambia el día o la hora, el instante nuevo no
-- coincide y se vuelve a avisar. Es solo para no repetir el aviso: no protege
-- nada, así que la persona también puede escribirla.

alter table public.tasks
  add column plan_fecha date,
  add column plan_hora time,
  add column plan_avisado_para timestamptz,
  add constraint tasks_plan_hora_con_fecha check (plan_hora is null or plan_fecha is not null);

-- El programador busca, cada minuto, las tareas con hora que todavía no se hicieron.
create index tasks_plan_idx on public.tasks (plan_fecha)
  where plan_hora is not null and archived_at is null and status <> 'hecha';
