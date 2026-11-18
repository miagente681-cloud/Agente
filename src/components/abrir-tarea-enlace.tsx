"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useDatos } from "@/lib/datos/almacen";

/**
 * Abre el detalle de una tarea cuando la dirección trae `?tarea=<id>`: es el
 * enlace de la notificación «es la hora». Después saca el parámetro, para que
 * al recargar no se vuelva a abrir.
 */
export function AbrirTareaDelEnlace() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { estado, tareas, abrirTarea } = useDatos();
  const id = params.get("tarea");

  useEffect(() => {
    if (!id || estado !== "listo") return;
    if (tareas.some((t) => t.id === id)) abrirTarea(id);
    router.replace(pathname, { scroll: false });
  }, [id, estado, tareas, abrirTarea, router, pathname]);

  return null;
}
