"use client";

import { aplicarTema, seVeOscuro } from "@/lib/tema/cliente";

/**
 * Pasa del tema oscuro al claro y vuelta. Si estaba en «automático», queda
 * fijo en el contrario de lo que se ve ahora; para volver a automático está
 * Configuración → Aspecto.
 */
export function BotonTema({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      aria-label="Cambiar entre tema oscuro y claro"
      title="Cambiar entre tema oscuro y claro"
      onClick={() => aplicarTema(seVeOscuro() ? "claro" : "oscuro")}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-borde-fuerte text-texto hover:bg-elevado ${className}`}
    >
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
      </svg>
    </button>
  );
}
