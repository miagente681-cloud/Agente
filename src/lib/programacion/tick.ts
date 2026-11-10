import type { SupabaseClient } from "@supabase/supabase-js";
import { ajustesDe, cuandoLegible, decidir, type RutinaP, type SesionP, type Ventana } from "./horarios";

/**
 * Lo que hace el programador cada minuto, para todos los usuarios: aplica en
 * la base lo que decide `decidir()` y manda las notificaciones. Usa el cliente
 * de servicio (saltea RLS), por eso cada consulta filtra por usuario.
 */

export type CargaPush = { titulo: string; cuerpo: string; url: string; etiqueta: string; persistente?: boolean };
export type Suscripcion = { endpoint: string; p256dh: string; auth: string };
export type EnviarPush = (suscripcion: Suscripcion, carga: CargaPush) => Promise<"ok" | "vencida" | "error">;

export type ResumenTick = {
  creadas: number;
  notificadas: number;
  reprogramadas: number;
  perdidas: number;
  cerradas: number;
  avisos: number;
};

type Fila = SesionP & { user_id: string; focus: string | null; kind: string };
const CAMPOS =
  "id,user_id,kind,status,routine_id,rescheduled_from,scheduled_at,notified_at,reschedule_count,target_minutes,focus";
/** Una llamada atendida que quedó abierta se da por terminada a las tres horas. */
const HORAS_ABANDONADA = 3;

