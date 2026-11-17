import { NextResponse } from "next/server";
import { destinoPushValido } from "@/lib/push/destinos";
import { emisorPush } from "@/lib/push/servidor";
import { anotarEnvio, type Suscripcion } from "@/lib/programacion/tick";
import { frenarSiHaceFalta } from "@/lib/seguridad/frecuencia";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";

/** Foco y duración de la llamada de prueba: corta, para comprobar que todo anda. */
const FOCO_LLAMADA_PRUEBA = "Llamada de prueba: repaso muy breve de lo más urgente";
const MINUTOS_LLAMADA_PRUEBA = 3;
/**
 * Una llamada de prueba que no se atiende no se reprograma: con este número
 * de reprogramaciones el programador la da por perdida al pasar el margen.
 */
const SIN_REPROGRAMAR = 10;

/**
 * Crea una llamada para ahora mismo y la avisa por push, igual que haría el
 * programador con una rutina. Sirve para probar el circuito completo en el
 * teléfono: aviso, toque, pantalla de llamada y conversación.
 *
 * La crea el servidor con la clave de servicio porque la base no deja que una
 * persona cree llamadas programadas por su cuenta (disparador sessions_proteger).
 */
export async function POST() {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const enviar = emisorPush();
  if (!enviar) return NextResponse.json({ ok: false, motivo: "sin_configurar" });
  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, motivo: "sin_configurar" });

  const sb = await supabaseServer();
  const [{ data: dispositivos }, { data: enEspera }] = await Promise.all([
    sb.from("push_subscriptions").select("endpoint,p256dh,auth"),
    sb.from("sessions").select("id").eq("status", "notificada").limit(1),
  ]);
  const suscripciones = ((dispositivos ?? []) as Suscripcion[]).filter((s) => destinoPushValido(s.endpoint));
  if (!suscripciones.length) return NextResponse.json({ ok: false, motivo: "sin_dispositivos" });
  // Si ya hay una llamada sonando, no se apila otra.
  if (enEspera?.length) return NextResponse.json({ ok: false, motivo: "en_espera", id: (enEspera[0] as { id: string }).id });

  const frenado = await frenarSiHaceFalta(usuario.id, "llamada_prueba", admin);
  if (frenado) return frenado;

  const ahora = new Date().toISOString();
  const { data: creada, error } = await admin
    .from("sessions")
    .insert({
      user_id: usuario.id,
      kind: "llamada_programada",
      channel: "voz",
      status: "notificada",
      scheduled_at: ahora,
      notified_at: ahora,
      target_minutes: MINUTOS_LLAMADA_PRUEBA,
      focus: FOCO_LLAMADA_PRUEBA,
      reschedule_count: SIN_REPROGRAMAR,
    })
    .select("id")
    .single();
  if (error || !creada) return NextResponse.json({ ok: false, motivo: "fallo" }, { status: 500 });
  const id = (creada as { id: string }).id;

  let enviadas = 0;
  let detalle: string | undefined;
  for (const s of suscripciones) {
    const r = await enviar(s, {
      titulo: "Tu Agente te está llamando",
      cuerpo: "Llamada de prueba. Tocá para atender.",
      url: `/llamada/${id}`,
      etiqueta: `llamada-${id}`,
      persistente: true,
    });
    await anotarEnvio(sb, s.endpoint, r, new Date().toISOString());
    if (r.estado === "ok") enviadas++;
    else detalle ??= r.detalle;
  }
  return NextResponse.json({ ok: enviadas > 0, id, enviadas, motivo: enviadas ? undefined : "fallo", detalle: enviadas ? undefined : detalle });
}
