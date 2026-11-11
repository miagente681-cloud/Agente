import type { SupabaseClient } from "@supabase/supabase-js";
import type { Area, Proyecto, Tarea } from "@/lib/datos/tipos";

/** Lo que el Agente necesita saber del usuario para un turno. Se lee una vez. */

export type Memoria = {
  id: string;
  category: string;
  content: string;
  edited_by_user: boolean;
  source_session_id: string | null;
  updated_at: string;
};

export type Rutina = {
  id: string;
  name: string;
  weekdays: number[];
  local_time: string;
  target_minutes: number;
  focus: string | null;
  active: boolean;
};

export type Sesion = {
  id: string;
  user_id?: string;
  kind: "onboarding" | "llamada_programada" | "chat";
  channel: "voz" | "texto";
  status: string;
  routine_id: string | null;
  rescheduled_from: string | null;
  scheduled_at: string | null;
  notified_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  summary: string | null;
  commitments: { texto: string; fecha?: string | null }[];
  reschedule_count: number;
  providers_used: string[];
  history_summary: string | null;
  history_summary_until: string | null;
  target_minutes: number | null;
  focus: string | null;
  /** Memorias y estado congelados al empezar la sesión (ver runner). */
  context_snapshot?: string | null;
  context_snapshot_at?: string | null;
  created_at: string;
};

export type Perfil = {
  user_id: string;
  name: string | null;
  timezone: string;
  agent_config: Record<string, unknown>;
  onboarding_done: boolean;
};

export type Instantanea = {
  perfil: Perfil;
  areas: Area[];
  proyectos: Proyecto[];
  tareas: Tarea[];
  memorias: Memoria[];
  rutinas: Rutina[];
  /** Últimas sesiones cerradas, la más nueva primero. */
  anteriores: Sesion[];
  /** Llamadas programadas que todavía no ocurrieron. */
  proximas: Sesion[];
};

const TAREA =
  "id,project_id,parent_id,title,description,status,priority,due_date,due_set_by,effort_minutes," +
  "blocked_reason,sort_order,completed_at,status_changed_at,archived_at,created_at";

function filas<T>(r: { data: unknown; error: unknown }): T[] {
  if (r.error) throw new Error("No se pudieron leer los datos");
  return (r.data ?? []) as T[];
}

export async function leerInstantanea(sb: SupabaseClient, sesionId?: string): Promise<Instantanea> {
  const [perfil, areas, proyectos, tareas, memorias, rutinas, anteriores, proximas] = await Promise.all([
    sb.from("profiles").select("user_id,name,timezone,agent_config,onboarding_done").maybeSingle(),
    sb.from("areas").select("id,name,color,icon,sort_order").is("archived_at", null).order("sort_order"),
    sb
      .from("projects")
      .select("id,area_id,name,goal,description,status,priority,due_date,sort_order,created_at")
      .neq("status", "archivado")
      .order("sort_order"),
    sb.from("tasks").select(TAREA).is("archived_at", null).order("sort_order").limit(1000),
    sb
      .from("memories")
      .select("id,category,content,edited_by_user,source_session_id,updated_at")
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(60),
    sb.from("call_routines").select("id,name,weekdays,local_time,target_minutes,focus,active"),
    sb
      .from("sessions")
      .select("*")
      .in("status", ["completada", "perdida"])
      .order("created_at", { ascending: false })
      .limit(6),
    sb.from("sessions").select("*").in("status", ["programada", "notificada"]).order("scheduled_at").limit(10),
  ]);
  if (perfil.error || !perfil.data) throw new Error("No se pudo leer el perfil");
  return {
    perfil: perfil.data as Perfil,
    areas: filas<Area>(areas),
    proyectos: filas<Proyecto>(proyectos),
    tareas: filas<Tarea>(tareas),
    memorias: filas<Memoria>(memorias),
    rutinas: filas<Rutina>(rutinas),
    anteriores: filas<Sesion>(anteriores).filter((s) => s.id !== sesionId),
    proximas: filas<Sesion>(proximas).filter((s) => s.id !== sesionId),
  };
}

/**
 * Los ids se le pasan al modelo recortados a 8 caracteres: un UUID entero
 * gasta unos 20 tokens y con los cupos gratuitos eso se nota.
 */
export const corto = (id: string) => id.slice(0, 8);

export function buscarPorId<T extends { id: string }>(lista: T[], id: string): T | null {
  const limpio = id.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (limpio.length < 6) return null;
  const candidatos = lista.filter((x) => x.id === limpio || x.id.startsWith(limpio));
  return candidatos.length === 1 ? candidatos[0] : null;
}
