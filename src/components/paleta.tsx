"use client";

import { useRouter } from "next/navigation";
import { CornerDownLeft, FolderKanban, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as TeclaReact } from "react";
import { Dialogo } from "@/components/ui/dialogo";
import { SECCIONES } from "@/components/navegacion";
import { useDatos } from "@/lib/datos/almacen";
import { etiquetaFecha } from "@/lib/datos/fechas";
import { parsearTarea } from "@/lib/datos/parsear-tarea";

/**
 * Paleta de comandos y atajos de teclado (escritorio).
 *   Ctrl/⌘ K o /  abre la paleta        n      tarea nueva desde cualquier pantalla
 *   g y una letra va a una sección      ?      muestra los atajos
 */
const IR_A: Record<string, string> = {
  h: "/hoy", t: "/tablero", c: "/calendario", p: "/proyectos", a: "/chat", s: "/sesiones", m: "/memoria", o: "/configuracion",
};
const DESTINOS = [
  ...SECCIONES.map((s) => ({ href: s.href, nombre: s.nombre })),
  { href: "/sesiones", nombre: "Sesiones" },
];
const letraDe = (href: string) => Object.entries(IR_A).find(([, v]) => v === href)?.[0];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Opcion = { clave: string; texto: string; detalle?: string; icono: "ir" | "proyecto" | "tarea" | "crear"; hacer: () => void };

