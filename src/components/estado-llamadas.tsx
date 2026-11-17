"use client";

import Link from "next/link";
import { BellOff, PhoneOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Problema = "sin_rutinas" | "sin_dispositivos" | "fallan";

const OCULTAR_SIN_RUTINAS = "miagente.ocultar-sin-rutinas";

function leerOculto(): boolean {
  try {
    return window.localStorage.getItem(OCULTAR_SIN_RUTINAS) === "1";
  } catch {
    return false;
  }
}

/**
 * Las llamadas llegan solo por notificación push. Este aviso, en Hoy, dice
 * cuándo eso no va a funcionar: no hay rutinas, ningún dispositivo tiene las
 * notificaciones activadas, o los últimos avisos no se pudieron entregar.
 */
export function EstadoLlamadas() {
  const [problema, setProblema] = useState<Problema | null>(null);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const sb = supabaseBrowser();
      const [rutinas, dispositivos] = await Promise.all([
        sb.from("call_routines").select("active"),
        sb.from("push_subscriptions").select("ultimo_resultado"),
      ]);
      if (!vigente || rutinas.error || dispositivos.error) return;
      const lista = (rutinas.data ?? []) as { active: boolean }[];
      const avisos = (dispositivos.data ?? []) as { ultimo_resultado: string | null }[];
      if (!lista.length) return setProblema(leerOculto() ? null : "sin_rutinas");
      // Rutinas pausadas a propósito: no hay nada que avisar.
      if (!lista.some((r) => r.active)) return setProblema(null);
      if (!avisos.length) return setProblema("sin_dispositivos");
      if (avisos.every((d) => d.ultimo_resultado === "fallo")) return setProblema("fallan");
      setProblema(null);
    })();
    return () => {
      vigente = false;
    };
  }, []);

  if (!problema) return null;

  if (problema === "sin_rutinas") {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-borde bg-panel px-4 py-3">
        <PhoneOff size={18} aria-hidden className="mt-0.5 shrink-0 text-texto-3" />
        <p className="min-w-0 flex-1 text-sm text-texto-2">
          Tu Agente todavía no te llama.{" "}
          <Link href="/configuracion#rutinas" className="font-medium text-texto underline underline-offset-2">
            Elegí días y hora
          </Link>{" "}
          y te va a avisar con una notificación para repasar tus proyectos.
        </p>
        <button
          type="button"
          aria-label="No mostrar más este aviso"
          onClick={() => {
            try {
              window.localStorage.setItem(OCULTAR_SIN_RUTINAS, "1");
            } catch {
              // Sin almacenamiento se oculta solo hasta recargar.
            }
            setProblema(null);
          }}
          className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-texto-3 hover:bg-elevado hover:text-texto"
        >
          <X size={15} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-aviso/40 bg-panel px-4 py-3">
      <BellOff size={18} aria-hidden className="mt-0.5 shrink-0 text-aviso" />
      <p className="min-w-0 flex-1 text-sm text-texto-2">
        {problema === "sin_dispositivos"
          ? "Tenés llamadas programadas, pero ningún dispositivo tiene las notificaciones activadas: no te van a llegar. "
          : "Los últimos avisos de llamada no se pudieron entregar a tus dispositivos. "}
        <Link href="/configuracion#notificaciones" className="font-medium text-texto underline underline-offset-2">
          {problema === "sin_dispositivos" ? "Activarlas" : "Ver qué pasa"}
        </Link>
      </p>
    </div>
  );
}