export async function correrTick(p: {
  admin: SupabaseClient;
  ahora: Date;
  enviar: EnviarPush | null;
}): Promise<ResumenTick> {
  const { admin, ahora } = p;
  const resumen: ResumenTick = { creadas: 0, notificadas: 0, reprogramadas: 0, perdidas: 0, cerradas: 0, avisos: 0 };
  const ahoraISO = ahora.toISOString();

  // Llamadas atendidas y nunca cortadas: se cierran para no quedar "en curso" para siempre.
  const { data: cerradas } = await admin
    .from("sessions")
    .update({ status: "completada", ended_at: ahoraISO })
    .eq("status", "en_curso")
    .in("kind", ["llamada_programada", "onboarding"])
    .lt("started_at", new Date(ahora.getTime() - HORAS_ABANDONADA * 3_600_000).toISOString())
    .select("id");
  resumen.cerradas = cerradas?.length ?? 0;

  const [rutinas, pendientes, recientes] = await Promise.all([
    admin.from("call_routines").select("id,user_id,name,weekdays,local_time,target_minutes,focus,active").eq("active", true),
    admin.from("sessions").select(CAMPOS).in("status", ["programada", "notificada"]),
    // Para saber si la llamada de hoy de cada rutina ya se creó (en cualquier estado).
    admin
      .from("sessions")
      .select(CAMPOS)
      .not("routine_id", "is", null)
      .gte("scheduled_at", new Date(ahora.getTime() - 36 * 3_600_000).toISOString()),
  ]);
  const todasRutinas = (rutinas.data ?? []) as (RutinaP & { user_id: string })[];
  const sesiones = new Map<string, Fila>();
  for (const s of [...((pendientes.data ?? []) as Fila[]), ...((recientes.data ?? []) as Fila[])]) sesiones.set(s.id, s);

  const usuarios = [...new Set([...todasRutinas.map((r) => r.user_id), ...[...sesiones.values()].map((s) => s.user_id)])];
  if (!usuarios.length) return resumen;

  const [perfiles, ventanas] = await Promise.all([
    admin.from("profiles").select("user_id,timezone,agent_config").in("user_id", usuarios),
    admin.from("availability_windows").select("user_id,weekday,start_time,end_time").in("user_id", usuarios),
  ]);

  for (const userId of usuarios) {
    const perfil = ((perfiles.data ?? []) as { user_id: string; timezone: string; agent_config: Record<string, unknown> }[]).find(
      (x) => x.user_id === userId,
    );
    if (!perfil) continue;
    const zona = perfil.timezone;
    const propias = [...sesiones.values()].filter((s) => s.user_id === userId);
    const acciones = decidir({
      ahora,
      zona,
      rutinas: todasRutinas.filter((r) => r.user_id === userId),
      ventanas: ((ventanas.data ?? []) as (Ventana & { user_id: string })[]).filter((v) => v.user_id === userId),
      sesiones: propias,
      ajustes: ajustesDe(perfil.agent_config),
    });
    if (!acciones.length) continue;

    const avisos: CargaPush[] = [];
    const focoDe = (s: SesionP) => propias.find((x) => x.id === s.id)?.focus ?? null;

    for (const a of acciones) {
      if (a.tipo === "crear") {
        const { error } = await admin.from("sessions").insert({
          user_id: userId,
          kind: "llamada_programada",
          channel: "voz",
          status: "programada",
          routine_id: a.rutina.id,
          scheduled_at: a.cuando,
          target_minutes: a.rutina.target_minutes,
          focus: a.rutina.focus,
        });
        // Si otra corrida ya la creó, el índice único la rechaza: no es un error.
        if (!error) resumen.creadas++;
      } else if (a.tipo === "notificar") {
        // El filtro por estado evita avisar dos veces si dos corridas se pisan.
        const { data } = await admin
          .from("sessions")
          .update({ status: "notificada", notified_at: ahoraISO })
          .eq("id", a.sesion.id)
          .eq("status", "programada")
          .select("id");
        if (!data?.length) continue;
        resumen.notificadas++;
        avisos.push({
          titulo: "Tu Agente te está llamando",
          cuerpo: focoDe(a.sesion) ?? "Tocá para atender la llamada.",
          url: `/llamada/${a.sesion.id}`,
          etiqueta: `llamada-${a.sesion.id}`,
          persistente: true,
        });
      } else if (a.tipo === "reprogramar") {
        const { data } = await admin
          .from("sessions")
          .update({ status: "reprogramada", ended_at: ahoraISO })
          .eq("id", a.sesion.id)
          .eq("status", "notificada")
          .select("id");
        if (!data?.length) continue;
        await admin.from("sessions").insert({
          user_id: userId,
          kind: "llamada_programada",
          channel: "voz",
          status: "programada",
          routine_id: a.sesion.routine_id,
          rescheduled_from: a.sesion.id,
          reschedule_count: a.sesion.reschedule_count + 1,
          scheduled_at: a.cuando,
          target_minutes: a.sesion.target_minutes,
          focus: focoDe(a.sesion),
        });
        resumen.reprogramadas++;
        avisos.push({
          titulo: "Reprogramé la llamada",
          cuerpo: `No atendiste, así que te la pasé para ${cuandoLegible(new Date(a.cuando), zona, ahora)}.`,
          url: "/hoy",
          etiqueta: `llamada-${a.sesion.id}`,
        });
      } else {
        const { data } = await admin
          .from("sessions")
          .update({ status: "perdida", ended_at: ahoraISO })
          .eq("id", a.sesion.id)
          .eq("status", "notificada")
          .select("id");
        if (!data?.length) continue;
        resumen.perdidas++;
        avisos.push({
          titulo: "Se perdió la llamada",
          cuerpo: "No pudimos hablar hoy. Los temas pendientes pasan a la próxima llamada.",
          url: "/hoy",
          etiqueta: `llamada-${a.sesion.id}`,
        });
      }
    }

    if (!avisos.length || !p.enviar) continue;
    const { data: suscripciones } = await admin
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("user_id", userId);
    for (const s of (suscripciones ?? []) as Suscripcion[]) {
      for (const aviso of avisos) {
        const resultado = await p.enviar(s, aviso);
        if (resultado === "ok") resumen.avisos++;
        if (resultado === "vencida") {
          await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          break;
        }
      }
    }
  }
  return resumen;
}
