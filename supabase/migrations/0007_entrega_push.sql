-- MiAgente: registro de entrega de las notificaciones push.
--
-- Las llamadas se avisan solo por push (ver DECISIONES.md, 17/11/2026). Hasta
-- ahora el programador no guardaba si el servicio de push (Apple, Google,
-- Mozilla, Microsoft) aceptó cada aviso, así que no había forma de saber si
-- una llamada «notificada» llegó al teléfono. Estas columnas guardan el
-- resultado del último envío a cada dispositivo.
--
-- Son solo para diagnóstico: no protegen plata ni cupos. Las escribe el
-- servidor; la persona puede reiniciarlas al volver a activar las
-- notificaciones (no gana nada con falsearlas).

alter table public.push_subscriptions
  add column ultimo_envio_at timestamptz,
  add column ultimo_resultado text,
  add column ultimo_detalle text,
  add constraint push_ultimo_resultado check (ultimo_resultado in ('entregado', 'fallo')),
  add constraint push_ultimo_detalle_largo check (ultimo_detalle is null or char_length(ultimo_detalle) <= 200);
