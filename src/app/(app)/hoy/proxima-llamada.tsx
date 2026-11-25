"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDatos } from "@/lib/datos/almacen";
import { etiquetaFecha } from "@/lib/datos/fechas";
import { cuantoFalta, proximaDeRutinas, type RutinaLlamada } from "@/lib/datos/proxima-llamada";
import { partesEnZona } from "@/lib/programacion/horarios";
import { supabaseBrowser } from "@/lib/supabase/client";

type Proxima = {
  /** La sesión, si el programador ya la creó (la de hoy). */
  id: string | null;
  fecha: string;
  hora: string;
  foco: string | null;
  /** Ya se puede atender: llegó su hora. */
  lista: boolean;
  /** Minutos que faltan (negativo si ya pasó la hora). */
  faltan: number;
};

type SesionProxima = { id: string; focus: string | null; status: string; scheduled_at: string | null };

/**
 * El mosaico destacado de Hoy: a qué hora llama el Agente y, cuando llegó la
 * hora, el botón para atender. Sale de la llamada ya creada para hoy o, si
 * todavía no hay, de las rutinas. Sin rutinas no se muestra (ahí avisa
 * EstadoLlamadas).
 */
export function ProximaLlamada() {
  // Días y horas, en la zona del perfil: la misma con la que se arma «hoy» y con la que llama el Agente.
  const { hoy, zona } = useDatos();
  const [proxima, setProxima] = useState<Proxima | null>(null);

  useEffect(() => {
    let vigente = true;
    const mirar = async () => {
      if (document.visibilityState !== "visible") return;
      const sb = supabaseBrowser();
      const [sesiones, rutinas] = await Promise.all([
        sb
          .from("sessions")
          .select("id,focus,status,scheduled_at")
          .eq("kind", "llamada_programada")
          .in("status", ["programada", "notificada"])
          .order("scheduled_at")
          .limit(1),
        sb.from("call_routines").select("weekdays,local_time,focus,active"),
      ]);
      if (!vigente) return;
      const ahora = new Date();
      const local = partesEnZona(ahora, zona);
      const sesion = ((sesiones.data ?? []) as SesionProxima[]).find((s) => s.scheduled_at);
      if (sesion?.scheduled_at) {
        const cuando = new Date(sesion.scheduled_at);
        const faltan = (cuando.getTime() - ahora.getTime()) / 60_000;
        const enZona = partesEnZona(cuando, zona);
        return setProxima({
          id: sesion.id,
          fecha: enZona.fecha,
          hora: enZona.hora,
          foco: sesion.focus,
          lista: sesion.status === "notificada" || faltan <= 1,
          faltan,
        });
      }
      const deRutina = proximaDeRutinas((rutinas.data ?? []) as RutinaLlamada[], local.fecha, local.hora);
      if (!deRutina) return setProxima(null);
      const minutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
      const faltan = deRutina.fecha === local.fecha ? minutos(deRutina.hora) - minutos(local.hora) : 24 * 60;
      setProxima({ id: null, ...deRutina, lista: false, faltan });
    };
    void mirar();
    document.addEventListener("visibilitychange", mirar);
    return () => {
      vigente = false;
      document.removeEventListener("visibilitychange", mirar);
    };
  }, [hoy, zona]);

  if (!proxima) return null;
  const cuando = proxima.fecha === hoy ? cuantoFalta(proxima.faltan) : etiquetaFecha(proxima.fecha, hoy).toLowerCase();
  return (
    <section aria-label="Próxima llamada" className="min-w-0 rounded-xl bg-acento px-5 pb-5 pt-4 text-sobre-acento md:flex-1">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em]">
        {proxima.lista ? "Tu Agente te está llamando" : "Próxima llamada"}
      </p>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <p className="cifra text-[5.25rem] leading-[0.88]">{proxima.hora}</p>
        {proxima.lista && proxima.id ? (
          <Link
            href={`/llamada/${proxima.id}`}
            // Botón invertido dentro del mosaico relleno: acá sí va `text-acento`, sobre `sobre-acento`.
            className="inline-flex h-11 shrink-0 items-center rounded-full bg-sobre-acento px-5 text-sm font-bold text-acento"
          >
            Atender
          </Link>
        ) : cuando ? (
          <p className="shrink-0 pb-1 text-sm font-semibold">{cuando}</p>
        ) : null}
      </div>
      {proxima.foco ? <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug">{proxima.foco}</p> : null}
    </section>
  );
}
