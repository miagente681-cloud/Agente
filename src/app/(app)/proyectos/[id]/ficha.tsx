"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EstadoDatos } from "@/components/filtro";
import { AltaRapida } from "@/components/tareas/alta-rapida";
import { FilaTarea } from "@/components/tareas/fila-tarea";
import { Boton } from "@/components/ui/boton";
import { AreaTexto, Campo, Entrada, Selector } from "@/components/ui/campo";
import { Etiqueta, Tarjeta, Vacio } from "@/components/ui/varios";
import { COLUMNAS_TAREA, porPrioridad, useDatos } from "@/lib/datos/almacen";
import { etiquetaFecha, fechaEnZona } from "@/lib/datos/fechas";
import {
  ESTADOS_PROYECTO,
  PRIORIDADES,
  TIPOS_BITACORA,
  type EntradaBitacora,
  type EstadoProyecto,
  type EstadoTarea,
  type Proyecto,
  type Tarea,
  type TipoBitacora,
} from "@/lib/datos/tipos";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BarraProgreso } from "../lista";

const GRUPOS: { estado: EstadoTarea; nombre: string }[] = [
  { estado: "en_curso", nombre: "En curso" },
  { estado: "pendiente", nombre: "Pendientes" },
  { estado: "bloqueada", nombre: "Bloqueadas" },
];

export function FichaProyecto({ id }: { id: string }) {
  const { estado, proyectos } = useDatos();
  const proyecto = proyectos.find((p) => p.id === id);

  if (estado !== "listo") return <EstadoDatos />;
  if (!proyecto) {
    return (
      <Vacio
        titulo="Este proyecto no existe"
        accion={
          <Link href="/proyectos" className="font-medium text-acento hover:text-acento-fuerte">
            Volver a Proyectos
          </Link>
        }
      >
        Puede que lo hayas borrado, o que el enlace esté mal.
      </Vacio>
    );
  }
  // La clave reinicia los campos de texto si se navega de un proyecto a otro.
  return <Ficha key={proyecto.id} proyecto={proyecto} />;
}