export function Paleta() {
  const router = useRouter();
  const { hoy, proyectos, tareas, filtro, abrirTarea, crearTarea, avisar } = useDatos();
  const [modo, setModo] = useState<"cerrada" | "buscar" | "tarea" | "atajos">("cerrada");
  const [texto, setTexto] = useState("");
  const [indice, setIndice] = useState(0);
  const esperaG = useRef(0);

  const cerrar = () => {
    setModo("cerrada");
    setTexto("");
    setIndice(0);
  };
  const abrir = (m: "buscar" | "tarea" | "atajos") => {
    setTexto("");
    setIndice(0);
    setModo(m);
  };

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return abrir("buscar");
      }
      // Los atajos de una letra no valen mientras se escribe ni con un diálogo abierto.
      const donde = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (donde?.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
      if (Date.now() - esperaG.current < 1200 && IR_A[e.key]) {
        esperaG.current = 0;
        e.preventDefault();
        return router.push(IR_A[e.key]);
      }
      if (e.key === "g") {
        esperaG.current = Date.now();
        return;
      }
      const modoDe: Record<string, "buscar" | "tarea" | "atajos"> = { "/": "buscar", n: "tarea", "?": "atajos" };
      if (modoDe[e.key]) {
        e.preventDefault();
        abrir(modoDe[e.key]);
      }
    }
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [router]);

  const activos = proyectos.filter((p) => p.status === "activo");
  const proyectoPorDefecto = activos.find((p) => p.id === filtro.proyectoId) ?? activos[0];
  const leida = parsearTarea(texto, hoy);
  const q = norm(texto.trim());

  let opciones: Opcion[] = [];
  if (modo === "tarea") {
    opciones = leida.titulo && proyectoPorDefecto
      ? [{
          clave: "crear",
          icono: "crear",
          texto: `Crear «${leida.titulo}»`,
          detalle: [proyectoPorDefecto.name, leida.due_date ? etiquetaFecha(leida.due_date, hoy).toLowerCase() : null, leida.priority ? `P${leida.priority}` : null].filter(Boolean).join(" · "),
          hacer: () => {
            void crearTarea({ project_id: proyectoPorDefecto.id, title: leida.titulo.slice(0, 300), due_date: leida.due_date, ...(leida.priority ? { priority: leida.priority } : {}) });
            avisar(`Tarea creada en ${proyectoPorDefecto.name}.`);
          },
        }]
      : [];
  } else if (modo === "buscar") {
    opciones = [
      { clave: "nueva", icono: "crear" as const, texto: "Nueva tarea…", detalle: "n", hacer: () => abrir("tarea") },
      ...DESTINOS.map((d) => ({ clave: d.href, icono: "ir" as const, texto: `Ir a ${d.nombre}`, detalle: letraDe(d.href) ? `g ${letraDe(d.href)}` : undefined, hacer: () => router.push(d.href) })),
      ...proyectos.filter((p) => p.status !== "archivado").map((p) => ({ clave: p.id, icono: "proyecto" as const, texto: p.name, detalle: "Proyecto", hacer: () => router.push(`/proyectos/${p.id}`) })),
      // Las tareas solo aparecen al escribir: son muchas.
      ...(q.length >= 2
        ? tareas.filter((t) => t.status !== "hecha").map((t) => ({ clave: t.id, icono: "tarea" as const, texto: t.title, detalle: proyectos.find((p) => p.id === t.project_id)?.name, hacer: () => abrirTarea(t.id) }))
        : []),
    ]
      .filter((o) => !q || norm(o.texto).includes(q))
      .slice(0, 12);
  }
  const elegida = Math.min(indice, Math.max(0, opciones.length - 1));

  function ejecutar(o: Opcion | undefined) {
    if (!o) return;
    // «Nueva tarea…» cambia de modo dentro de la misma paleta; lo demás la cierra.
    if (o.clave !== "nueva") cerrar();
    o.hacer();
  }

  function alTeclear(e: TeclaReact<HTMLInputElement>) {
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
    e.preventDefault();
    if (e.key === "ArrowDown") setIndice(Math.min(elegida + 1, opciones.length - 1));
    else if (e.key === "ArrowUp") setIndice(Math.max(elegida - 1, 0));
    else ejecutar(opciones[elegida]);
  }

  const Icono = { ir: CornerDownLeft, proyecto: FolderKanban, tarea: Search, crear: Plus };

  return (
    <Dialogo
      abierto={modo !== "cerrada"}
      alCerrar={cerrar}
      titulo={modo === "tarea" ? "Tarea nueva" : modo === "atajos" ? "Atajos de teclado" : "Ir a…"}
    >
      {modo === "atajos" ? (
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
          {[
            ["Ctrl K", "Buscar o ir a cualquier parte (también /)"],
            ["n", "Tarea nueva, desde cualquier pantalla"],
            ...DESTINOS.filter((d) => letraDe(d.href)).map((d) => [`g ${letraDe(d.href)}`, `Ir a ${d.nombre}`]),
            ["Espacio", "En el Tablero: levantar y soltar una tarjeta (se mueve con las flechas)"],
            ["Esc", "Cerrar un diálogo"],
            ["?", "Ver estos atajos"],
          ].map(([tecla, que]) => (
            <div key={tecla} className="contents">
              <dt><span className="kbd whitespace-nowrap">{tecla}</span></dt>
              <dd className="text-texto-2">{que}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="flex flex-col gap-3">
          <label htmlFor="paleta" className="sr-only">
            {modo === "tarea" ? "Título de la tarea" : "Buscar secciones, proyectos y tareas"}
          </label>
          <input
            id="paleta"
            autoFocus
            key={modo}
            value={texto}
            role="combobox"
            aria-expanded="true"
            aria-controls="paleta-opciones"
            aria-activedescendant={opciones[elegida] ? `op-${opciones[elegida].clave}` : undefined}
            autoComplete="off"
            placeholder={modo === "tarea" ? "Pintar el cuarto vie p1" : "Escribí para buscar…"}
            onChange={(e) => {
              setTexto(e.target.value);
              setIndice(0);
            }}
            onKeyDown={alTeclear}
            className="h-11 w-full rounded-md border border-borde bg-elevado px-3 text-[15px] placeholder:text-texto-3 focus:border-acento focus:outline-none"
          />
          <ul id="paleta-opciones" role="listbox" aria-label="Resultados" className="flex flex-col">
            {opciones.map((o, i) => {
              const I = Icono[o.icono];
              return (
                <li key={o.clave} id={`op-${o.clave}`} role="option" aria-selected={i === elegida}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => ejecutar(o)}
                    onMouseMove={() => setIndice(i)}
                    className={`flex h-10 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm ${i === elegida ? "bg-elevado text-texto" : "text-texto-2"}`}
                  >
                    <I size={14} aria-hidden className={i === elegida ? "text-acento" : "text-texto-3"} />
                    <span className="min-w-0 flex-1 truncate">{o.texto}</span>
                    {o.detalle ? <span className="shrink-0 text-xs text-texto-3">{o.detalle}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {!opciones.length ? (
            <p className="px-1 text-sm text-texto-3">
              {modo === "tarea"
                ? proyectoPorDefecto
                  ? "Escribí la tarea y Enter. Podés terminar con: mañana, vie, 14/11, p1."
                  : "Primero creá un proyecto: las tareas viven adentro de uno."
                : "Nada coincide."}
            </p>
          ) : null}
        </div>
      )}
    </Dialogo>
  );
}
