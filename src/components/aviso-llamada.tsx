"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

const CADA_MS = 30_000;

/**
 * Aviso de llamada en espera, dentro de la app. Funciona aunque no haya
 * notificaciones push (o no hayan llegado): mira cada medio minuto si hay una
 * llamada que ya llegó a su hora.
 */
export function AvisoLlamada() {
  const pathname = usePathname();
  const [llamada, setLlamada] = useState<{ id: string; focus: string | null } | null>(null);

  useEffect(() => {
    let vigente = true;
    const mirar = async () => {
      if (document.visibilityState !== "visible") return;
      const { data } = await supabaseBrowser()
        .from("sessions")
        .select("id,focus,status,scheduled_at")
        .in("status", ["notificada", "programada"])
        .lte("scheduled_at", new Date().toISOString())
        .order("scheduled_at")
        .limit(1);
      if (vigente) setLlamada((data as { id: string; focus: string | null }[] | null)?.[0] ?? null);
    };
    void mirar();
    const reloj = setInterval(mirar, CADA_MS);
    document.addEventListener("visibilitychange", mirar);
    return () => {
      vigente = false;
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", mirar);
    };
  }, [pathname]);

  if (!llamada || pathname.startsWith("/llamada/")) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-40 flex justify-center px-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:left-56"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-acento/50 bg-elevado py-2 pl-4 pr-2 shadow-xl shadow-black/50">
        <Phone size={18} aria-hidden className="shrink-0 animate-pulse text-acento" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Tu Agente te está llamando</p>
          {llamada.focus ? <p className="truncate text-xs text-texto-2">{llamada.focus}</p> : null}
        </div>
        <Link
          href={`/llamada/${llamada.id}`}
          className="inline-flex h-10 shrink-0 items-center rounded-lg bg-acento px-4 text-sm font-medium text-sobre-acento hover:bg-acento-fuerte"
        >
          Atender
        </Link>
      </div>
    </div>
  );
}
