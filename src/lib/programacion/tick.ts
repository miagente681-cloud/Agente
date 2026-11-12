import type { SupabaseClient } from "@supabase/supabase-js";
import { destinoPushValido } from "@/lib/push/destinos";
import { ajustesDe, cuandoLegible, decidir, recordatoriosPendientes, type RecordatorioP, type RutinaP, type SesionP, type Ventana } from "./horarios";

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
  /** Recordatorios enviados (los que cada persona programó en Configuración). */
  recordatorios: number;
  /** Avisos que no se mandaron porque se acabó el tiempo de esta corrida. */
  postergados: number;
};

/**
 * Tiempo total que una corrida puede dedicar a mandar notificaciones. Cada
 * envío tiene además su propio máximo (ver push/servidor.ts). Lo que no entra
 * se descarta: un aviso de llamada viejo no sirve, y el estado ya quedó en la base.
 */
export const TIEMPO_ENVIOS_POR_CORRIDA_MS = 20_000;

type Fila = SesionP & { user_id: string; focus: string | null; kind: string };
const CAMPOS =
  "id,user_id,kind,status,routine_id,rescheduled_from,scheduled_at,notified_at,reschedule_count,target_minutes,focus";
/** Una llamada atendida que quedó abierta se da por terminada a las tres horas. */
const HORAS_ABANDONADA = 3;

export async function correrTick(p: {
  admin: SupabaseClient;
  ahora: Date;
  enviar: EnviarPush | null;
  /** Para las pruebas: tiempo de envíos de la corrida y reloj. */
  tiempoEnviosMs?: number;
  reloj?: () => number;
}): Promise<ResumenTick> {
  const { admin, ahora } = p;
  const resumen: ResumenTick = { creadas: 0, notificadas: 0, reprogramadas: 0, perdidas: 0, cerradas: 0, avisos: 0, recordatorios: 0, postergados: 0 };
  const reloj = p.reloj ?? Date.now;
  const limiteEnvios = reloj() + (p.tiempoEnviosMs ?? TIEMPO_ENVIOS_POR_CORRIDA_MS);
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

  /** Manda avisos a los dispositivos de una persona, dentro del tiempo de la corrida. */
  const avisar = async (userId: string, avisos: CargaPush[]): Promise<number> => {
    const enviar = p.enviar;
    if (!avisos.length || !enviar) return 0;
    const { data: suscripciones } = await admin
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("user_id", userId);
    // Como mucho 10 por usuario (lo limita la base); solo destinos de push reales.
    const validas = ((suscripciones ?? []) as Suscripcion[]).filter((s) => destinoPushValido(s.endpoint)).slice(0, 10);
    let enviados = 0;
    // Los dispositivos de una persona en paralelo: uno lento no demora a los otros.
    await Promise.all(
      validas.map(async (s) => {
        for (const aviso of avisos) {
          if (reloj() >= limiteEnvios) {
            resumen.postergados++;
            continue;
          }
          const resultado = await enviar(s, aviso);
          if (resultado === "ok") enviados++;
          if (resultado === "vencida") {
            await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
            break;
          }
        }
      }),
    );
    return enviados;
  };

  // Recordatorios: no dependen de que la persona tenga rutinas de llamada.
  const { data: activos } = await admin
    .from("reminders")
    .select("id,user_id,message,weekdays,local_time,active,last_sent_on")
    .eq("active", true);
  const recordatorios = (activos ?? []) as (RecordatorioP & { user_id: string; message: string })[];
  if (recordatorios.length) {
    const duenos = [...new Set(recordatorios.map((r) => r.user_id))];
    const { data: zonas } = await admin.from("profiles").select("user_id,timezone").in("user_id", duenos);
    for (const perfil of (zonas ?? []) as { user_id: string; timezone: string }[]) {
      const tocan = recordatoriosPendientes(ahora, perfil.timezone, recordatorios.filter((r) => r.user_id === perfil.user_id));
      for (const { recordatorio, fecha } of tocan) {
        // Se marca antes de enviar y solo si nadie lo marcó: dos corridas no avisan dos veces.
        const { data: marcado } = await admin
          .from("reminders")
          .update({ last_sent_on: fecha })
          .eq("id", recordatorio.id)
          .or(`last_sent_on.is.null,last_sent_on.neq.${fecha}`)
          .select("id");
        if (!marcado?.length) continue;
        const enviados = await avisar(perfil.user_id, [
          { titulo: "MiAgente", cuerpo: recordatorio.message, url: "/chat", etiqueta: `recordatorio-${recordatorio.id}` },
        ]);
        if (enviados) resumen.recordatorios++;
      }
    }
  }

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

    resumen.avisos += await avisar(userId, avisos);
  }
  return resumen;
}
