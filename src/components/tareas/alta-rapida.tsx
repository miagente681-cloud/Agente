"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Entrada, Selector } from "@/components/ui/campo";
import { useDatos } from "@/lib/datos/almacen";
import { etiquetaFecha } from "@/lib/datos/fechas";
import { parsearTarea } from "@/lib/datos/parsear-tarea";
import type { EstadoTarea } from "@/lib/datos/tipos";

const CLAVE_ULTIMO = "miagente:ultimo-proyecto";

function ultimoProyecto(): string | null {
  try {
    return localStorage.getItem(CLAVE_ULTIMO);
  } catch {
    return null;
  }
}

/**
 * Alta de tarea en una línea. La fecha y la prioridad se pueden escribir al
 * final del texto ("Pintar el cuarto vie p1").
 */
export function AltaRapida({
  proyectoFijo,
  fechaFija,
  estado,
  marcador = "Nueva tarea…",
}: {
  proyectoFijo?: string;
  fechaFija?: string;
  estado?: EstadoTarea;
  marcador?: string;
}) {
  const { hoy, proyectos, filtro, crearTarea } = useDatos();
  const id = useId();
  const [texto, setTexto] = useState("");
  const [elegido, setElegido] = useState<string | null>(null);

  const activos = proyectos.filter((p) => p.status === "activo");
  // Proyecto por defecto: el del filtro, el último que se usó, o el primero.
  const proyectoId =
    proyectoFijo ??
    [elegido, filtro.proyectoId, ultimoProyecto(), activos[0]?.id].find(
      (x) => x && activos.some((p) => p.id === x),
    ) ??
    null;

  if (!proyectoFijo && !activos.length) {
    return (
      <p className="rounded-md border border-dashed border-borde px-3.5 py-2.5 text-sm text-texto-2">
        Las tareas viven dentro de un proyecto.{" "}
        <Link href="/proyectos" className="font-medium text-acento hover:text-acento-fuerte">
          Creá el primero
        </Link>
        .
      </p>
    );
  }

  const leida = parsearTarea(texto, hoy);
  const fecha = leida.due_date ?? fechaFija ?? null;
  const pista = [
    leida.due_date ? `Vence ${etiquetaFecha(leida.due_date, hoy).toLowerCase()}` : null,
    leida.priority ? `Prioridad P${leida.priority}` : null,
  ].filter(Boolean);

  function agregar(e: FormEvent) {
    e.preventDefault();
    if (!leida.titulo || !proyectoId) return;
    void crearTarea({
      project_id: proyectoId,
      title: leida.titulo.slice(0, 300),
      due_date: fecha,
      ...(leida.priority ? { priority: leida.priority } : {}),
      ...(estado ? { status: estado } : {}),
    });
    try {
      localStorage.setItem(CLAVE_ULTIMO, proyectoId);
    } catch {
      // Sin almacenamiento: no se recuerda el proyecto, nada más.
    }
    setTexto("");
  }

  return (
    <form onSubmit={agregar} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Plus
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texto-3"
          />
          <label htmlFor={id} className="sr-only">
            Nueva tarea
          </label>
          <Entrada
            id={id}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={marcador}
            autoComplete="off"
            enterKeyHint="done"
            className="pl-9"
          />
        </div>
        {!proyectoFijo ? (
          <>
            <label htmlFor={`${id}-p`} className="sr-only">
              Proyecto de la tarea
            </label>
            <Selector
              id={`${id}-p`}
              value={proyectoId ?? ""}
              onChange={(e) => setElegido(e.target.value)}
              className="!w-32 shrink-0 sm:!w-44"
            >
              {activos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Selector>
          </>
        ) : null}
      </div>
      {pista.length ? (
        <p className="pl-1 text-xs text-acento">{pista.join(" · ")}</p>
      ) : texto.trim() ? (
        // La ayuda aparece recién al escribir, para no ocupar lugar siempre.
        <p className="pl-1 text-xs text-texto-3">
          Enter para agregar. Podés terminar con: mañana, vie, 14/11, p1
        </p>
      ) : null}
    </form>
  );
}
