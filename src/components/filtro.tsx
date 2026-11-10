"use client";

import { Selector } from "@/components/ui/campo";
import { useDatos } from "@/lib/datos/almacen";

/** Filtro por área y proyecto. Vale para Hoy, Tablero y Calendario, y se recuerda. */
export function Filtro() {
  const { areas, proyectos, filtro, cambiarFiltro } = useDatos();
  const activos = proyectos.filter((p) => p.status === "activo");
  if (activos.length < 2) return null;

  const delArea = activos.filter(
    (p) =>
      !filtro.areaId ||
      (filtro.areaId === "sin-area" ? !areas.some((a) => a.id === p.area_id) : p.area_id === filtro.areaId),
  );
  const filtrando = filtro.areaId || filtro.proyectoId;

  return (
    <div className="flex items-center gap-2">
      {areas.length ? (
        <>
          <label htmlFor="filtro-area" className="sr-only">
            Filtrar por área
          </label>
          <Selector
            id="filtro-area"
            value={filtro.areaId ?? ""}
            onChange={(e) => cambiarFiltro({ areaId: e.target.value || null, proyectoId: null })}
            className={`!h-8 !w-auto max-w-36 !text-[13px] ${filtro.areaId ? "!border-acento/60" : ""}`}
          >
            <option value="">Todas las áreas</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value="sin-area">Sin área</option>
          </Selector>
        </>
      ) : null}
      <label htmlFor="filtro-proyecto" className="sr-only">
        Filtrar por proyecto
      </label>
      <Selector
        id="filtro-proyecto"
        value={filtro.proyectoId ?? ""}
        onChange={(e) => cambiarFiltro({ ...filtro, proyectoId: e.target.value || null })}
        className={`!h-8 !w-auto max-w-44 !text-[13px] ${filtro.proyectoId ? "!border-acento/60" : ""}`}
      >
        <option value="">Todos los proyectos</option>
        {delArea.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Selector>
      {filtrando ? (
        <button
          type="button"
          onClick={() => cambiarFiltro({ areaId: null, proyectoId: null })}
          className="rounded-sm px-1 text-[13px] text-texto-2 hover:text-texto"
        >
          Quitar
        </button>
      ) : null}
    </div>
  );
}

/** Lo que se muestra mientras cargan los datos o si fallan. */
export function EstadoDatos() {
  const { estado, recargar } = useDatos();
  if (estado === "cargando") return <p className="text-sm text-texto-3">Cargando…</p>;
  if (estado === "error") {
    return (
      <div className="rounded-lg border border-borde bg-panel p-4">
        <p className="font-medium">No se pudieron cargar tus datos</p>
        <p className="mt-1 text-sm text-texto-2">Revisá la conexión y probá de nuevo.</p>
        <button
          type="button"
          onClick={() => void recargar()}
          className="mt-3 h-8 rounded-md border border-borde bg-elevado px-3 text-[13px] font-medium hover:border-borde-fuerte"
        >
          Reintentar
        </button>
      </div>
    );
  }
  return null;
}
