"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EstadoLlamadas } from "@/components/estado-llamadas";
import { EstadoDatos, Filtro } from "@/components/filtro";
import { AltaRapida } from "@/components/tareas/alta-rapida";
import { ListaTareas } from "@/components/tareas/fila-tarea";
import { EncabezadoPagina, Vacio } from "@/components/ui/varios";
import { porHoraDelDia, porPrioridad, useDatos, useTareasVisibles } from "@/lib/datos/almacen";
import { domingoDe, fechaEnZona, fechaLarga, lunesDe, sumarDias } from "@/lib/datos/fechas";
import type { Tarea } from "@/lib/datos/tipos";
import { ProximaLlamada } from "./proxima-llamada";

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

const LETRAS = ["L", "M", "M", "J", "V", "S", "D"];

/** La semana en una tira: hoy resaltado, y un punto en los días que tienen tareas sin hacer. */
function TiraSemana({ hoy, conTareas }: { hoy: string; conTareas: Set<string> }) {
  const lunes = lunesDe(hoy);
  return (
    <ol aria-label="Esta semana" className="grid h-full grid-cols-7 content-center justify-items-center rounded-xl bg-panel px-2 pb-2 pt-2.5">
      {LETRAS.map((letra, i) => {
        const dia = sumarDias(lunes, i);
        const esHoy = dia === hoy;
        return (
          <li key={dia} aria-current={esHoy ? "date" : undefined} className="flex flex-col items-center gap-1">
            <span aria-hidden className={`text-[11px] font-semibold ${esHoy ? "text-texto" : "text-texto-3"}`}>
              {letra}
            </span>
            <span
              className={`cifra flex h-9 w-9 items-center justify-center rounded-full text-[1.35rem] ${
                esHoy ? "bg-acento text-sobre-acento" : "text-texto-2"
              }`}
            >
              <span className="sr-only">{fechaLarga(dia)}</span>
              <span aria-hidden>{Number(dia.slice(8))}</span>
            </span>
            <span className={`h-1 w-1 rounded-full ${conTareas.has(dia) ? "bg-acento-texto" : ""}`}>
              {conTareas.has(dia) ? <span className="sr-only">con tareas</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function VistaHoy() {
  const { estado, hoy, zona, proyectos, entrevistaHecha } = useDatos();
  const router = useRouter();

  // Cuenta nueva y vacía: se empieza por la bienvenida.
  const esNueva = estado === "listo" && entrevistaHecha === false && proyectos.length === 0;
  useEffect(() => {
    if (esNueva) router.replace("/bienvenida");
  }, [esNueva, router]);

  const visibles = useTareasVisibles();
  const [rango, setRango] = useState<Rango>("hoy");

  const abiertas = visibles.filter((t) => t.status !== "hecha").sort(porPrioridad);
  const vencidas = abiertas.filter((t) => t.due_date && t.due_date < hoy);
  const yaListadas = new Set(vencidas.map((t) => t.id));
  // Lo de hoy: lo que vence hoy y lo que planificaste hacer hoy (o un día que
  // ya pasó, si no lo hiciste). Lo que tiene hora va primero, por hora.
  const deHoy = abiertas
    .filter((t) => !yaListadas.has(t.id) && (t.due_date === hoy || (t.plan_fecha !== null && t.plan_fecha <= hoy)))
    .sort(porHoraDelDia(hoy));
  for (const t of deHoy) yaListadas.add(t.id);
  // Lo que ya empezaste también es "lo que toca ahora", aunque no venza hoy.
  const enCurso = abiertas.filter((t) => t.status === "en_curso" && !yaListadas.has(t.id));
  const finSemana = domingoDe(hoy);
  // En la semana, cada tarea aparece una sola vez: el día que la planificaste
  // si cae en la semana; si no, el de su fecha límite.
  const diaEnSemana = (t: Tarea) =>
    t.plan_fecha && t.plan_fecha > hoy && t.plan_fecha <= finSemana ? t.plan_fecha : t.due_date;
  const delDia = (d: string) =>
    abiertas.filter((t) => !yaListadas.has(t.id) && diaEnSemana(t) === d).sort(porHoraDelDia(d));
  // completed_at es un instante: se lleva a la misma zona con la que se calcula
  // «hoy» (la del perfil). Con otra, cerca de la medianoche lo recién hecho no aparecía.
  const hechasHoy = visibles.filter(
    (t) => t.status === "hecha" && t.completed_at && fechaEnZona(t.completed_at, zona) === hoy,
  );

  const dias: string[] = [];
  for (let d = sumarDias(hoy, 1); d <= finSemana; d = sumarDias(d, 1)) dias.push(d);

  // Días de esta semana con algo sin hacer, para marcarlos en la tira.
  const conTareas = new Set(
    abiertas.flatMap((t) => {
      const dia = t.plan_fecha ?? t.due_date;
      return dia ? [dia] : [];
    }),
  );

  const nada =
    rango === "hoy"
      ? !vencidas.length && !deHoy.length && !enCurso.length && !hechasHoy.length
      : !vencidas.length && !deHoy.length && !dias.some((d) => delDia(d).length);

  return (
    <>
      <EncabezadoPagina titulo="Hoy" descripcion={fechaLarga(hoy).replace(/^./, (c) => c.toUpperCase())} />
      {estado !== "listo" ? (
        <EstadoDatos />
      ) : (
        <div className="flex flex-col gap-5">
          <EstadoLlamadas />
          <div className="flex flex-col gap-2.5 md:flex-row md:items-stretch">
            <div className="md:w-[26rem] md:shrink-0">
              <TiraSemana hoy={hoy} conTareas={conTareas} />
            </div>
            <ProximaLlamada />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Rango" className="flex rounded-full bg-panel p-1">
              {(["hoy", "semana"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={rango === r}
                  onClick={() => setRango(r)}
                  className={`h-9 rounded-full px-3.5 text-[13px] font-medium ${
                    rango === r ? "bg-acento text-sobre-acento" : "text-texto-2 hover:text-texto"
                  }`}
                >
                  {r === "hoy" ? "Hoy" : "Esta semana"}
                </button>
              ))}
              {/* En el celular el Calendario no entra en la barra de abajo: se llega desde acá. */}
              <Link
                href="/calendario"
                className="flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium text-texto-2 hover:text-texto md:hidden"
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
                tareas={delDia(d)}
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
