"use client";

import Link from "next/link";
import { Flag, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { AltaRapida } from "@/components/tareas/alta-rapida";
import { ListaTareas } from "@/components/tareas/fila-tarea";
import { Vacio } from "@/components/ui/varios";
import { porHoraDelDia, porPrioridad, useDatos, useProyectosVisibles, useTareasVisibles } from "@/lib/datos/almacen";
import {
  llamadasDelDia,
  tareasDelDia,
  type LlamadaDelDia,
  type RutinaConId,
  type SesionDelDia,
} from "@/lib/datos/dia";
import { diferenciaDias, fechaLarga, sumarDias } from "@/lib/datos/fechas";
import type { Tarea } from "@/lib/datos/tipos";
import { supabaseBrowser } from "@/lib/supabase/client";

export function Seccion({ titulo, tono, tareas }: { titulo: string; tono?: "peligro"; tareas: Tarea[] }) {
  if (!tareas.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className={`rotulo ${tono === "peligro" ? "!text-peligro" : ""}`}>
        {titulo} <span className="font-normal opacity-70">· {tareas.length}</span>
      </h2>
      <ListaTareas tareas={tareas} />
    </section>
  );
}

/** «Mañana», «En 3 días», «Ayer», «Hace 2 días». */
function cuandoEs(dia: string, hoy: string): string {
  const dif = diferenciaDias(hoy, dia);
  if (dif === 1) return "Mañana";
  if (dif === -1) return "Ayer";
  return dif > 0 ? `En ${dif} días` : `Hace ${-dif} días`;
}

/**
 * Las llamadas del Agente de un día. Se piden a la base cada vez que cambia el
 * día elegido: las ya creadas (de un margen de un día para cada lado, porque la
 * base guarda instantes y el día se arma en la zona del perfil) y las rutinas.
 */
function useLlamadasDelDia(dia: string): LlamadaDelDia[] {
  const { hoy, zona } = useDatos();
  const [llamadas, setLlamadas] = useState<{ dia: string; lista: LlamadaDelDia[] } | null>(null);
  useEffect(() => {
    let vigente = true;
    (async () => {
      const sb = supabaseBrowser();
      const [sesiones, rutinas] = await Promise.all([
        sb
          .from("sessions")
          .select("id,status,scheduled_at,focus,routine_id")
          .eq("kind", "llamada_programada")
          .neq("status", "reprogramada")
          .gte("scheduled_at", `${sumarDias(dia, -1)}T00:00:00Z`)
          .lte("scheduled_at", `${sumarDias(dia, 1)}T23:59:59Z`)
          .order("scheduled_at"),
        sb.from("call_routines").select("id,weekdays,local_time,focus,active"),
      ]);
      if (!vigente) return;
      setLlamadas({
        dia,
        lista: llamadasDelDia(
          (sesiones.data ?? []) as SesionDelDia[],
          (rutinas.data ?? []) as RutinaConId[],
          dia,
          hoy,
          zona,
        ),
      });
    })();
    return () => {
      vigente = false;
    };
  }, [dia, hoy, zona]);
  // Mientras llega la respuesta del día nuevo no se muestran las del anterior.
  return llamadas?.dia === dia ? llamadas.lista : [];
}

const ESTADO_LLAMADA: Record<LlamadaDelDia["estado"], { texto: string; clase: string } | null> = {
  programada: null,
  en_curso: { texto: "En curso", clase: "text-info" },
  hecha: { texto: "Hecha", clase: "text-ok" },
  perdida: { texto: "Perdida", clase: "text-peligro" },
};

/**
 * Lo que hay en un día de la semana que no es hoy (hoy tiene su propia vista):
 * las llamadas del Agente, los proyectos que vencen, las tareas que caen ese día
 * y lo que hiciste. En un día que viene se pueden cargar tareas para ese día.
 */
export function DetalleDia({ dia }: { dia: string }) {
  const { hoy, zona } = useDatos();
  const visibles = useTareasVisibles();
  const proyectos = useProyectosVisibles();
  const llamadas = useLlamadasDelDia(dia);

  const yaPaso = dia < hoy;
  const { pendientes, hechas } = tareasDelDia(visibles, dia, zona);
  pendientes.sort(porPrioridad).sort(porHoraDelDia(dia));
  const vencen = proyectos.filter((p) => p.due_date === dia);
  const largo = fechaLarga(dia);
  const corto = largo.replace(/ de .*$/, ""); // «viernes 27»
  const nada = !pendientes.length && !hechas.length && !vencen.length && !llamadas.length;

  return (
    <section aria-label={largo} className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="cifra text-[2rem]">{largo.replace(/^./, (c) => c.toUpperCase())}</h2>
        <p className="shrink-0 text-sm text-texto-3">{cuandoEs(dia, hoy)}</p>
      </div>

      {/* El día ya está en el título: así el texto entra entero en el campo del celular. */}
      {yaPaso ? null : <AltaRapida fechaFija={dia} marcador="Algo para ese día…" />}

      {llamadas.length || vencen.length ? (
        <ul aria-label="Agenda del día" className="rounded-xl bg-panel px-4">
          {llamadas.map((l) => {
            const estado = ESTADO_LLAMADA[l.estado];
            return (
              <li
                key={l.id ?? `rutina-${l.hora}`}
                className="flex min-h-[3.25rem] items-center gap-3 border-b-[1.5px] border-dotted border-borde-fuerte py-2 last:border-b-0"
              >
                <Phone size={16} aria-hidden className="shrink-0 text-acento-texto" />
                <span className="cifra text-[1.35rem]">{l.hora}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-texto-2">
                  Llamada del Agente{l.foco ? ` · ${l.foco}` : ""}
                </span>
                {estado ? <span className={`shrink-0 text-sm ${estado.clase}`}>{estado.texto}</span> : null}
              </li>
            );
          })}
          {vencen.map((p) => (
            <li
              key={p.id}
              className="flex min-h-[3.25rem] items-center gap-3 border-b-[1.5px] border-dotted border-borde-fuerte py-2 last:border-b-0"
            >
              <Flag size={16} aria-hidden className="shrink-0 text-acento-texto" />
              <span className="min-w-0 flex-1 truncate text-sm text-texto-2">
                Vence el proyecto{" "}
                <Link href={`/proyectos/${p.id}`} className="enlace">
                  {p.name}
                </Link>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <Seccion titulo={yaPaso ? "Quedaron sin hacer" : "Para ese día"} tono={yaPaso ? "peligro" : undefined} tareas={pendientes} />
      <Seccion titulo="Hechas ese día" tareas={hechas} />

      {nada ? (
        <Vacio titulo={yaPaso ? `Nada el ${corto}` : `Nada para el ${corto}`}>
          {yaPaso
            ? "Ese día no tenías tareas ni llamadas, y no marcaste nada como hecho."
            : "No hay tareas, llamadas ni proyectos que venzan ese día. Cargá una arriba."}
        </Vacio>
      ) : null}
    </section>
  );
}
