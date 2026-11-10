"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  CalendarDays,
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
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-0.5 border-r border-borde bg-panel p-3 md:flex"
    >
      <Link href="/hoy" className="mb-4 flex items-center gap-2.5 rounded-md px-2 py-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/iconos/icono.svg" alt="" width={24} height={24} />
        <span className="font-semibold tracking-tight">MiAgente</span>
      </Link>
      {SECCIONES.map(({ href, nombre, icono: Icono }) => {
        const esActiva = activa(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={esActiva ? "page" : undefined}
            className={`flex h-9 items-center gap-2.5 rounded-md px-2 text-sm transition-colors ${
              esActiva
                ? "bg-elevado font-medium text-texto"
                : "text-texto-2 hover:bg-elevado hover:text-texto"
            }`}
          >
            <Icono size={16} strokeWidth={1.75} className={esActiva ? "text-acento" : ""} aria-hidden />
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

export function BarraInferior() {
  const pathname = usePathname();
  const items = SECCIONES.filter((s) => s.movil);
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-borde bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map(({ href, nombre, icono: Icono }) => {
          const esActiva = activa(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={esActiva ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-1 text-[11px] ${
                  esActiva ? "text-acento" : "text-texto-3"
                }`}
              >
                <Icono size={20} strokeWidth={1.75} aria-hidden />
                <span className={esActiva ? "font-medium" : ""}>
                  {nombre === "Configuración" ? "Ajustes" : nombre}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
