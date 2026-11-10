"use client";

import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";
import { Tarjeta } from "@/components/ui/varios";
import { useDatos } from "@/lib/datos/almacen";
import { supabaseBrowser } from "@/lib/supabase/client";

const TABLAS = [
  "profiles", "areas", "projects", "tasks", "project_log", "sessions", "messages", "memories",
  "change_log", "call_routines", "availability_windows", "voice_usage",
];
const PALABRA = "BORRAR";

/** Todas las filas de una tabla, de a páginas (la API devuelve mil por pedido). */
async function leerTodo(tabla: string): Promise<unknown[]> {
  const filas: unknown[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabaseBrowser().from(tabla).select("*").range(desde, desde + 999);
    if (error) throw error;
    filas.push(...(data ?? []));
    if ((data ?? []).length < 1000) return filas;
  }
}

/** Exportar y borrar todos los datos propios. */
export function ConfigDatos() {
  const router = useRouter();
  const { avisar } = useDatos();
  const [exportando, setExportando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [palabra, setPalabra] = useState("");
  const [borrando, setBorrando] = useState(false);

  async function exportar() {
    setExportando(true);
    try {
      const datos: Record<string, unknown> = { exportado: new Date().toISOString(), app: "MiAgente" };
      for (const tabla of TABLAS) datos[tabla] = await leerTodo(tabla);
      const archivo = new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" });
      const enlace = document.createElement("a");
      enlace.href = URL.createObjectURL(archivo);
      enlace.download = `miagente-${new Date().toISOString().slice(0, 10)}.json`;
      enlace.click();
      URL.revokeObjectURL(enlace.href);
    } catch {
      avisar("No se pudo exportar. Probá de nuevo.");
    }
    setExportando(false);
  }

  async function borrar() {
    setBorrando(true);
    const r = await fetch("/api/cuenta/borrar", { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) {
      setBorrando(false);
      return avisar("No se pudo borrar todo. Probá de nuevo.");
    }
    await supabaseBrowser().auth.signOut().catch(() => null);
    router.replace("/ingresar");
    router.refresh();
  }

  return (
    <Tarjeta>
      <h2 className="rotulo mb-1">Tus datos</h2>
      <p className="mb-4 text-sm text-texto-2">
        Todo lo tuyo (proyectos, tareas, conversaciones, memorias) se puede llevar o borrar cuando quieras.
      </p>
      <div className="flex flex-col gap-4">
        <div>
          <Boton onClick={exportar} disabled={exportando}>
            <Download size={15} aria-hidden />
            {exportando ? "Preparando…" : "Exportar todo (JSON)"}
          </Boton>
        </div>
        <div className="border-t border-borde pt-4">
          {confirmando ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-texto-2">
                Se borran para siempre tus proyectos, tareas, sesiones, memorias y tu cuenta. No se puede deshacer.
                Si querés conservar algo, exportá primero.
              </p>
              <Campo etiqueta={`Escribí ${PALABRA} para confirmar`} htmlFor="confirmar-borrado">
                <Entrada id="confirmar-borrado" autoComplete="off" value={palabra} onChange={(e) => setPalabra(e.target.value)} />
              </Campo>
              <div className="flex gap-2">
                <Boton variante="peligro" disabled={palabra.trim() !== PALABRA || borrando} onClick={borrar}>
                  {borrando ? "Borrando…" : "Borrar todo"}
                </Boton>
                <Boton variante="fantasma" onClick={() => (setConfirmando(false), setPalabra(""))}>
                  Cancelar
                </Boton>
              </div>
            </div>
          ) : (
            <Boton variante="fantasma" onClick={() => setConfirmando(true)}>
              <Trash2 size={15} aria-hidden />
              Borrar todos mis datos
            </Boton>
          )}
        </div>
      </div>
    </Tarjeta>
  );
}