function Ficha({ proyecto }: { proyecto: Proyecto }) {
  const { areas, tareas, editarProyecto } = useDatos();
  const [nombre, setNombre] = useState(proyecto.name);
  const [objetivo, setObjetivo] = useState(proyecto.goal ?? "");
  const [descripcion, setDescripcion] = useState(proyecto.description ?? "");

  const propias = tareas.filter((t) => t.project_id === proyecto.id);
  const principales = propias.filter((t) => !t.parent_id);
  const hechas = principales.filter((t) => t.status === "hecha");
  const subtareasDe = (t: Tarea) =>
    propias.filter((h) => h.parent_id === t.id).sort((a, b) => a.sort_order - b.sort_order);

  const guardarTexto = (campo: "name" | "goal" | "description", valor: string) => {
    const limpio = valor.trim();
    if (campo === "name") {
      if (!limpio) return setNombre(proyecto.name);
      if (limpio !== proyecto.name) void editarProyecto(proyecto.id, { name: limpio });
    } else if ((limpio || null) !== proyecto[campo]) {
      void editarProyecto(proyecto.id, { [campo]: limpio || null });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/proyectos"
          className="-ml-1 flex items-center gap-1 self-start rounded-sm text-[13px] text-texto-2 hover:text-texto"
        >
          <ChevronLeft size={14} aria-hidden />
          Proyectos
        </Link>
        <label htmlFor="ficha-nombre" className="sr-only">
          Nombre del proyecto
        </label>
        <input
          id="ficha-nombre"
          value={nombre}
          maxLength={120}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={() => guardarTexto("name", nombre)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="titulo-pagina -mx-2 rounded-md border border-transparent bg-transparent px-2 py-1 hover:border-borde focus:border-acento focus:outline-none"
        />
        <BarraProgreso hechas={hechas.length} total={principales.length} />
      </header>

      <Tarjeta>
        <div className="flex flex-col gap-4">
          <Campo
            etiqueta="Objetivo"
            htmlFor="ficha-objetivo"
            ayuda="¿Cómo te das cuenta de que está terminado?"
          >
            <AreaTexto
              id="ficha-objetivo"
              value={objetivo}
              maxLength={500}
              onChange={(e) => setObjetivo(e.target.value)}
              onBlur={() => guardarTexto("goal", objetivo)}
              className="!min-h-16"
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Campo etiqueta="Estado" htmlFor="ficha-estado">
              <Selector
                id="ficha-estado"
                value={proyecto.status}
                onChange={(e) =>
                  void editarProyecto(proyecto.id, { status: e.target.value as EstadoProyecto })
                }
              >
                {ESTADOS_PROYECTO.map((e) => (
                  <option key={e.valor} value={e.valor}>
                    {e.nombre}
                  </option>
                ))}
              </Selector>
            </Campo>
            <Campo etiqueta="Área" htmlFor="ficha-area">
              <Selector
                id="ficha-area"
                value={areas.some((a) => a.id === proyecto.area_id) ? (proyecto.area_id ?? "") : ""}
                onChange={(e) => void editarProyecto(proyecto.id, { area_id: e.target.value || null })}
              >
                <option value="">Sin área</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Selector>
            </Campo>
            <Campo etiqueta="Prioridad" htmlFor="ficha-prioridad">
              <Selector
                id="ficha-prioridad"
                value={proyecto.priority}
                onChange={(e) => void editarProyecto(proyecto.id, { priority: Number(e.target.value) })}
              >
                {PRIORIDADES.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    P{p.valor} · {p.nombre}
                  </option>
                ))}
              </Selector>
            </Campo>
            <Campo etiqueta="Fecha objetivo" htmlFor="ficha-fecha">
              <Entrada
                id="ficha-fecha"
                type="date"
                value={proyecto.due_date ?? ""}
                onChange={(e) => void editarProyecto(proyecto.id, { due_date: e.target.value || null })}
              />
            </Campo>
          </div>
          <Campo etiqueta="Descripción y contexto" htmlFor="ficha-descripcion">
            <AreaTexto
              id="ficha-descripcion"
              value={descripcion}
              maxLength={5000}
              onChange={(e) => setDescripcion(e.target.value)}
              onBlur={() => guardarTexto("description", descripcion)}
            />
          </Campo>
          {proyecto.status !== "activo" ? (
            <p className="text-[13px] text-texto-3">
              Mientras el proyecto no esté activo, sus tareas no aparecen en Hoy, Tablero ni Calendario.
            </p>
          ) : null}
        </div>
      </Tarjeta>

      <section className="flex flex-col gap-4">
        <h2 className="rotulo">Tareas</h2>
        <AltaRapida proyectoFijo={proyecto.id} />
        {!principales.length ? (
          <p className="text-sm text-texto-3">
            Todavía no hay tareas. Escribí arriba el primer paso, por chico que sea.
          </p>
        ) : null}
        {GRUPOS.map(({ estado, nombre }) => {
          const lista = principales.filter((t) => t.status === estado).sort(porPrioridad);
          if (!lista.length) return null;
          return (
            <div key={estado} className="flex flex-col gap-2">
              <h3 className="text-[13px] font-medium text-texto-2">
                {nombre} <span className="font-normal text-texto-3">· {lista.length}</span>
              </h3>
              <ul className="rounded-lg border border-borde bg-panel px-3.5">
                {lista.map((t) => (
                  <GrupoTarea key={t.id} tarea={t} subtareas={subtareasDe(t)} />
                ))}
              </ul>
            </div>
          );
        })}
        {hechas.length ? (
          <details className="group">
            <summary className="cursor-pointer rounded-sm text-[13px] font-medium text-texto-2 hover:text-texto">
              Hechas <span className="font-normal text-texto-3">· {hechas.length}</span>
            </summary>
            <ul className="mt-2 rounded-lg border border-borde bg-panel px-3.5">
              {hechas
                .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
                .map((t) => (
                  <GrupoTarea key={t.id} tarea={t} subtareas={subtareasDe(t)} />
                ))}
            </ul>
          </details>
        ) : null}
        <Archivadas proyectoId={proyecto.id} />
      </section>

      <Bitacora proyectoId={proyecto.id} />
      <ZonaPeligro proyecto={proyecto} />
    </div>
  );
}

