"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { EstadoDatos, Filtro } from "@/components/filtro";
import { AltaRapida } from "@/components/tareas/alta-rapida";
import { ListaTareas } from "@/components/tareas/fila-tarea";
import { Boton } from "@/components/ui/boton";
import { EncabezadoPagina } from "@/components/ui/varios";
import { porPrioridad, useDatos, useTareasVisibles } from "@/lib/datos/almacen";
import { fechaLarga, grillaMes, MESES } from "@/lib/datos/fechas";
import type { Tarea } from "@/lib/datos/tipos";

const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const MAXIMO_POR_DIA = 3;

function Ficha({ tarea, hoy }: { tarea: Tarea; hoy: string }) {
  const { abrirTarea } = useDatos();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: tarea.id });
  const hecha = tarea.status === "hecha";
  const vencida = !hecha && tarea.due_date !== null && tarea.due_date < hoy;
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // El teclado no arrastra acá: la fecha se cambia desde el detalle de la tarea.
      tabIndex={-1}
      role="presentation"
      onClick={() => abrirTarea(tarea.id)}
      className={`block cursor-grab truncate rounded px-1.5 py-0.5 text-[11px] leading-4 ${
        isDragging ? "opacity-30" : ""
      } ${
        hecha
          ? "text-texto-3 line-through"
          : vencida
            ? "bg-peligro-suave text-peligro"
            : "bg-elevado text-texto-2"
      }`}
    >
      {tarea.title}
    </span>
  );
}

