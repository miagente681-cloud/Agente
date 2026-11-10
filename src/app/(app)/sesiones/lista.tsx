"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EncabezadoPagina, Etiqueta, Vacio } from "@/components/ui/varios";
import { supabaseBrowser } from "@/lib/supabase/client";

export type FilaSesion = {
  id: string;
  kind: string;
  channel: string;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  summary: string | null;
  commitments: { texto: string; fecha?: string | null }[];
  providers_used: string[];
  reschedule_count: number;
  created_at: string;
};

export const TIPO_SESION: Record<string, string> = {
  chat: "Chat",
  onboarding: "Entrevista inicial",
  llamada_programada: "Llamada",
};
export const ESTADO_SESION: Record<string, string> = {
  programada: "Programada",
  notificada: "Esperándote",
  en_curso: "En curso",
  completada: "Completada",
  reprogramada: "Reprogramada",
  perdida: "Perdida",
};

export const cuando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-UY", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

export function ListaSesiones() {
  const [sesiones, setSesiones] = useState<FilaSesion[] | null>(null);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const { data } = await supabaseBrowser()
        .from("sessions")
        .select("id,kind,channel,status,scheduled_at,started_at,ended_at,summary,commitments,providers_used,reschedule_count,created_at")
        .order("created_at", { ascending: false })
        .limit(60);
      if (vigente) setSesiones((data as FilaSesion[] | null) ?? []);
    })();
    return () => {
      vigente = false;
    };
  }, []);

  return (
    <>
      <EncabezadoPagina titulo="Sesiones" descripcion="Cada charla y cada llamada, con su resumen y lo que cambió." />
      {sesiones === null ? (
        <p className="text-sm text-texto-3">Cargando…</p>
      ) : !sesiones.length ? (
        <Vacio titulo="Todavía no hay sesiones">
          Cuando hables con el Agente, por chat o en una llamada, acá queda el resumen y los cambios que hizo.
        </Vacio>
      ) : (
        <ul className="flex flex-col gap-2">
          {sesiones.map((s) => (
            <li key={s.id}>
              <Link
                href={s.status === "en_curso" && s.kind !== "llamada_programada" ? `/chat?sesion=${s.id}` : `/sesiones/${s.id}`}
                className="flex flex-col gap-1.5 rounded-lg border border-borde bg-panel px-4 py-3 hover:border-borde-fuerte"
              >
                <span className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium text-texto">{TIPO_SESION[s.kind] ?? s.kind}</span>
                  <span className="text-texto-3">{cuando(s.started_at ?? s.scheduled_at ?? s.created_at)}</span>
                  <Etiqueta tono={s.status === "perdida" ? "peligro" : s.status === "en_curso" || s.status === "notificada" ? "acento" : "neutro"}>
                    {ESTADO_SESION[s.status] ?? s.status}
                  </Etiqueta>
                </span>
                {s.summary ? <span className="line-clamp-2 text-sm text-texto-2">{s.summary}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
