"use client";

import { Check, ListTree, OctagonAlert } from "lucide-react";
import { useDatos } from "@/lib/datos/almacen";
import { etiquetaFecha } from "@/lib/datos/fechas";
import type { Tarea } from "@/lib/datos/tipos";

/** Casilla redonda para marcar una tarea como hecha. Área táctil de 40px. */
export function Casilla({ tarea }: { tarea: Tarea }) {
  const { editarTarea } = useDatos();
  const hecha = tarea.status === "hecha";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={hecha}
      aria-label={hecha ? `Marcar «${tarea.title}» como pendiente` : `Marcar «${tarea.title}» como hecha`}
      onClick={() => editarTarea(tarea.id, { status: hecha ? "pendiente" : "hecha" })}
      className="group/casilla -m-2.5 flex h-10 w-10 shrink-0 items-center justify-center"
    >
      <span
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors ${
          hecha
            ? "border-ok bg-ok text-fondo"
            : "border-borde-fuerte group-hover/casilla:border-texto-2"
        }`}
      >
        {hecha ? <Check size={12} strokeWidth={3} aria-hidden /> : null}
      </span>
    </button>
  );
}

export function MarcaPrioridad({ prioridad }: { prioridad: number }) {
  // Solo se marca lo que se sale de lo normal: urgente y baja.
  if (prioridad === 2 || prioridad === 3) return null;
  return (
    <span
      className={`font-mono text-[11px] font-medium ${prioridad === 1 ? "text-acento" : "text-texto-3"}`}
      title={prioridad === 1 ? "Urgente" : "Prioridad baja"}
    >
      P{prioridad}
    </span>
  );
}

export function FechaLimite({ tarea, hoy }: { tarea: Tarea; hoy: string }) {
  if (!tarea.due_date) return null;
  const vencida = tarea.status !== "hecha" && tarea.due_date < hoy;
  const esHoy = tarea.due_date === hoy;
  return (
    <span
      className={`whitespace-nowrap text-xs ${
        vencida ? "font-medium text-peligro" : esHoy ? "text-texto" : "text-texto-3"
      }`}
    >
      {vencida ? "Venció " : ""}
      {vencida ? etiquetaFecha(tarea.due_date, hoy).toLowerCase() : etiquetaFecha(tarea.due_date, hoy)}
    </span>
  );
}

/** Cuenta de subtareas "2/5", o nada si no tiene. */
export function useSubtareas(id: string) {
  const { tareas } = useDatos();
  const hijas = tareas.filter((t) => t.parent_id === id);
  return { total: hijas.length, hechas: hijas.filter((t) => t.status === "hecha").length };
}

export function CuentaSubtareas({ id }: { id: string }) {
  const { total, hechas } = useSubtareas(id);
  if (!total) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-texto-3" title="Subtareas hechas">
      <ListTree size={12} aria-hidden />
      {hechas}/{total}
    </span>
  );
}

/** Una tarea en una lista: casilla, título y lo justo para decidir. */
export function FilaTarea({
  tarea,
  mostrarProyecto = true,
  sangria = false,
}: {
  tarea: Tarea;
  mostrarProyecto?: boolean;
  sangria?: boolean;
}) {
  const { hoy, proyectos, tareas, abrirTarea } = useDatos();
  const proyecto = proyectos.find((p) => p.id === tarea.project_id);
  const madre = tarea.parent_id ? tareas.find((t) => t.id === tarea.parent_id) : null;
  const hecha = tarea.status === "hecha";
  const contexto = [mostrarProyecto ? proyecto?.name : null, !sangria ? madre?.title : null]
    .filter(Boolean)
    .join(" › ");

  return (
    <li
      className={`flex items-center gap-3 border-b border-borde py-2.5 last:border-b-0 ${sangria ? "pl-7" : ""}`}
    >
      <Casilla tarea={tarea} />
      <button
        type="button"
        onClick={() => abrirTarea(tarea.id)}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm text-left"
      >
        <span className={`w-full truncate ${hecha ? "text-texto-3 line-through" : "text-texto"}`}>
          {tarea.title}
        </span>
        {contexto ? <span className="w-full truncate text-xs text-texto-3">{contexto}</span> : null}
      </button>
      <div className="flex shrink-0 items-center gap-2.5">
        {tarea.status === "bloqueada" ? (
          <span className="inline-flex items-center gap-1 text-xs text-aviso" title={tarea.blocked_reason ?? ""}>
            <OctagonAlert size={12} aria-hidden />
            <span className="hidden sm:inline">Bloqueada</span>
          </span>
        ) : null}
        {tarea.status === "en_curso" ? <span className="text-xs text-info">En curso</span> : null}
        <CuentaSubtareas id={tarea.id} />
        <MarcaPrioridad prioridad={tarea.priority} />
        <FechaLimite tarea={tarea} hoy={hoy} />
      </div>
    </li>
  );
}

export function ListaTareas({
  tareas,
  mostrarProyecto,
}: {
  tareas: Tarea[];
  mostrarProyecto?: boolean;
}) {
  return (
    <ul className="rounded-lg border border-borde bg-panel px-3.5">
      {tareas.map((t) => (
        <FilaTarea key={t.id} tarea={t} mostrarProyecto={mostrarProyecto} />
      ))}
    </ul>
  );
}
