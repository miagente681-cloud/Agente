import { partesEnZona } from "@/lib/programacion/horarios";
import { diaSemana, fechaEnZona } from "./fechas";
import type { RutinaLlamada } from "./proxima-llamada";
import type { Tarea } from "./tipos";

/**
 * Lo que hay en un día, para la tira de la semana de Hoy. Lógica pura: recibe
 * las tareas, las llamadas y las rutinas, no lee la base ni el reloj.
 */

/**
 * El día en que se ubica una tarea: el que elegiste para hacerla; si no, el de
 * su fecha límite. Es la misma regla del Calendario y de los puntos de la tira.
 */
export const diaDeTarea = (t: Pick<Tarea, "plan_fecha" | "due_date">): string | null => t.plan_fecha ?? t.due_date;

/** Las tareas sin hacer que caen ese día y las que se hicieron ese día (en la zona del perfil). */
export function tareasDelDia(tareas: Tarea[], dia: string, zona: string): { pendientes: Tarea[]; hechas: Tarea[] } {
  return {
    pendientes: tareas.filter((t) => t.status !== "hecha" && diaDeTarea(t) === dia),
    hechas: tareas.filter(
      (t) => t.status === "hecha" && t.completed_at !== null && fechaEnZona(t.completed_at, zona) === dia,
    ),
  };
}

export type SesionDelDia = {
  id: string;
  status: string;
  scheduled_at: string | null;
  focus: string | null;
  routine_id: string | null;
};

export type RutinaConId = RutinaLlamada & { id: string };

export type LlamadaDelDia = {
  /** La sesión, si ya existe; null si sale de una rutina y el programador todavía no la creó. */
  id: string | null;
  hora: string;
  foco: string | null;
  estado: "programada" | "en_curso" | "hecha" | "perdida";
};

function estadoDe(status: string): LlamadaDelDia["estado"] {
  if (status === "completada") return "hecha";
  if (status === "perdida") return "perdida";
  if (status === "en_curso") return "en_curso";
  return "programada";
}

/**
 * Las llamadas del Agente de un día: las que ya existen (sin contar las que se
 * reprogramaron, que reaparecen en su nuevo horario) y, si el día todavía no
 * llegó, las que van a salir de las rutinas, porque el programador crea cada
 * llamada recién ese mismo día.
 */
export function llamadasDelDia(
  sesiones: SesionDelDia[],
  rutinas: RutinaConId[],
  dia: string,
  hoy: string,
  zona: string,
): LlamadaDelDia[] {
  const existentes: LlamadaDelDia[] = [];
  const rutinasConSesion = new Set<string>();
  for (const s of sesiones) {
    if (!s.scheduled_at || s.status === "reprogramada") continue;
    const enZona = partesEnZona(new Date(s.scheduled_at), zona);
    if (enZona.fecha !== dia) continue;
    existentes.push({ id: s.id, hora: enZona.hora, foco: s.focus, estado: estadoDe(s.status) });
    if (s.routine_id) rutinasConSesion.add(s.routine_id);
  }
  const porVenir: LlamadaDelDia[] =
    dia > hoy
      ? rutinas
          .filter((r) => r.active && r.weekdays.includes(diaSemana(dia)) && !rutinasConSesion.has(r.id))
          .map((r) => ({ id: null, hora: r.local_time.slice(0, 5), foco: r.focus, estado: "programada" }))
      : [];
  return [...existentes, ...porVenir].sort((a, b) => a.hora.localeCompare(b.hora));
}
