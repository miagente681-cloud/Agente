"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EstadoDatos } from "@/components/filtro";
import { Boton } from "@/components/ui/boton";
import { AreaTexto, Campo, Entrada, Selector } from "@/components/ui/campo";
import { Dialogo } from "@/components/ui/dialogo";
import { EncabezadoPagina, Etiqueta, Vacio } from "@/components/ui/varios";
import { useDatos } from "@/lib/datos/almacen";
import { etiquetaFecha } from "@/lib/datos/fechas";
import { COLORES_AREA, ESTADOS_PROYECTO, PRIORIDADES, type Proyecto } from "@/lib/datos/tipos";

export function BarraProgreso({ hechas, total }: { hechas: number; total: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        role="progressbar"
        aria-label="Avance"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={hechas}
        className="h-1 flex-1 overflow-hidden rounded-full bg-borde"
      >
        <div
          className="h-full rounded-full bg-acento transition-[width]"
          style={{ width: total ? `${(hechas / total) * 100}%` : 0 }}
        />
      </div>
      <span className="font-mono text-xs text-texto-3">
        {hechas}/{total}
      </span>
    </div>
  );
}

function TarjetaProyecto({ proyecto }: { proyecto: Proyecto }) {
  const { tareas, hoy } = useDatos();
  const propias = tareas.filter((t) => t.project_id === proyecto.id && !t.parent_id);
  const hechas = propias.filter((t) => t.status === "hecha").length;
  const vencidas = propias.filter((t) => t.status !== "hecha" && t.due_date && t.due_date < hoy).length;
  const vencido = proyecto.status === "activo" && proyecto.due_date && proyecto.due_date < hoy;
  return (
    <li>
      <Link
        href={`/proyectos/${proyecto.id}`}
        className="flex h-full flex-col gap-2.5 rounded-lg border border-borde bg-panel p-4 hover:border-borde-fuerte"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="font-medium leading-snug">{proyecto.name}</span>
          {proyecto.status !== "activo" ? (
            <Etiqueta>{ESTADOS_PROYECTO.find((e) => e.valor === proyecto.status)?.nombre}</Etiqueta>
          ) : proyecto.priority === 1 ? (
            <Etiqueta tono="acento">Urgente</Etiqueta>
          ) : null}
        </span>
        {proyecto.goal ? <span className="line-clamp-2 text-sm text-texto-2">{proyecto.goal}</span> : null}
        <span className="mt-auto flex flex-col gap-2 pt-1">
          <BarraProgreso hechas={hechas} total={propias.length} />
          <span className="flex gap-3 text-xs text-texto-3">
            {proyecto.due_date ? (
              <span className={vencido ? "font-medium text-peligro" : ""}>
                {vencido ? "Venció " : "Para "}
                {etiquetaFecha(proyecto.due_date, hoy).toLowerCase()}
              </span>
            ) : null}
            {vencidas ? (
              <span className="text-peligro">
                {vencidas} {vencidas === 1 ? "tarea vencida" : "tareas vencidas"}
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

function NuevoProyecto({ alCerrar }: { alCerrar: () => void }) {
  const { areas, crearProyecto } = useDatos();
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [area, setArea] = useState("");
  const [prioridad, setPrioridad] = useState(2);
  const [fecha, setFecha] = useState("");

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    const proyecto = await crearProyecto({
      name: nombre.trim(),
      goal: objetivo.trim() || null,
      area_id: area || null,
      priority: prioridad,
      due_date: fecha || null,
    });
    alCerrar();
    router.push(`/proyectos/${proyecto.id}`);
  }

  return (
    <form onSubmit={crear} className="flex flex-col gap-4">
      <Campo etiqueta="Nombre" htmlFor="proyecto-nombre">
        <Entrada
          id="proyecto-nombre"
          required
          autoFocus
          maxLength={120}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Por ejemplo: Reformar el baño"
        />
      </Campo>
      <Campo
        etiqueta="Objetivo"
        htmlFor="proyecto-objetivo"
        ayuda="¿Cómo te das cuenta de que está terminado? Una frase alcanza."
      >
        <AreaTexto
          id="proyecto-objetivo"
          maxLength={500}
          value={objetivo}
          onChange={(e) => setObjetivo(e.target.value)}
          className="!min-h-16"
        />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Área" htmlFor="proyecto-area">
          <Selector id="proyecto-area" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Sin área</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Prioridad" htmlFor="proyecto-prioridad">
          <Selector
            id="proyecto-prioridad"
            value={prioridad}
            onChange={(e) => setPrioridad(Number(e.target.value))}
          >
            {PRIORIDADES.map((p) => (
              <option key={p.valor} value={p.valor}>
                P{p.valor} · {p.nombre}
              </option>
            ))}
          </Selector>
        </Campo>
      </div>
      <Campo etiqueta="Fecha objetivo (opcional)" htmlFor="proyecto-fecha">
        <Entrada id="proyecto-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Campo>
      <div className="flex justify-end gap-2">
        <Boton variante="fantasma" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" variante="primario" disabled={!nombre.trim()}>
          Crear proyecto
        </Boton>
      </div>
    </form>
  );
}

function GestionAreas() {
  const { areas, proyectos, crearArea, editarArea, archivarArea } = useDatos();
  const [nueva, setNueva] = useState("");

  function agregar(e: FormEvent) {
    e.preventDefault();
    if (!nueva.trim()) return;
    // Cada área nueva toma el siguiente color de la paleta.
    void crearArea(nueva.trim().slice(0, 60), COLORES_AREA[(areas.length + 1) % COLORES_AREA.length]);
    setNueva("");
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-texto-2">
        Las áreas agrupan proyectos por parte de tu vida: Casa, Trabajo, Salud, Plata.
      </p>
      {areas.length ? (
        <ul className="flex flex-col gap-2">
          {areas.map((a) => {
            const cantidad = proyectos.filter((p) => p.area_id === a.id).length;
            return (
              <li key={a.id} className="flex items-center gap-2">
                <label className="relative h-6 w-6 shrink-0 cursor-pointer rounded-full" style={{ background: a.color }}>
                  <span className="sr-only">Color de {a.name}</span>
                  <select
                    value={a.color}
                    onChange={(e) => void editarArea(a.id, { color: e.target.value })}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  >
                    {COLORES_AREA.map((c, i) => (
                      <option key={c} value={c}>
                        Color {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor={`area-${a.id}`} className="sr-only">
                  Nombre del área
                </label>
                <Entrada
                  id={`area-${a.id}`}
                  defaultValue={a.name}
                  maxLength={60}
                  onBlur={(e) => {
                    const nombre = e.target.value.trim();
                    if (nombre && nombre !== a.name) void editarArea(a.id, { name: nombre });
                    else e.target.value = a.name;
                  }}
                  className="!h-9"
                />
                <span className="w-20 shrink-0 text-right text-xs text-texto-3">
                  {cantidad} {cantidad === 1 ? "proyecto" : "proyectos"}
                </span>
                <button
                  type="button"
                  aria-label={`Archivar el área ${a.name}`}
                  title="Archivar (los proyectos quedan sin área)"
                  onClick={() => void archivarArea(a.id)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-texto-3 hover:bg-elevado hover:text-texto"
                >
                  <Archive size={15} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <form onSubmit={agregar} className="flex gap-2">
        <label htmlFor="area-nueva" className="sr-only">
          Nueva área
        </label>
        <Entrada
          id="area-nueva"
          value={nueva}
          maxLength={60}
          placeholder="Nueva área…"
          onChange={(e) => setNueva(e.target.value)}
        />
        <Boton type="submit" disabled={!nueva.trim()}>
          Agregar
        </Boton>
      </form>
    </div>
  );
}

export function ListaProyectos() {
  const { estado, areas, proyectos } = useDatos();
  const [dialogo, setDialogo] = useState<"proyecto" | "areas" | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const mostrados = proyectos
    .filter((p) => verTodos || p.status === "activo")
    .sort((a, b) => a.priority - b.priority || a.sort_order - b.sort_order);
  const ocultos = proyectos.length - proyectos.filter((p) => p.status === "activo").length;
  const grupos = [
    ...areas.map((a) => ({ id: a.id, nombre: a.name, color: a.color as string | null })),
    { id: null as string | null, nombre: "Sin área", color: null as string | null },
  ]
    .map((g) => ({
      ...g,
      proyectos: mostrados.filter((p) =>
        g.id ? p.area_id === g.id : !areas.some((a) => a.id === p.area_id),
      ),
    }))
    .filter((g) => g.proyectos.length);

  return (
    <>
      <EncabezadoPagina
        titulo="Proyectos"
        descripcion="Cada proyecto con su objetivo, sus tareas y su bitácora."
        acciones={
          estado === "listo" ? (
            <div className="flex shrink-0 gap-2">
              <Boton className="hidden sm:inline-flex" onClick={() => setDialogo("areas")}>
                Áreas
              </Boton>
              <Boton variante="primario" onClick={() => setDialogo("proyecto")}>
                <Plus size={16} aria-hidden />
                Nuevo
              </Boton>
            </div>
          ) : null
        }
      />
      {estado !== "listo" ? (
        <EstadoDatos />
      ) : (
        <div className="flex flex-col gap-6">
          {!proyectos.length ? (
            <Vacio
              titulo="Todavía no hay proyectos"
              accion={
                <Boton variante="primario" onClick={() => setDialogo("proyecto")}>
                  Crear el primero
                </Boton>
              }
            >
              Un proyecto es algo que querés lograr y que lleva más de un paso: reformar el baño,
              cambiar de trabajo, correr 10 km. Adentro van las tareas.
            </Vacio>
          ) : !grupos.length ? (
            <p className="text-sm text-texto-2">No hay proyectos activos.</p>
          ) : null}

          {grupos.map((g) => (
            <section key={g.id ?? "sin-area"} className="flex flex-col gap-2.5">
              {/* Con un solo grupo "Sin área" el rótulo no aporta nada. */}
              {areas.length ? (
                <h2 className="rotulo flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ background: g.color ?? "var(--color-borde-fuerte)" }}
                  />
                  {g.nombre}
                </h2>
              ) : null}
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.proyectos.map((p) => (
                  <TarjetaProyecto key={p.id} proyecto={p} />
                ))}
              </ul>
            </section>
          ))}

          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
            {ocultos ? (
              <button
                type="button"
                onClick={() => setVerTodos((v) => !v)}
                className="rounded-sm text-texto-2 hover:text-texto"
              >
                {verTodos
                  ? "Ver solo los activos"
                  : `Ver también pausados, completados y archivados (${ocultos})`}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setDialogo("areas")}
              className="rounded-sm text-texto-2 hover:text-texto sm:hidden"
            >
              Administrar áreas
            </button>
          </div>
        </div>
      )}

      <Dialogo abierto={dialogo === "proyecto"} alCerrar={() => setDialogo(null)} titulo="Nuevo proyecto">
        <NuevoProyecto alCerrar={() => setDialogo(null)} />
      </Dialogo>
      <Dialogo abierto={dialogo === "areas"} alCerrar={() => setDialogo(null)} titulo="Áreas">
        <GestionAreas />
      </Dialogo>
    </>
  );
}
