"use client";

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { EstadoDatos, Filtro } from "@/components/filtro";
import { AltaRapida } from "@/components/tareas/alta-rapida";
import { CuentaSubtareas, FechaLimite, MarcaPrioridad } from "@/components/tareas/fila-tarea";
import { EncabezadoPagina } from "@/components/ui/varios";
import { useDatos, useTareasVisibles } from "@/lib/datos/almacen";
import { sumarDias } from "@/lib/datos/fechas";
import { ordenEnPosicion } from "@/lib/datos/orden";
import { ESTADOS_TAREA, type EstadoTarea, type Tarea } from "@/lib/datos/tipos";

/** En "Hecha" solo se ve lo de las últimas dos semanas, para que no crezca sin fin. */
const DIAS_HECHAS = 14;

function Tarjeta({ tarea, flotando = false }: { tarea: Tarea; flotando?: boolean }) {
  const { hoy, proyectos, areas } = useDatos();
  const proyecto = proyectos.find((p) => p.id === tarea.project_id);
  const area = areas.find((a) => a.id === proyecto?.area_id);
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-md border bg-elevado px-3 py-2.5 text-left ${
        flotando ? "border-acento shadow-xl shadow-black/50" : "border-borde hover:border-borde-fuerte"
      }`}
    >
      <span className={`text-sm leading-snug ${tarea.status === "hecha" ? "text-texto-3 line-through" : ""}`}>
        {tarea.title}
      </span>
      {tarea.status === "bloqueada" && tarea.blocked_reason ? (
        <span className="text-xs text-aviso">{tarea.blocked_reason}</span>
      ) : null}
      <span className="flex items-center gap-2.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-texto-3">
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: area?.color ?? "var(--color-borde-fuerte)" }}
          />
          <span className="truncate">{proyecto?.name}</span>
        </span>
        <CuentaSubtareas id={tarea.id} />
        <MarcaPrioridad prioridad={tarea.priority} />
        <FechaLimite tarea={tarea} hoy={hoy} />
      </span>
    </div>
  );
}

function TarjetaArrastrable({ tarea }: { tarea: Tarea }) {
  const { abrirTarea } = useDatos();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tarea.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "opacity-30" : ""}
    >
      {/* Un clic abre la tarea; arrastrar (o Espacio y flechas) la mueve. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        role="button"
        aria-roledescription="tarjeta que se puede mover"
        onClick={() => abrirTarea(tarea.id)}
        className="block w-full touch-manipulation rounded-md text-left"
      >
        <Tarjeta tarea={tarea} />
      </button>
    </li>
  );
}

function Columna({ estado, nombre, tareas }: { estado: EstadoTarea; nombre: string; tareas: Tarea[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: estado });
  return (
    <section
      aria-label={nombre}
      className="flex w-[82vw] max-w-80 shrink-0 snap-start flex-col gap-2 md:w-auto md:min-w-0 md:max-w-none md:flex-1"
    >
      <h2 className="rotulo flex items-center gap-2 px-1">
        {nombre}
        <span className="font-normal opacity-70">{tareas.length}</span>
      </h2>
      <SortableContext items={tareas.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={`flex min-h-24 flex-1 flex-col gap-2 rounded-lg border p-2 transition-colors ${
            isOver ? "border-acento/50 bg-acento-suave" : "border-borde bg-panel"
          }`}
        >
          {tareas.map((t) => (
            <TarjetaArrastrable key={t.id} tarea={t} />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

export function Tablero() {
  const { estado, hoy, editarTarea, abrirTarea } = useDatos();
  const visibles = useTareasVisibles();
  const [arrastrada, setArrastrada] = useState<string | null>(null);

  const sensores = useSensors(
    // Con el mouse hay que mover 6px para arrastrar: así un clic sigue siendo un clic.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // En pantallas táctiles se mantiene apretado un instante, para poder hacer scroll.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const desde = sumarDias(hoy, -DIAS_HECHAS);
  const principales = visibles.filter((t) => !t.parent_id);
  const columnas = Object.fromEntries(
    ESTADOS_TAREA.map(({ valor }) => [
      valor,
      principales
        .filter((t) => t.status === valor)
        .filter((t) => valor !== "hecha" || (t.completed_at ?? "9999").slice(0, 10) >= desde)
        .sort((a, b) =>
          valor === "hecha"
            ? (b.completed_at ?? "").localeCompare(a.completed_at ?? "")
            : a.sort_order - b.sort_order,
        ),
    ]),
  ) as Record<EstadoTarea, Tarea[]>;

  function alSoltar({ active, over }: DragEndEvent) {
    setArrastrada(null);
    if (!over) return;
    const tarea = principales.find((t) => t.id === active.id);
    if (!tarea) return;

    // Se soltó sobre una columna vacía (el id es el estado) o sobre otra tarjeta.
    const sobreTarjeta = principales.find((t) => t.id === over.id);
    const destino = (sobreTarjeta?.status ?? over.id) as EstadoTarea;
    if (!ESTADOS_TAREA.some((e) => e.valor === destino)) return;
    const lista = columnas[destino];

    let indice = lista.length;
    if (sobreTarjeta) {
      if (sobreTarjeta.id === tarea.id) return;
      // El índice se cuenta sin la tarjeta que se mueve. Con esa cuenta, el lugar
      // de la tarjeta pisada sirve en los dos sentidos: al bajar queda después
      // de ella y al subir (o al venir de otra columna), antes.
      indice = lista.findIndex((t) => t.id === sobreTarjeta.id);
    }

    const cambios: { status?: EstadoTarea; sort_order?: number } = {};
    if (destino !== tarea.status) cambios.status = destino;
    // "Hecha" se ordena sola por fecha de cierre; no tiene orden manual.
    if (destino !== "hecha") cambios.sort_order = ordenEnPosicion(lista, tarea.id, indice);
    void editarTarea(tarea.id, cambios);
    // Al bloquear, se abre la tarea para anotar qué la traba.
    if (cambios.status === "bloqueada") abrirTarea(tarea.id);
  }

  const flotante = principales.find((t) => t.id === arrastrada);

  return (
    <>
      <EncabezadoPagina titulo="Tablero" descripcion="Arrastrá las tarjetas para cambiarles el estado o el orden." />
      {estado !== "listo" ? (
        <EstadoDatos />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-80">
              <AltaRapida />
            </div>
            <Filtro />
          </div>
          <DndContext
            sensors={sensores}
            collisionDetection={closestCorners}
            onDragStart={(e) => setArrastrada(String(e.active.id))}
            onDragCancel={() => setArrastrada(null)}
            onDragEnd={alSoltar}
          >
            {/* En el celular las columnas se deslizan de costado, de a una. */}
            <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:snap-none md:overflow-visible md:px-0">
              {ESTADOS_TAREA.map(({ valor, nombre }) => (
                <Columna key={valor} estado={valor} nombre={nombre} tareas={columnas[valor]} />
              ))}
            </div>
            <DragOverlay>{flotante ? <Tarjeta tarea={flotante} flotando /> : null}</DragOverlay>
          </DndContext>
        </div>
      )}
    </>
  );
}
