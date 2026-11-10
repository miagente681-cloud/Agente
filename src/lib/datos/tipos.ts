/** Tipos del dominio, tal como están en la base (ver supabase/migrations). */

export type EstadoTarea = "pendiente" | "en_curso" | "bloqueada" | "hecha";
export type EstadoProyecto = "activo" | "pausado" | "completado" | "archivado";
export type TipoBitacora = "nota" | "avance" | "decision" | "resumen_llamada";

export type Area = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
};

export type Proyecto = {
  id: string;
  area_id: string | null;
  name: string;
  goal: string | null;
  description: string | null;
  status: EstadoProyecto;
  priority: number;
  due_date: string | null;
  sort_order: number;
  created_at: string;
};

export type Tarea = {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: EstadoTarea;
  priority: number;
  due_date: string | null;
  due_set_by: "usuario" | "agente" | null;
  effort_minutes: number | null;
  blocked_reason: string | null;
  sort_order: number;
  completed_at: string | null;
  status_changed_at: string;
  archived_at: string | null;
  created_at: string;
};

export type EntradaBitacora = {
  id: string;
  project_id: string;
  kind: TipoBitacora;
  author: "usuario" | "agente";
  content: string;
  created_at: string;
};

export const ESTADOS_TAREA: { valor: EstadoTarea; nombre: string }[] = [
  { valor: "pendiente", nombre: "Pendiente" },
  { valor: "en_curso", nombre: "En curso" },
  { valor: "bloqueada", nombre: "Bloqueada" },
  { valor: "hecha", nombre: "Hecha" },
];

export const ESTADOS_PROYECTO: { valor: EstadoProyecto; nombre: string }[] = [
  { valor: "activo", nombre: "Activo" },
  { valor: "pausado", nombre: "Pausado" },
  { valor: "completado", nombre: "Completado" },
  { valor: "archivado", nombre: "Archivado" },
];

export const PRIORIDADES: { valor: number; nombre: string }[] = [
  { valor: 1, nombre: "Urgente" },
  { valor: 2, nombre: "Alta" },
  { valor: 3, nombre: "Media" },
  { valor: 4, nombre: "Baja" },
];

export const TIPOS_BITACORA: { valor: TipoBitacora; nombre: string }[] = [
  { valor: "nota", nombre: "Nota" },
  { valor: "avance", nombre: "Avance" },
  { valor: "decision", nombre: "Decisión" },
  { valor: "resumen_llamada", nombre: "Resumen de llamada" },
];

/** Colores para áreas. Apagados a propósito: el único color fuerte es el acento. */
export const COLORES_AREA = [
  "#8b8b94", "#6ea8fe", "#4cc38a", "#e0a84a", "#d98ad0", "#ff8f6b", "#5fc7c7", "#a99cf5",
];
