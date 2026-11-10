"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { hoyEnZona } from "./fechas";
import type { Area, Proyecto, Tarea } from "./tipos";

/**
 * Datos del panel en memoria. Se leen una vez de Supabase (con la sesión del
 * usuario; RLS decide qué vuelve) y cada cambio se aplica primero en pantalla y
 * después en la base. Si la base lo rechaza, se vuelve a leer todo: es más
 * simple y más seguro que deshacer a mano cada caso.
 */

const ZONA_POR_DEFECTO = "America/Montevideo";
const CLAVE_FILTRO = "miagente:filtro";
const COLUMNAS_AREA = "id,name,color,icon,sort_order";
const COLUMNAS_PROYECTO =
  "id,area_id,name,goal,description,status,priority,due_date,sort_order,created_at";
export const COLUMNAS_TAREA =
  "id,project_id,parent_id,title,description,status,priority,due_date,due_set_by," +
  "effort_minutes,blocked_reason,sort_order,completed_at,status_changed_at,archived_at,created_at";

export type Filtro = { areaId: string | null; proyectoId: string | null };
type Aviso = { id: number; texto: string; accion?: { nombre: string; hacer: () => void } };

export type NuevaTarea = Pick<Tarea, "project_id" | "title"> &
  Partial<Pick<Tarea, "parent_id" | "status" | "priority" | "due_date" | "sort_order">>;
export type CambiosTarea = Partial<
  Pick<
    Tarea,
    | "project_id" | "title" | "description" | "status" | "priority" | "due_date"
    | "effort_minutes" | "blocked_reason" | "sort_order"
  >
>;
export type NuevoProyecto = Pick<Proyecto, "name"> &
  Partial<Pick<Proyecto, "area_id" | "goal" | "priority" | "due_date">>;
export type CambiosProyecto = Partial<
  Pick<Proyecto, "area_id" | "name" | "goal" | "description" | "status" | "priority" | "due_date">
>;

type Datos = {
  estado: "cargando" | "error" | "listo";
  hoy: string;
  /** Zona horaria del perfil. */
  zona: string;
  /** null mientras no se sabe. */
  entrevistaHecha: boolean | null;
  areas: Area[];
  proyectos: Proyecto[];
  tareas: Tarea[];
  filtro: Filtro;
  cambiarFiltro: (f: Filtro) => void;
  recargar: () => Promise<void>;
  avisar: (texto: string, accion?: Aviso["accion"]) => void;

  crearArea: (nombre: string, color: string) => Promise<void>;
  editarArea: (id: string, cambios: Partial<Pick<Area, "name" | "color" | "icon">>) => Promise<void>;
  archivarArea: (id: string) => Promise<void>;

  crearProyecto: (datos: NuevoProyecto) => Promise<Proyecto>;
  editarProyecto: (id: string, cambios: CambiosProyecto) => Promise<void>;
  borrarProyecto: (id: string) => Promise<void>;

  crearTarea: (datos: NuevaTarea) => Promise<Tarea>;
  editarTarea: (id: string, cambios: CambiosTarea) => Promise<void>;
  archivarTarea: (id: string) => Promise<void>;
  restaurarTarea: (id: string) => Promise<void>;
  borrarTarea: (id: string) => Promise<void>;

  tareaAbierta: string | null;
  abrirTarea: (id: string | null) => void;
};

const Contexto = createContext<Datos | null>(null);

export function useDatos(): Datos {
  const datos = useContext(Contexto);
  if (!datos) throw new Error("useDatos se usa dentro de <ProveedorDatos>");
  return datos;
}

function leerFiltro(): Filtro {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_FILTRO) ?? "null");
    return { areaId: guardado?.areaId ?? null, proyectoId: guardado?.proyectoId ?? null };
  } catch {
    return { areaId: null, proyectoId: null };
  }
}

