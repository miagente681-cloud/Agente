"use client";

import { Archive, Pencil, Plus, Undo2 } from "lucide-react";
import { useState } from "react";
import { deshacerCambio } from "@/lib/agente/deshacer";
import { useDatos } from "@/lib/datos/almacen";
import { supabaseBrowser } from "@/lib/supabase/client";

export type CambioVista = {
  id: string;
  operation: "crear" | "actualizar" | "archivar";
  summary: string;
  undone_at?: string | null;
};

const ICONO = { crear: Plus, actualizar: Pencil, archivar: Archive };

/** Un cambio que hizo el Agente, con su botón para deshacerlo. */
export function TarjetaCambio({ cambio }: { cambio: CambioVista }) {
  const { recargar, avisar } = useDatos();
  const [deshecho, setDeshecho] = useState(Boolean(cambio.undone_at));
  const [ocupado, setOcupado] = useState(false);
  const Icono = ICONO[cambio.operation] ?? Pencil;

  async function deshacer() {
    setOcupado(true);
    const r = await deshacerCambio(supabaseBrowser(), cambio.id);
    setOcupado(false);
    if (!r.ok) return avisar(r.mensaje ?? "No se pudo deshacer.");
    setDeshecho(true);
    void recargar();
  }

  return (
    <div
      className={`flex items-center gap-2.5 rounded-md border border-borde bg-panel py-1.5 pl-3 pr-1.5 text-[13px] ${
        deshecho ? "opacity-60" : ""
      }`}
    >
      <Icono size={13} aria-hidden className="shrink-0 text-acento" />
      <span className={`min-w-0 flex-1 ${deshecho ? "line-through" : ""}`}>{cambio.summary}</span>
      {deshecho ? (
        <span className="px-2 text-xs text-texto-3">Deshecho</span>
      ) : (
        <button
          type="button"
          onClick={deshacer}
          disabled={ocupado || !cambio.id}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 font-medium text-texto-2 hover:bg-elevado hover:text-texto disabled:opacity-50"
        >
          <Undo2 size={13} aria-hidden />
          Deshacer
        </button>
      )}
    </div>
  );
}
