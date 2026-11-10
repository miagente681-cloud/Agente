"use client";

import Link from "next/link";
import { Archive, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Boton } from "@/components/ui/boton";
import { AreaTexto, Campo, Entrada, Selector } from "@/components/ui/campo";
import { Dialogo } from "@/components/ui/dialogo";
import { useDatos } from "@/lib/datos/almacen";
import { ESTADOS_TAREA, PRIORIDADES, type EstadoTarea, type Tarea } from "@/lib/datos/tipos";
import { Casilla } from "./fila-tarea";

/** Diálogo único de tarea: lo abre cualquier vista con `abrirTarea(id)`. */
export function DetalleTarea() {
  const { tareas, tareaAbierta, abrirTarea } = useDatos();
  const tarea = tareas.find((t) => t.id === tareaAbierta) ?? null;
  return (
    <Dialogo
      abierto={Boolean(tarea)}
      alCerrar={() => abrirTarea(null)}
      titulo={tarea?.parent_id ? "Subtarea" : "Tarea"}
    >
      {/* La clave reinicia el formulario al pasar de una tarea a otra. */}
      {tarea ? <Formulario key={tarea.id} tarea={tarea} /> : null}
    </Dialogo>
  );
}

function Formulario({ tarea }: { tarea: Tarea }) {
  const { proyectos, tareas, editarTarea, archivarTarea, borrarTarea, abrirTarea } = useDatos();
  const [titulo, setTitulo] = useState(tarea.title);
  const [descripcion, setDescripcion] = useState(tarea.description ?? "");
  const [motivo, setMotivo] = useState(tarea.blocked_reason ?? "");
  const [esfuerzo, setEsfuerzo] = useState(tarea.effort_minutes?.toString() ?? "");
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const madre = tarea.parent_id ? tareas.find((t) => t.id === tarea.parent_id) : null;
  // Se puede mover a un proyecto activo, o dejarla en el que está aunque esté pausado.
  const destinos = proyectos.filter((p) => p.status === "activo" || p.id === tarea.project_id);

  // Los textos se guardan al salir del campo; lo demás, al cambiar.
  const guardarTitulo = () => {
    const limpio = titulo.trim();
    if (!limpio) return setTitulo(tarea.title);
    if (limpio !== tarea.title) void editarTarea(tarea.id, { title: limpio });
  };
  const guardarDescripcion = () => {
    const limpia = descripcion.trim() || null;
    if (limpia !== tarea.description) void editarTarea(tarea.id, { description: limpia });
  };
  const guardarMotivo = () => {
    const limpio = motivo.trim() || null;
    if (limpio !== tarea.blocked_reason) void editarTarea(tarea.id, { blocked_reason: limpio });
  };
  const guardarEsfuerzo = () => {
    const minutos = Math.round(Number(esfuerzo));
    const valor = esfuerzo.trim() && minutos > 0 ? minutos : null;
    setEsfuerzo(valor?.toString() ?? "");
    if (valor !== tarea.effort_minutes) void editarTarea(tarea.id, { effort_minutes: valor });
  };

  return (
    <div className="flex flex-col gap-4">
      {madre ? (
        <button
          type="button"
          onClick={() => abrirTarea(madre.id)}
          className="-mb-2 self-start rounded-sm text-xs text-texto-3 hover:text-texto"
        >
          ← {madre.title}
        </button>
      ) : null}

      <div className="flex items-start gap-3">
        <div className="pt-2.5">
          <Casilla tarea={tarea} />
        </div>
        <label htmlFor="tarea-titulo" className="sr-only">
          Título
        </label>
        <Entrada
          id="tarea-titulo"
          value={titulo}
          maxLength={300}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={guardarTitulo}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="!text-base font-medium"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Estado" htmlFor="tarea-estado">
          <Selector
            id="tarea-estado"
            value={tarea.status}
            onChange={(e) => void editarTarea(tarea.id, { status: e.target.value as EstadoTarea })}
          >
            {ESTADOS_TAREA.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.nombre}
              </option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Prioridad" htmlFor="tarea-prioridad">
          <Selector
            id="tarea-prioridad"
            value={tarea.priority}
            onChange={(e) => void editarTarea(tarea.id, { priority: Number(e.target.value) })}
          >
            {PRIORIDADES.map((p) => (
              <option key={p.valor} value={p.valor}>
                P{p.valor} · {p.nombre}
              </option>
            ))}
          </Selector>
        </Campo>
        <Campo
          etiqueta="Fecha límite"
          htmlFor="tarea-fecha"
          ayuda={tarea.due_date && tarea.due_set_by === "agente" ? "La propuso el Agente." : undefined}
        >
          <Entrada
            id="tarea-fecha"
            type="date"
            value={tarea.due_date ?? ""}
            onChange={(e) => void editarTarea(tarea.id, { due_date: e.target.value || null })}
          />
        </Campo>
        <Campo etiqueta="Esfuerzo (minutos)" htmlFor="tarea-esfuerzo">
          <Entrada
            id="tarea-esfuerzo"
            inputMode="numeric"
            value={esfuerzo}
            onChange={(e) => setEsfuerzo(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onBlur={guardarEsfuerzo}
          />
        </Campo>
      </div>

      {tarea.status === "bloqueada" ? (
        <Campo etiqueta="¿Qué la traba?" htmlFor="tarea-motivo">
          <Entrada
            id="tarea-motivo"
            value={motivo}
            maxLength={300}
            placeholder="Por ejemplo: espero el presupuesto del electricista"
            onChange={(e) => setMotivo(e.target.value)}
            onBlur={guardarMotivo}
          />
        </Campo>
      ) : null}

      {!tarea.parent_id ? (
        <Campo etiqueta="Proyecto" htmlFor="tarea-proyecto">
          <Selector
            id="tarea-proyecto"
            value={tarea.project_id}
            onChange={(e) => void editarTarea(tarea.id, { project_id: e.target.value })}
          >
            {destinos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Selector>
        </Campo>
      ) : null}

      <Campo etiqueta="Notas" htmlFor="tarea-notas">
        <AreaTexto
          id="tarea-notas"
          value={descripcion}
          maxLength={5000}
          onChange={(e) => setDescripcion(e.target.value)}
          onBlur={guardarDescripcion}
        />
      </Campo>

      {!tarea.parent_id ? <Subtareas tarea={tarea} /> : null}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-borde pt-4">
        <Link
          href={`/proyectos/${tarea.project_id}`}
          onClick={() => abrirTarea(null)}
          className="rounded-sm text-[13px] text-texto-2 hover:text-texto"
        >
          Ver el proyecto
        </Link>
        {confirmarBorrado ? (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-texto-2">¿Borrar para siempre?</span>
            <Boton tamano="sm" variante="peligro" onClick={() => void borrarTarea(tarea.id)}>
              Sí, borrar
            </Boton>
            <Boton tamano="sm" variante="fantasma" onClick={() => setConfirmarBorrado(false)}>
              No
            </Boton>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Boton tamano="sm" variante="fantasma" onClick={() => void archivarTarea(tarea.id)}>
              <Archive size={14} aria-hidden />
              Archivar
            </Boton>
            <Boton tamano="sm" variante="fantasma" onClick={() => setConfirmarBorrado(true)}>
              <Trash2 size={14} aria-hidden />
              Borrar
            </Boton>
          </div>
        )}
      </div>
    </div>
  );
}

function Subtareas({ tarea }: { tarea: Tarea }) {
  const { tareas, crearTarea, abrirTarea, borrarTarea } = useDatos();
  const [nueva, setNueva] = useState("");
  const hijas = tareas
    .filter((t) => t.parent_id === tarea.id)
    .sort((a, b) => a.sort_order - b.sort_order);

  function agregar(e: FormEvent) {
    e.preventDefault();
    const titulo = nueva.trim();
    if (!titulo) return;
    void crearTarea({ project_id: tarea.project_id, parent_id: tarea.id, title: titulo.slice(0, 300) });
    setNueva("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] font-medium text-texto-2">
        Subtareas{hijas.length ? ` · ${hijas.filter((h) => h.status === "hecha").length}/${hijas.length}` : ""}
      </p>
      {hijas.length ? (
        <ul>
          {hijas.map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-1.5">
              <Casilla tarea={h} />
              <button
                type="button"
                onClick={() => abrirTarea(h.id)}
                className={`min-w-0 flex-1 truncate rounded-sm text-left text-sm ${
                  h.status === "hecha" ? "text-texto-3 line-through" : ""
                }`}
              >
                {h.title}
              </button>
              <button
                type="button"
                aria-label={`Borrar la subtarea «${h.title}»`}
                onClick={() => void borrarTarea(h.id)}
                className="-my-1 flex h-8 w-8 items-center justify-center rounded-md text-texto-3 hover:bg-elevado hover:text-texto"
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={agregar}>
        <label htmlFor="subtarea-nueva" className="sr-only">
          Nueva subtarea
        </label>
        <Entrada
          id="subtarea-nueva"
          value={nueva}
          placeholder="Agregar un paso…"
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => setNueva(e.target.value)}
          className="!h-9 !text-sm"
        />
      </form>
    </div>
  );
}
