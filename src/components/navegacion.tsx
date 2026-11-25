"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  CalendarDays,
  ChartColumn,
  FolderKanban,
  KanbanSquare,
  MessageCircle,
  Settings,
  Sun,
  type LucideIcon,
} from "lucide-react";

type Item = { href: string; nombre: string; icono: LucideIcon; movil: boolean };

/** Secciones de la app. En el celular solo entran cinco en la barra inferior. */
export const SECCIONES: Item[] = [
  { href: "/hoy", nombre: "Hoy", icono: Sun, movil: true },
  { href: "/tablero", nombre: "Tablero", icono: KanbanSquare, movil: true },
  { href: "/calendario", nombre: "Calendario", icono: CalendarDays, movil: false },
  { href: "/proyectos", nombre: "Proyectos", icono: FolderKanban, movil: true },
  { href: "/chat", nombre: "Agente", icono: MessageCircle, movil: true },
  { href: "/informes", nombre: "Informes", icono: ChartColumn, movil: false },
  { href: "/memoria", nombre: "Lo que sé de vos", icono: Brain, movil: false },
  { href: "/configuracion", nombre: "Configuración", icono: Settings, movil: true },
];

function activa(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BarraLateral() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Secciones"
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r-[1.5px] border-dotted border-borde-fuerte p-3 md:flex"
    >
      <Link href="/hoy" className="mb-4 flex items-center gap-2.5 rounded-full px-2 py-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/iconos/icono.svg" alt="" width={24} height={24} />
        <span className="cifra text-[1.6rem]">MiAgente</span>
      </Link>
      {SECCIONES.map(({ href, nombre, icono: Icono }) => {
        const esActiva = activa(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={esActiva ? "page" : undefined}
            className={`flex h-10 items-center gap-2.5 rounded-full px-3 text-sm transition-colors ${
              esActiva
                ? "bg-acento font-medium text-sobre-acento"
                : "text-texto-2 hover:bg-elevado hover:text-texto"
            }`}
          >
            <Icono size={17} strokeWidth={1.75} aria-hidden />
            {nombre}
          </Link>
        );
      })}
      <p className="mt-auto px-2 pb-1 text-xs text-texto-3">
        <span className="kbd">Ctrl K</span> buscar · <span className="kbd">?</span> atajos
      </p>
    </nav>
  );
}

/** En el celular: una píldora flotante con cinco íconos; el de la sección abierta va relleno. */
export function BarraInferior() {
  const pathname = usePathname();
  const items = SECCIONES.filter((s) => s.movil);
  return (
    <nav
      aria-label="Secciones"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(0.625rem+env(safe-area-inset-bottom))] md:hidden"
    >
      <ul className="pointer-events-auto mx-auto flex max-w-sm items-center justify-between rounded-full border border-borde bg-panel p-1.5 shadow-lg shadow-black/25">
        {items.map(({ href, nombre, icono: Icono }) => {
          const esActiva = activa(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={esActiva ? "page" : undefined}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                  esActiva ? "bg-acento text-sobre-acento" : "text-texto-2 hover:text-texto"
                }`}
              >
                <Icono size={22} strokeWidth={1.75} aria-hidden />
                <span className="sr-only">{nombre === "Configuración" ? "Ajustes" : nombre}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