function Dia({
  fecha,
  tareas,
  hoy,
  delMes,
  elegido,
  alElegir,
}: {
  fecha: string;
  tareas: Tarea[];
  hoy: string;
  delMes: boolean;
  elegido: boolean;
  alElegir: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: fecha });
  const esHoy = fecha === hoy;
  const abiertas = tareas.filter((t) => t.status !== "hecha").length;
  return (
    <div
      ref={setNodeRef}
      className={`relative min-h-14 border-b border-r border-borde md:min-h-24 ${
        isOver ? "bg-acento-suave" : elegido ? "bg-elevado" : ""
      }`}
    >
      <button
        type="button"
        onClick={alElegir}
        aria-pressed={elegido}
        aria-label={`${fechaLarga(fecha)}${tareas.length ? `, ${tareas.length} ${tareas.length === 1 ? "tarea" : "tareas"}` : ""}`}
        className="absolute inset-0 rounded-none"
      />
      <div className="pointer-events-none relative flex flex-col gap-0.5 p-1 md:p-1.5">
        <span
          className={`flex h-6 w-6 items-center justify-center self-center rounded-full text-xs md:self-start ${
            esHoy ? "bg-acento font-semibold text-sobre-acento" : delMes ? "text-texto-2" : "text-texto-3 opacity-60"
          }`}
        >
          {Number(fecha.slice(8))}
        </span>
        {/* Celular: puntos. Escritorio: títulos que se pueden arrastrar a otro día. */}
        {tareas.length ? (
          <span className="flex justify-center gap-0.5 md:hidden" aria-hidden>
            {tareas.slice(0, 4).map((t) => (
              <span
                key={t.id}
                className={`h-1 w-1 rounded-full ${
                  t.status === "hecha" ? "bg-borde-fuerte" : t.due_date! < hoy ? "bg-peligro" : "bg-acento"
                }`}
              />
            ))}
          </span>
        ) : null}
        <div className="pointer-events-auto hidden flex-col gap-0.5 md:flex">
          {tareas.slice(0, MAXIMO_POR_DIA).map((t) => (
            <Ficha key={t.id} tarea={t} hoy={hoy} />
          ))}
          {tareas.length > MAXIMO_POR_DIA ? (
            <span className="pointer-events-none px-1.5 text-[11px] text-texto-3">
              +{tareas.length - MAXIMO_POR_DIA} más{abiertas ? "" : " (hechas)"}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Calendario() {
  const { estado, hoy, editarTarea } = useDatos();
  const visibles = useTareasVisibles();
  // null = el mes y el día de hoy (así sigue al reloj sin guardar estado de más).
  const [mesVisto, setMesVisto] = useState<{ anio: number; mes: number } | null>(null);
  const [diaElegido, setDiaElegido] = useState<string | null>(null);
  const [arrastrada, setArrastrada] = useState<string | null>(null);

  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const { anio, mes } = mesVisto ?? { anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)) };
  const dia = diaElegido ?? hoy;
  const celdas = grillaMes(anio, mes);
  const prefijo = `${anio}-${String(mes).padStart(2, "0")}`;

  const porDia = new Map<string, Tarea[]>();
  for (const t of visibles) {
    if (!t.due_date) continue;
    porDia.set(t.due_date, [...(porDia.get(t.due_date) ?? []), t]);
  }
  for (const lista of porDia.values()) {
    lista.sort((a, b) => Number(a.status === "hecha") - Number(b.status === "hecha") || porPrioridad(a, b));
  }

  const mover = (delta: number) => {
    const total = anio * 12 + (mes - 1) + delta;
    setMesVisto({ anio: Math.floor(total / 12), mes: (total % 12) + 1 });
  };

  function alSoltar({ active, over }: DragEndEvent) {
    setArrastrada(null);
    if (!over) return;
    const tarea = visibles.find((t) => t.id === active.id);
    if (tarea && tarea.due_date !== over.id) void editarTarea(tarea.id, { due_date: String(over.id) });
  }

  const delDia = porDia.get(dia) ?? [];
  const flotante = visibles.find((t) => t.id === arrastrada);

  return (
    <>
      <EncabezadoPagina titulo="Calendario" descripcion="Las tareas, en el día de su fecha límite." />
      {estado !== "listo" ? (
        <EstadoDatos />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Boton tamano="sm" variante="fantasma" aria-label="Mes anterior" onClick={() => mover(-1)}>
                <ChevronLeft size={16} aria-hidden />
              </Boton>
              <h2 className="min-w-36 text-center font-medium capitalize" aria-live="polite">
                {MESES[mes - 1]} {anio}
              </h2>
              <Boton tamano="sm" variante="fantasma" aria-label="Mes siguiente" onClick={() => mover(1)}>
                <ChevronRight size={16} aria-hidden />
              </Boton>
              <Boton
                tamano="sm"
                className="ml-1"
                onClick={() => {
                  setMesVisto(null);
                  setDiaElegido(null);
                }}
              >
                Hoy
              </Boton>
            </div>
            <Filtro />
          </div>

          <DndContext
            sensors={sensores}
            onDragStart={(e) => setArrastrada(String(e.active.id))}
            onDragCancel={() => setArrastrada(null)}
            onDragEnd={alSoltar}
          >
            <div className="overflow-hidden rounded-lg border border-borde bg-panel">
              <div className="grid grid-cols-7 border-b border-borde">
                {DIAS.map((d) => (
                  <span key={d} className="rotulo py-1.5 text-center !text-[11px]">
                    {d}
                  </span>
                ))}
              </div>
              <div className="-mb-px -mr-px grid grid-cols-7">
                {celdas.map((fecha) => (
                  <Dia
                    key={fecha}
                    fecha={fecha}
                    tareas={porDia.get(fecha) ?? []}
                    hoy={hoy}
                    delMes={fecha.startsWith(prefijo)}
                    elegido={fecha === dia}
                    alElegir={() => setDiaElegido(fecha)}
                  />
                ))}
              </div>
            </div>
            <DragOverlay>
              {flotante ? (
                <span className="block max-w-48 truncate rounded border border-acento bg-elevado px-1.5 py-0.5 text-[11px] shadow-lg">
                  {flotante.title}
                </span>
              ) : null}
            </DragOverlay>
          </DndContext>

          <section className="flex flex-col gap-2">
            <h2 className="rotulo">
              {dia === hoy ? "Hoy · " : ""}
              {fechaLarga(dia)}
            </h2>
            {delDia.length ? (
              <ListaTareas tareas={delDia} />
            ) : (
              <p className="text-sm text-texto-3">Nada vence este día.</p>
            )}
            <AltaRapida fechaFija={dia} marcador="Agregar una tarea para este día…" />
          </section>
        </div>
      )}
    </>
  );
}
