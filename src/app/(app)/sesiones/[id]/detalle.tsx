"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TarjetaCambio, type CambioVista } from "@/components/agente/tarjeta-cambio";
import { Boton } from "@/components/ui/boton";
import { Etiqueta, Tarjeta, Vacio } from "@/components/ui/varios";
import { NOMBRE_PROVEEDOR, nombreModelo } from "@/lib/agente/cliente";
import { formatoUSD } from "@/lib/agente/claude/presupuesto";
import { useDatos } from "@/lib/datos/almacen";
import { etiquetaFecha } from "@/lib/datos/fechas";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cuando, ESTADO_SESION, TIPO_SESION, type FilaSesion } from "../lista";

type Mensaje = { id: string; role: string; content: string | null; provider: string | null; model: string | null };

/** Resumen de una sesión: qué se habló, qué se comprometió y todo lo que cambió. */
export function DetalleSesion({ id }: { id: string }) {
  const { hoy, recargar } = useDatos();
  const [sesion, setSesion] = useState<FilaSesion | null | undefined>(undefined);
  const [cambios, setCambios] = useState<CambioVista[]>([]);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [costo, setCosto] = useState<{ total: number; pedidos: number } | null>(null);
  const [generando, setGenerando] = useState(false);

  const cargar = useCallback(async () => {
    const sb = supabaseBrowser();
    const [s, c, m, u] = await Promise.all([
      sb.from("sessions").select("*").eq("id", id).maybeSingle(),
      sb.from("change_log").select("id,operation,summary,undone_at").eq("session_id", id).order("created_at"),
      sb.from("messages").select("id,role,content,provider,model").eq("session_id", id).in("role", ["usuario", "agente"]).order("created_at").limit(400),
      sb.from("llm_usage").select("cost_usd").eq("session_id", id),
    ]);
    const usos = (u.data as { cost_usd: number | string }[] | null) ?? [];
    setCosto(usos.length ? { total: usos.reduce((t, f) => t + Number(f.cost_usd), 0), pedidos: usos.length } : null);
    setSesion((s.data as FilaSesion | null) ?? null);
    setCambios((c.data as CambioVista[] | null) ?? []);
    setMensajes(((m.data as Mensaje[] | null) ?? []).filter((x) => x.content));
  }, [id]);

  useEffect(() => {
    let vigente = true;
    (async () => {
      await Promise.resolve();
      if (vigente) await cargar();
    })();
    return () => {
      vigente = false;
    };
  }, [cargar]);

  async function generarResumen() {
    setGenerando(true);
    await fetch(`/api/sesiones/${id}/cerrar`, { method: "POST" }).catch(() => null);
    await cargar();
    void recargar();
    setGenerando(false);
  }

  if (sesion === undefined) return <p className="text-sm text-texto-3">Cargando…</p>;
  if (sesion === null) {
    return (
      <Vacio titulo="Esta sesión no existe" accion={<Link href="/sesiones" className="font-medium text-acento">Volver a Sesiones</Link>} />
    );
  }

  const abierta = sesion.status === "en_curso";
  const dichos = mensajes.some((m) => m.role === "usuario");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/sesiones" className="-ml-1 flex items-center gap-1 self-start rounded-sm text-[13px] text-texto-2 hover:text-texto">
          <ChevronLeft size={14} aria-hidden />
          Sesiones
        </Link>
        <h1 className="titulo-pagina">{TIPO_SESION[sesion.kind] ?? "Sesión"}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-texto-2">
          {cuando(sesion.started_at ?? sesion.scheduled_at ?? sesion.created_at)}
          <Etiqueta tono={sesion.status === "perdida" ? "peligro" : abierta ? "acento" : "neutro"}>
            {ESTADO_SESION[sesion.status] ?? sesion.status}
          </Etiqueta>
          {sesion.providers_used?.length ? (
            <span className="text-texto-3">
              Respondió {sesion.providers_used.map((p) => NOMBRE_PROVEEDOR[p] ?? p).join(" y ")}
            </span>
          ) : null}
          {costo ? (
            <span className="text-texto-3" title="Estimación con los precios publicados; el gasto real está en la consola de Claude">
              · Claude: {formatoUSD(costo.total)} en {costo.pedidos} {costo.pedidos === 1 ? "pedido" : "pedidos"} (estimado)
            </span>
          ) : null}
        </p>
      </header>

      {abierta ? (
        <Tarjeta>
          <p className="text-sm text-texto-2">Esta sesión sigue abierta.</p>
          <div className="mt-3 flex gap-2">
            <Link href={`/chat?sesion=${sesion.id}`} className="inline-flex h-10 items-center rounded-md bg-acento px-4 text-sm font-medium text-sobre-acento hover:bg-acento-fuerte">
              Seguir por chat
            </Link>
            <Boton onClick={generarResumen} disabled={generando}>
              {generando ? "Cerrando…" : "Terminarla"}
            </Boton>
          </div>
        </Tarjeta>
      ) : null}

      {sesion.status === "perdida" ? (
        <p className="text-sm text-texto-2">
          No se atendió esta llamada{sesion.reschedule_count ? ` (se reprogramó ${sesion.reschedule_count} ${sesion.reschedule_count === 1 ? "vez" : "veces"})` : ""}. Los temas pasan a la próxima.
        </p>
      ) : null}

      {sesion.summary ? (
        <section className="flex flex-col gap-2">
          <h2 className="rotulo">Resumen</h2>
          <p className="max-w-prose leading-relaxed">{sesion.summary}</p>
        </section>
      ) : sesion.status === "completada" && dichos ? (
        <Tarjeta>
          <p className="text-sm text-texto-2">
            Esta sesión se cerró sin resumen (el modelo no estaba disponible). Los cambios de abajo sí se aplicaron.
          </p>
          <Boton className="mt-3" onClick={generarResumen} disabled={generando}>
            {generando ? "Generando…" : "Generar el resumen"}
          </Boton>
        </Tarjeta>
      ) : null}

      {sesion.commitments?.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="rotulo">Compromisos</h2>
          <ul className="flex flex-col gap-1.5">
            {sesion.commitments.map((c, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full bg-acento" />
                <span>{c.texto}</span>
                {c.fecha ? <span className="text-xs text-texto-3">{etiquetaFecha(c.fecha, hoy)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="rotulo">
          Lo que cambió <span className="font-normal opacity-70">· {cambios.length}</span>
        </h2>
        {cambios.length ? (
          cambios.map((c) => <TarjetaCambio key={c.id} cambio={c} />)
        ) : (
          <p className="text-sm text-texto-3">El Agente no modificó nada en esta sesión.</p>
        )}
      </section>

      {mensajes.length ? (
        <details>
          <summary className="cursor-pointer rounded-sm text-[13px] font-medium text-texto-2 hover:text-texto">
            Transcripción <span className="font-normal text-texto-3">· {mensajes.length} mensajes</span>
          </summary>
          <ol className="mt-3 flex flex-col gap-3">
            {mensajes.map((m) => (
              <li key={m.id} className="flex flex-col gap-0.5">
                <span className="text-xs text-texto-3">
                  {m.role === "usuario" ? "Vos" : `Agente${m.provider ? ` · ${nombreModelo(m.provider, m.model)}` : ""}`}
                </span>
                <p className="whitespace-pre-wrap text-sm">{m.content}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
