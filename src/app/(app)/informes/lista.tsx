"use client";

import Link from "next/link";
import { ChartColumn, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EncabezadoPagina, Vacio } from "@/components/ui/varios";
import { useDatos } from "@/lib/datos/almacen";
import { periodoLegible } from "@/lib/informes/texto";
import { supabaseBrowser } from "@/lib/supabase/client";

type Fila = { id: string; titulo: string; desde: string; hasta: string; created_at: string };

const EJEMPLOS = [
  "Armame un informe de mis tareas hechas este mes",
  "¿Cómo vengo de puntualidad por proyecto en los últimos tres meses?",
  "Haceme un gráfico de tareas hechas y creadas por semana",
];

function Ejemplos() {
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {EJEMPLOS.map((e) => (
        <li key={e} className="text-sm text-texto-2">
          «{e}»
        </li>
      ))}
    </ul>
  );
}

/** Los informes guardados, del más nuevo al más viejo. */
export function ListaInformes() {
  const { avisar } = useDatos();
  const [informes, setInformes] = useState<Fila[] | null>(null);
  const [porBorrar, setPorBorrar] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const { data } = await supabaseBrowser()
        .from("informes")
        .select("id,titulo,desde,hasta,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (vigente) setInformes((data as Fila[] | null) ?? []);
    })();
    return () => {
      vigente = false;
    };
  }, []);

  async function borrar(id: string) {
    const { error } = await supabaseBrowser().from("informes").delete().eq("id", id);
    if (error) return avisar("No se pudo borrar. Probá de nuevo.");
    setInformes((l) => (l ?? []).filter((x) => x.id !== id));
    setPorBorrar(null);
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Informes"
        descripcion="Mediciones, gráficos y listas de tus tareas. Se los pedís al Agente y quedan acá."
        acciones={
          <Link
            href="/chat"
            className="inline-flex h-10 shrink-0 items-center rounded-md bg-acento px-4 text-sm font-medium text-sobre-acento hover:bg-acento-fuerte"
          >
            Pedir uno
          </Link>
        }
      />
      {informes === null ? (
        <p className="text-sm text-texto-3">Cargando…</p>
      ) : !informes.length ? (
        <>
          <Vacio titulo="Todavía no hay informes">
            Pedíselos al Agente, por chat o por voz, con tus palabras. Los números los calcula la app; el Agente los arma y te
            los comenta.
          </Vacio>
          <div className="mt-6 text-[13px] text-texto-3">
            Por ejemplo:
            <Ejemplos />
          </div>
        </>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {informes.map((f) => (
              <li key={f.id} className="flex items-center gap-1 rounded-lg border border-borde bg-panel pr-2 hover:border-borde-fuerte">
                <Link href={`/informes/${f.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-3">
                  <ChartColumn size={18} aria-hidden className="shrink-0 text-texto-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{f.titulo}</span>
                    <span className="block truncate text-[13px] text-texto-3">
                      {periodoLegible(f.desde, f.hasta)} · armado el{" "}
                      {new Date(f.created_at).toLocaleDateString("es-UY", { day: "numeric", month: "short" })}
                    </span>
                  </span>
                </Link>
                {porBorrar === f.id ? (
                  <span className="flex shrink-0 items-center gap-1 text-[13px]">
                    <button type="button" onClick={() => void borrar(f.id)} className="h-9 rounded-md px-2 font-medium text-peligro hover:bg-peligro-suave">
                      Borrar
                    </button>
                    <button type="button" onClick={() => setPorBorrar(null)} className="h-9 rounded-md px-2 text-texto-2 hover:bg-elevado">
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Borrar el informe ${f.titulo}`}
                    onClick={() => setPorBorrar(f.id)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-texto-3 hover:bg-elevado hover:text-texto"
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-6 text-[13px] text-texto-3">
            Para armar otro, pedíselo al Agente. Por ejemplo:
            <Ejemplos />
          </div>
        </>
      )}
    </>
  );
}
