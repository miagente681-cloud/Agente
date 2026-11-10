"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Diálogo modal sobre el elemento nativo <dialog>: el navegador se ocupa de
 * atrapar el foco, de cerrar con Escape y de devolver el foco al cerrar.
 * En el celular sale desde abajo, donde llega el pulgar.
 */
export function Dialogo({
  abierto,
  alCerrar,
  titulo,
  children,
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      aria-label={titulo}
      onClose={alCerrar}
      // Un clic en el fondo (fuera de la caja) cierra.
      onClick={(e) => e.target === ref.current && alCerrar()}
      className="m-auto mb-0 max-h-[92dvh] w-full max-w-xl overflow-visible rounded-t-xl border border-borde-fuerte bg-panel p-0 text-texto backdrop:bg-black/60 sm:mb-auto sm:rounded-xl"
    >
      {abierto ? (
        <div className="flex max-h-[92dvh] flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-borde px-4 py-3 sm:px-5">
            <h2 className="rotulo">{titulo}</h2>
            <button
              type="button"
              onClick={alCerrar}
              aria-label="Cerrar"
              className="-mr-1.5 flex h-8 w-8 items-center justify-center rounded-md text-texto-2 hover:bg-elevado hover:text-texto"
            >
              <X size={16} aria-hidden />
            </button>
          </header>
          <div className="overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5">
            {children}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