/** PostgREST devuelve como mucho 1000 filas por pedido: se leen de a páginas. */
async function leerTodasLasTareas(): Promise<Tarea[]> {
  const supabase = supabaseBrowser();
  const PAGINA = 1000;
  const todas: Tarea[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase
      .from("tasks")
      .select(COLUMNAS_TAREA)
      .is("archived_at", null)
      .order("created_at")
      .order("id")
      .range(desde, desde + PAGINA - 1);
    if (error) throw error;
    todas.push(...(data as Tarea[]));
    if (data.length < PAGINA) return todas;
  }
}

export function ProveedorDatos({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Datos["estado"]>("cargando");
  const [zona, setZona] = useState(ZONA_POR_DEFECTO);
  const [entrevistaHecha, setEntrevistaHecha] = useState<boolean | null>(null);
  const [ahora, setAhora] = useState(() => new Date());
  const [areas, setAreas] = useState<Area[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [filtro, setFiltro] = useState<Filtro>({ areaId: null, proyectoId: null });
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [tareaAbierta, abrirTarea] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    const supabase = supabaseBrowser();
    try {
      const [perfil, a, p, t] = await Promise.all([
        supabase.from("profiles").select("timezone,onboarding_done").maybeSingle(),
        supabase.from("areas").select(COLUMNAS_AREA).is("archived_at", null).order("sort_order"),
        supabase.from("projects").select(COLUMNAS_PROYECTO).order("sort_order"),
        leerTodasLasTareas(),
      ]);
      if (a.error || p.error) throw a.error ?? p.error;
      setZona(perfil.data?.timezone ?? ZONA_POR_DEFECTO);
      setEntrevistaHecha(perfil.data ? Boolean(perfil.data.onboarding_done) : null);
      setAreas(a.data as Area[]);
      setProyectos(p.data as Proyecto[]);
      setTareas(t);
      setEstado("listo");
    } catch {
      setEstado((actual) => (actual === "listo" ? "listo" : "error"));
    }
  }, []);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const guardado = leerFiltro();
      await recargar();
      if (vigente) setFiltro(guardado);
    })();
    // El día cambia a medianoche aunque la app quede abierta, y al volver a la
    // pestaña conviene refrescar la hora.
    const reloj = setInterval(() => setAhora(new Date()), 60_000);
    const alVolver = () => document.visibilityState === "visible" && setAhora(new Date());
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vigente = false;
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [recargar]);

  const hoy = useMemo(() => hoyEnZona(zona, ahora), [zona, ahora]);

  const avisar = useCallback((texto: string, accion?: Aviso["accion"]) => {
    const id = Date.now() + Math.random();
    setAvisos((lista) => [...lista.slice(-2), { id, texto, accion }]);
    setTimeout(() => setAvisos((lista) => lista.filter((x) => x.id !== id)), accion ? 7000 : 4000);
  }, []);

  /** Si la base rechaza un cambio, se avisa y se vuelve a leer la verdad. */
  const confirmar = useCallback(
    async (pedido: PromiseLike<{ error: unknown }>) => {
      const { error } = await pedido;
      if (error) {
        avisar("No se pudo guardar el cambio. Revisá la conexión.");
        await recargar();
      }
    },
    [avisar, recargar],
  );

  const cambiarFiltro = useCallback((f: Filtro) => {
    setFiltro(f);
    try {
      localStorage.setItem(CLAVE_FILTRO, JSON.stringify(f));
    } catch {
      // Sin almacenamiento (modo privado): el filtro dura lo que dure la pestaña.
    }
  }, []);

  // --- Áreas ---------------------------------------------------------------

  const crearArea = useCallback(
    async (nombre: string, color: string) => {
      const area: Area = {
        id: crypto.randomUUID(), name: nombre, color, icon: null, sort_order: Date.now() / 1000,
      };
      setAreas((l) => [...l, area]);
      await confirmar(supabaseBrowser().from("areas").insert(area));
    },
    [confirmar],
  );

  const editarArea = useCallback(
    async (id: string, cambios: Partial<Pick<Area, "name" | "color" | "icon">>) => {
      setAreas((l) => l.map((a) => (a.id === id ? { ...a, ...cambios } : a)));
      await confirmar(supabaseBrowser().from("areas").update(cambios).eq("id", id));
    },
    [confirmar],
  );

  const archivarArea = useCallback(
    async (id: string) => {
      setAreas((l) => l.filter((a) => a.id !== id));
      setFiltro((f) => (f.areaId === id ? { ...f, areaId: null } : f));
      await confirmar(
        supabaseBrowser().from("areas").update({ archived_at: new Date().toISOString() }).eq("id", id),
      );
    },
    [confirmar],
  );

  // --- Proyectos -----------------------------------------------------------

  const crearProyecto = useCallback(
    async (datos: NuevoProyecto) => {
      const proyecto: Proyecto = {
        id: crypto.randomUUID(),
        area_id: null,
        goal: null,
        description: null,
        status: "activo",
        priority: 2,
        due_date: null,
        sort_order: Date.now() / 1000,
        created_at: new Date().toISOString(),
        ...datos,
      };
      setProyectos((l) => [...l, proyecto]);
      const { created_at: _, ...fila } = proyecto;
      void _;
      await confirmar(supabaseBrowser().from("projects").insert(fila));
      return proyecto;
    },
    [confirmar],
  );

  const editarProyecto = useCallback(
    async (id: string, cambios: CambiosProyecto) => {
      setProyectos((l) => l.map((p) => (p.id === id ? { ...p, ...cambios } : p)));
      await confirmar(supabaseBrowser().from("projects").update(cambios).eq("id", id));
    },
    [confirmar],
  );

  const borrarProyecto = useCallback(
    async (id: string) => {
      setProyectos((l) => l.filter((p) => p.id !== id));
      setTareas((l) => l.filter((t) => t.project_id !== id));
      setFiltro((f) => (f.proyectoId === id ? { ...f, proyectoId: null } : f));
      await confirmar(supabaseBrowser().from("projects").delete().eq("id", id));
    },
    [confirmar],
  );

  // --- Tareas --------------------------------------------------------------

  const crearTarea = useCallback(
    async (datos: NuevaTarea) => {
      const instante = new Date().toISOString();
      const estadoInicial = datos.status ?? "pendiente";
      const tarea: Tarea = {
        id: crypto.randomUUID(),
        parent_id: null,
        description: null,
        priority: 2,
        due_date: null,
        effort_minutes: null,
        blocked_reason: null,
        // Las nuevas van al final: el tiempo siempre crece.
        sort_order: Date.now() / 1000,
        archived_at: null,
        created_at: instante,
        status_changed_at: instante,
        ...datos,
        status: estadoInicial,
        due_set_by: datos.due_date ? "usuario" : null,
        completed_at: estadoInicial === "hecha" ? instante : null,
      };
      setTareas((l) => [...l, tarea]);
      // Las fechas de control las pone la base (disparador y valores por defecto).
      const { created_at: _c, status_changed_at: _s, completed_at: _d, archived_at: _a, ...fila } = tarea;
      void [_c, _s, _d, _a];
      await confirmar(supabaseBrowser().from("tasks").insert(fila));
      return tarea;
    },
    [confirmar],
  );

  const editarTarea = useCallback(
    async (id: string, cambios: CambiosTarea) => {
      const fila: Partial<Tarea> = { ...cambios };
      if ("due_date" in cambios) fila.due_set_by = cambios.due_date ? "usuario" : null;
      const instante = new Date().toISOString();
      setTareas((l) =>
        l.map((t) => {
          // Las subtareas siguen al proyecto de su tarea.
          if (t.parent_id === id && cambios.project_id) return { ...t, project_id: cambios.project_id };
          if (t.id !== id) return t;
          const nueva = { ...t, ...fila };
          // Lo mismo que hace el disparador de la base, para verlo al instante.
          if (nueva.status !== t.status) {
            nueva.status_changed_at = instante;
            nueva.completed_at = nueva.status === "hecha" ? instante : null;
            if (nueva.status !== "bloqueada") nueva.blocked_reason = null;
          }
          return nueva;
        }),
      );
      const supabase = supabaseBrowser();
      await confirmar(supabase.from("tasks").update(fila).eq("id", id));
      if (cambios.project_id) {
        await confirmar(
          supabase.from("tasks").update({ project_id: cambios.project_id }).eq("parent_id", id),
        );
      }
    },
    [confirmar],
  );

  const restaurarTarea = useCallback(
    async (id: string) => {
      await confirmar(
        supabaseBrowser().from("tasks").update({ archived_at: null }).or(`id.eq.${id},parent_id.eq.${id}`),
      );
      await recargar();
    },
    [confirmar, recargar],
  );

  const archivarTarea = useCallback(
    async (id: string) => {
      setTareas((l) => l.filter((t) => t.id !== id && t.parent_id !== id));
      abrirTarea((abierta) => (abierta === id ? null : abierta));
      // Archivar una tarea se lleva sus subtareas.
      await confirmar(
        supabaseBrowser()
          .from("tasks")
          .update({ archived_at: new Date().toISOString() })
          .or(`id.eq.${id},parent_id.eq.${id}`),
      );
      avisar("Tarea archivada.", { nombre: "Deshacer", hacer: () => void restaurarTarea(id) });
    },
    [avisar, confirmar, restaurarTarea],
  );

  const borrarTarea = useCallback(
    async (id: string) => {
      setTareas((l) => l.filter((t) => t.id !== id && t.parent_id !== id));
      abrirTarea((abierta) => (abierta === id ? null : abierta));
      await confirmar(supabaseBrowser().from("tasks").delete().eq("id", id));
    },
    [confirmar],
  );

  const valor: Datos = {
    estado, hoy, zona, entrevistaHecha, areas, proyectos, tareas, filtro, cambiarFiltro, recargar, avisar,
    crearArea, editarArea, archivarArea,
    crearProyecto, editarProyecto, borrarProyecto,
    crearTarea, editarTarea, archivarTarea, restaurarTarea, borrarTarea,
    tareaAbierta, abrirTarea,
  };

  return (
    <Contexto.Provider value={valor}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {avisos.map((a) => (
          <div
            key={a.id}
            className="pointer-events-auto flex items-center gap-3 rounded-md border border-borde-fuerte bg-elevado px-3.5 py-2.5 text-sm shadow-lg shadow-black/40"
          >
            <span>{a.texto}</span>
            {a.accion ? (
              <button
                type="button"
                className="font-medium text-acento hover:text-acento-fuerte"
                onClick={() => {
                  a.accion?.hacer();
                  setAvisos((lista) => lista.filter((x) => x.id !== a.id));
                }}
              >
                {a.accion.nombre}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

// --- Selectores --------------------------------------------------------------

/**
 * Tareas que se muestran en Hoy, Tablero y Calendario: las de proyectos activos
 * que pasan el filtro de área y proyecto.
 */
export function useTareasVisibles(): Tarea[] {
  const { tareas, proyectos, areas, filtro } = useDatos();
  return useMemo(() => {
    const areasVivas = new Set(areas.map((a) => a.id));
    const permitidos = new Set(
      proyectos
        .filter((p) => p.status === "activo")
        .filter((p) => !filtro.proyectoId || p.id === filtro.proyectoId)
        .filter(
          (p) =>
            !filtro.areaId ||
            (filtro.areaId === "sin-area"
              ? !p.area_id || !areasVivas.has(p.area_id)
              : p.area_id === filtro.areaId),
        )
        .map((p) => p.id),
    );
    return tareas.filter((t) => permitidos.has(t.project_id));
  }, [tareas, proyectos, areas, filtro]);
}

/** Orden por defecto de las listas: prioridad, fecha límite, orden manual. */
export function porPrioridad(a: Tarea, b: Tarea): number {
  return (
    a.priority - b.priority ||
    (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
    a.sort_order - b.sort_order
  );
}
