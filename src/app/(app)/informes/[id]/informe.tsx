"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Bloques } from "@/components/informes/bloques";
import { Boton } from "@/components/ui/boton";
import { Vacio } from "@/components/ui/varios";
import { useDatos } from "@/lib/datos/almacen";
import { periodoLegible } from "@/lib/informes/texto";
import { DatosInforme, type FilaInforme } from "@/lib/informes/tipos";
import { supabaseBrowser } from "@/lib/supabase/client";

type Estado =
  | { tipo: "cargando" }
  | { tipo: "no_esta" }
  | { tipo: "ilegible"; fila: FilaInforme }
  | { tipo: "listo"; fila: FilaInforme; datos: DatosInforme };

const nombreArchivo = (titulo: string) =>
  (titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase() || "informe") + ".pdf";

/** Un informe: sus números, gráficos y listas, y el botón para bajarlo en PDF. */
export function VistaInforme({ id }: { id: string }) {
  const router = useRouter();
  const { avisar } = useDatos();
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [armando, setArmando] = useState(false);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  // El PDF ya armado: si el teléfono pide otro toque para compartir, no se arma de nuevo.
  const archivo = useRef<File | null>(null);
  const [listoParaGuardar, setListoParaGuardar] = useState(false);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const { data } = await supabaseBrowser()
        .from("informes")
        .select("id,titulo,desde,hasta,datos,analisis,session_id,created_at")
        .eq("id", id)
        .maybeSingle();
      if (!vigente) return;
      const fila = data as FilaInforme | null;
      if (!fila) return setEstado({ tipo: "no_esta" });
      // La fila la puede haber escrito cualquiera con la sesión de la persona: se revisa la forma.
      const leido = DatosInforme.safeParse(fila.datos);
      setEstado(leido.success ? { tipo: "listo", fila, datos: leido.data } : { tipo: "ilegible", fila });
    })();
    return () => {
      vigente = false;
    };
  }, [id]);

  async function entregar(pdf: File) {
    // En el teléfono se abre el menú de compartir (Guardar en Archivos, WhatsApp, correo…).
    const tactil = window.matchMedia("(pointer: coarse)").matches;
    if (tactil && navigator.canShare?.({ files: [pdf] })) {
      try {
        await navigator.share({ files: [pdf], title: pdf.name });
        setListoParaGuardar(false);
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return; // la persona cerró el menú
        if ((error as Error).name === "NotAllowedError") {
          // El navegador pide que compartir salga de un toque directo: queda listo para el próximo.
          setListoParaGuardar(true);
          return avisar("El PDF está listo. Tocá «Guardar PDF» para compartirlo o guardarlo.");
        }
      }
    }
    const url = URL.createObjectURL(pdf);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = pdf.name;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setListoParaGuardar(false);
  }

  async function descargar() {
    if (estado.tipo !== "listo") return;
    if (archivo.current) return entregar(archivo.current);
    setArmando(true);
    try {
      // La librería de PDF pesa: se carga recién cuando se pide.
      const { armarPdf } = await import("@/lib/informes/pdf");
      const bytes = await armarPdf({
        titulo: estado.fila.titulo,
        analisis: estado.fila.analisis,
        creado: estado.fila.created_at,
        datos: estado.datos,
      });
      archivo.current = new File([bytes as BlobPart], nombreArchivo(estado.fila.titulo), { type: "application/pdf" });
      await entregar(archivo.current);
    } catch {
      avisar("No se pudo armar el PDF. Probá de nuevo.");
    } finally {
      setArmando(false);
    }
  }

  async function borrar() {
    const { error } = await supabaseBrowser().from("informes").delete().eq("id", id);
    if (error) return avisar("No se pudo borrar. Probá de nuevo.");
    router.replace("/informes");
  }

  const volver = (
    <Link href="/informes" className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-[13px] text-texto-2 hover:text-texto">
      <ArrowLeft size={14} aria-hidden />
      Informes
    </Link>
  );

  if (estado.tipo === "cargando") {
    return (
      <>
        {volver}
        <p className="text-sm text-texto-3">Cargando el informe…</p>
      </>
    );
  }
  if (estado.tipo === "no_esta") {
    return (
      <>
        {volver}
        <Vacio titulo="Ese informe ya no está">Puede que lo hayas borrado. Pedile otro al Agente cuando quieras.</Vacio>
      </>
    );
  }

  const { fila } = estado;
  const armado = new Date(fila.created_at).toLocaleString("es-UY", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <>
      {volver}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="titulo-pagina">{fila.titulo}</h1>
          <p className="mt-1 text-sm text-texto-2">
            {periodoLegible(fila.desde, fila.hasta)}
            {estado.tipo === "listo" && estado.datos.filtro ? ` · ${estado.datos.filtro}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {estado.tipo === "listo" ? (
            <Boton variante="primario" onClick={() => void descargar()} disabled={armando}>
              <Download size={15} aria-hidden />
              {armando ? "Armando el PDF…" : listoParaGuardar ? "Guardar PDF" : "Descargar PDF"}
            </Boton>
          ) : null}
          {confirmarBorrado ? (
            <span className="flex items-center gap-2">
              <span className="text-[13px] text-texto-2">¿Borrarlo?</span>
              <Boton tamano="sm" variante="peligro" onClick={() => void borrar()}>
                Sí, borrar
              </Boton>
              <Boton tamano="sm" variante="fantasma" onClick={() => setConfirmarBorrado(false)}>
                No
              </Boton>
            </span>
          ) : (
            <Boton variante="fantasma" onClick={() => setConfirmarBorrado(true)}>
              <Trash2 size={15} aria-hidden />
              Borrar
            </Boton>
          )}
        </div>
      </header>

      {estado.tipo === "ilegible" ? (
        <Vacio titulo="No se puede mostrar este informe">
          Los datos guardados no tienen la forma esperada. Borralo y pedile otro al Agente.
        </Vacio>
      ) : (
        <div className="flex flex-col gap-4">
          {fila.analisis ? (
            <section className="rounded-lg border border-borde bg-panel p-4 sm:p-5">
              <h2 className="rotulo mb-2 flex items-center gap-1.5">
                <Sparkles size={12} aria-hidden className="text-acento-texto" />
                Lectura del Agente
              </h2>
              <p className="max-w-prose leading-relaxed">{fila.analisis}</p>
            </section>
          ) : null}
          <Bloques bloques={estado.datos.bloques} />
          <p className="max-w-prose text-xs leading-relaxed text-texto-3">
            Armado el {armado}. Los números son de ese momento: no cambian aunque después edites las tareas. Cuentan las tareas
            principales (no las subtareas). La puntualidad compara el día en que terminaste cada tarea con su fecha límite.
          </p>
        </div>
      )}
    </>
  );
}
