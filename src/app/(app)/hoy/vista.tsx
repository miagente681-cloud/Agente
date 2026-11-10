"use client";

import Link from "next/link";
import { useState } from "react";
import { EstadoDatos, Filtro } from "@/components/filtro";
import { AltaRapida } from "@/components/tareas/alta-rapida";
import { ListaTareas } from "@/components/tareas/fila-tarea";
import { EncabezadoPagina, Vacio } from "@/components/ui/varios";
import { porPrioridad, useDatos, useTareasVisibles } from "@/lib/datos/almacen";
import { domingoDe, fechaEnZona, fechaLarga, sumarDias } from "@/lib/datos/fechas";
import type { Tarea } from "@/lib/datos/tipos";

type Rango = "hoy" | "semana";

function Seccion({ titulo, tono, tareas }: { titulo: string; tono?: "peligro"; tareas: Tarea[] }) {
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

export function VistaHoy() {
  const { estado, hoy, proyectos } = useDatos();
  const visibles = useTareasVisibles();
  const [rango, setRango] = useState<Rango>("hoy");

  const abiertas = visibles.filter((t) => t.status !== "hecha").sort(porPrioridad);
  const vencidas = abiertas.filter((t) => t.due_date && t.due_date < hoy);
  const deHoy = abiertas.filter((t) => t.due_date === hoy);
  // Lo que ya empezaste también es "lo que toca ahora", aunque no venza hoy.
  const enCurso = abiertas.filter((t) => t.status === "en_curso" && (!t.due_date || t.due_date > hoy));
  // completed_at es un instante; se compara con el día de hoy en la zona del
  // dispositivo, que para "lo que hice hoy" es lo que la persona espera.
  const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hechasHoy = visibles.filter(
    (t) => t.status === "hecha" && t.completed_at && fechaEnZona(t.completed_at, zona) === hoy,
  );

  const finSemana = domingoDe(hoy);
  const dias: string[] = [];
  for (let d = sumarDias(hoy, 1); d <= finSemana; d = sumarDias(d, 1)) dias.push(d);

  const nada =
    rango === "hoy"
      ? !vencidas.length && !deHoy.length && !enCurso.length && !hechasHoy.length
      : !vencidas.length && !abiertas.some((t) => t.due_date && t.due_date >= hoy && t.due_date <= finSemana);

  return (
    <>
      <EncabezadoPagina titulo="Hoy" descripcion={fechaLarga(hoy).replace(/^./, (c) => c.toUpperCase())} />
      {estado !== "listo" ? (
        <EstadoDatos />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Rango" className="flex rounded-md border border-borde bg-panel p-0.5">
              {(["hoy", "semana"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={rango === r}
                  onClick={() => setRango(r)}
                  className={`h-8 rounded-[5px] px-3 text-[13px] font-medium ${
                    rango === r ? "bg-elevado text-texto" : "text-texto-2 hover:text-texto"
                  }`}
                >
                  {r === "hoy" ? "Hoy" : "Esta semana"}
                </button>
              ))}
              {/* En el celular el Calendario no entra en la barra de abajo: se llega desde acá. */}
              <Link
                href="/calendario"
                className="flex h-8 items-center rounded-[5px] px-3 text-[13px] font-medium text-texto-2 hover:text-texto md:hidden"
              >
                Mes
              </Link>
            </div>
            <Filtro />
          </div>

          <AltaRapida fechaFija={hoy} marcador="Algo para hoy…" />

          <Seccion titulo="Vencidas" tono="peligro" tareas={vencidas} />
          <Seccion titulo="Hoy" tareas={deHoy} />
          {rango === "hoy" ? (
            <>
              <Seccion titulo="En curso" tareas={enCurso} />
              <Seccion titulo="Hechas hoy" tareas={hechasHoy} />
            </>
          ) : (
            dias.map((d) => (
              <Seccion
                key={d}
                titulo={fechaLarga(d)}
                tareas={abiertas.filter((t) => t.due_date === d)}
              />
            ))
          )}

          {nada ? (
            <Vacio titulo={rango === "hoy" ? "Nada para hoy" : "Nada con fecha esta semana"}>
              {proyectos.length
                ? "No hay tareas vencidas ni con fecha en este rango. Agregá una arriba o ponele fecha a alguna desde el Tablero."
                : "Empezá por crear un proyecto en la sección Proyectos; después cargá acá lo que quieras hacer hoy."}
            </Vacio>
          ) : null}
        </div>
      )}
    </>
  );
}