function GrupoTarea({ tarea, subtareas }: { tarea: Tarea; subtareas: Tarea[] }) {
  return (
    <>
      <FilaTarea tarea={tarea} mostrarProyecto={false} />
      {subtareas.map((s) => (
        <FilaTarea key={s.id} tarea={s} mostrarProyecto={false} sangria />
      ))}
    </>
  );
}

/** Tareas archivadas: se leen recién cuando se abre la sección. */
function Archivadas({ proyectoId }: { proyectoId: string }) {
  const { restaurarTarea, avisar } = useDatos();
  const [lista, setLista] = useState<Tarea[] | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("tasks")
      .select(COLUMNAS_TAREA)
      .eq("project_id", proyectoId)
      .is("parent_id", null)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false });
    setLista((data as Tarea[] | null) ?? []);
  }, [proyectoId]);

  async function borrar(id: string) {
    setLista((l) => l?.filter((t) => t.id !== id) ?? null);
    const { error } = await supabaseBrowser().from("tasks").delete().eq("id", id);
    if (error) avisar("No se pudo borrar.");
  }

  return (
    <details onToggle={(e) => e.currentTarget.open && void cargar()}>
      <summary className="cursor-pointer rounded-sm text-[13px] text-texto-3 hover:text-texto">
        Archivadas
      </summary>
      {lista === null ? (
        <p className="mt-2 text-sm text-texto-3">Cargando…</p>
      ) : !lista.length ? (
        <p className="mt-2 text-sm text-texto-3">No hay tareas archivadas en este proyecto.</p>
      ) : (
        <ul className="mt-2 rounded-lg border border-borde bg-panel px-3.5">
          {lista.map((t) => (
            <li key={t.id} className="flex items-center gap-2 border-b border-borde py-2 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-sm text-texto-2">{t.title}</span>
              <Boton
                tamano="sm"
                variante="fantasma"
                onClick={async () => {
                  setLista((l) => l?.filter((x) => x.id !== t.id) ?? null);
                  await restaurarTarea(t.id);
                }}
              >
                Restaurar
              </Boton>
              <Boton tamano="sm" variante="fantasma" onClick={() => void borrar(t.id)}>
                Borrar
              </Boton>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function Bitacora({ proyectoId }: { proyectoId: string }) {
  const { hoy, avisar } = useDatos();
  const [entradas, setEntradas] = useState<EntradaBitacora[] | null>(null);
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState<TipoBitacora>("nota");
  const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    let vigente = true;
    (async () => {
      const { data } = await supabaseBrowser()
        .from("project_log")
        .select("id,project_id,kind,author,content,created_at")
        .eq("project_id", proyectoId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (vigente) setEntradas((data as EntradaBitacora[] | null) ?? []);
    })();
    return () => {
      vigente = false;
    };
  }, [proyectoId]);

  async function agregar(e: FormEvent) {
    e.preventDefault();
    const contenido = texto.trim();
    if (!contenido) return;
    const entrada: EntradaBitacora = {
      id: crypto.randomUUID(),
      project_id: proyectoId,
      kind: tipo,
      author: "usuario",
      content: contenido,
      created_at: new Date().toISOString(),
    };
    setEntradas((l) => [entrada, ...(l ?? [])]);
    setTexto("");
    const { created_at: _, ...fila } = entrada;
    void _;
    const { error } = await supabaseBrowser().from("project_log").insert(fila);
    if (error) {
      setEntradas((l) => l?.filter((x) => x.id !== entrada.id) ?? null);
      setTexto(contenido);
      avisar("No se pudo guardar la nota.");
    }
  }

  async function borrar(id: string) {
    const antes = entradas;
    setEntradas((l) => l?.filter((x) => x.id !== id) ?? null);
    const { error } = await supabaseBrowser().from("project_log").delete().eq("id", id);
    if (error) {
      setEntradas(antes);
      avisar("No se pudo borrar la nota.");
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="rotulo">Bitácora</h2>
      <form onSubmit={agregar} className="flex flex-col gap-2">
        <label htmlFor="bitacora-texto" className="sr-only">
          Nueva entrada de bitácora
        </label>
        <AreaTexto
          id="bitacora-texto"
          value={texto}
          maxLength={5000}
          placeholder="Anotá un avance, una decisión o algo que no quieras olvidar…"
          onChange={(e) => setTexto(e.target.value)}
          className="!min-h-16"
        />
        <div className="flex items-center justify-end gap-2">
          <label htmlFor="bitacora-tipo" className="sr-only">
            Tipo de entrada
          </label>
          <Selector
            id="bitacora-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoBitacora)}
            className="!h-8 !w-auto !text-[13px]"
          >
            {/* Los resúmenes de llamada los escribe el Agente. */}
            {TIPOS_BITACORA.filter((t) => t.valor !== "resumen_llamada").map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.nombre}
              </option>
            ))}
          </Selector>
          <Boton type="submit" tamano="sm" disabled={!texto.trim()}>
            Anotar
          </Boton>
        </div>
      </form>
      {entradas === null ? (
        <p className="text-sm text-texto-3">Cargando la bitácora…</p>
      ) : !entradas.length ? (
        <p className="text-sm text-texto-3">
          Todavía no hay nada anotado. Acá también van a quedar los resúmenes de las llamadas con el Agente.
        </p>
      ) : (
        <ol className="flex flex-col">
          {entradas.map((e) => (
            <li key={e.id} className="group flex flex-col gap-1 border-l border-borde py-2 pl-4">
              <span className="flex items-center gap-2 text-xs text-texto-3">
                <Etiqueta tono={e.kind === "decision" ? "acento" : e.kind === "avance" ? "ok" : "neutro"}>
                  {TIPOS_BITACORA.find((t) => t.valor === e.kind)?.nombre}
                </Etiqueta>
                {etiquetaFecha(fechaEnZona(e.created_at, zona), hoy)}
                {e.author === "agente" ? <span>· Agente</span> : null}
                <button
                  type="button"
                  aria-label="Borrar esta entrada"
                  onClick={() => void borrar(e.id)}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-texto-3 hover:bg-elevado hover:text-texto"
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </span>
              <p className="whitespace-pre-wrap text-sm text-texto">{e.content}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ZonaPeligro({ proyecto }: { proyecto: Proyecto }) {
  const { borrarProyecto } = useDatos();
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  return (
    <section className="flex flex-wrap items-center gap-3 border-t border-borde pt-5">
      {confirmando ? (
        <>
          <p className="text-sm text-texto-2">
            Se borran el proyecto, sus tareas y su bitácora. No se puede deshacer.
          </p>
          <Boton
            variante="peligro"
            tamano="sm"
            onClick={async () => {
              await borrarProyecto(proyecto.id);
              router.replace("/proyectos");
            }}
          >
            Sí, borrar todo
          </Boton>
          <Boton variante="fantasma" tamano="sm" onClick={() => setConfirmando(false)}>
            Cancelar
          </Boton>
        </>
      ) : (
        <>
          <Boton variante="fantasma" tamano="sm" onClick={() => setConfirmando(true)}>
            <Trash2 size={14} aria-hidden />
            Borrar proyecto
          </Boton>
          <p className="text-[13px] text-texto-3">
            Para guardarlo sin verlo, cambiá el estado a Archivado.
          </p>
        </>
      )}
    </section>
  );
}
