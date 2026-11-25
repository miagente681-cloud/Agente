"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Tarjeta } from "@/components/ui/varios";
import { ACENTOS, TEMAS, type Tema } from "@/lib/tema/acento";
import { acentoActual, aplicarAcento, aplicarTema, EVENTO_ASPECTO, temaActual } from "@/lib/tema/cliente";

/**
 * Cómo se ve la app en este dispositivo: tema oscuro o claro y color
 * principal. Se aplica al instante y queda guardado en el dispositivo.
 */
export function ConfigAspecto() {
  // Lo elegido vive en <html> (lo puso el servidor desde las cookies): se lee al montar.
  const [tema, setTema] = useState<Tema | null>(null);
  const [acento, setAcento] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const leer = () => {
      setTema(temaActual());
      setAcento(acentoActual());
    };
    void Promise.resolve().then(leer);
    // El botón del encabezado también cambia el tema.
    window.addEventListener(EVENTO_ASPECTO, leer);
    return () => window.removeEventListener(EVENTO_ASPECTO, leer);
  }, []);

  const enLista = ACENTOS.some((a) => a.color === acento);

  return (
    <Tarjeta>
      <h2 className="rotulo mb-1">Aspecto</h2>
      <p className="mb-4 text-sm text-texto-2">
        Elegí el tema y el color principal de la app. Vale para este dispositivo.
      </p>

      <p id="aspecto-tema" className="mb-1.5 text-[13px] font-medium text-texto-2">
        Tema
      </p>
      <div role="radiogroup" aria-labelledby="aspecto-tema" className="mb-5 flex gap-1 rounded-full bg-elevado p-1">
        {TEMAS.map((t) => (
          <button
            key={t.valor}
            type="button"
            role="radio"
            aria-checked={tema === t.valor}
            onClick={() => aplicarTema(t.valor)}
            className={`h-10 flex-1 rounded-full text-sm font-medium transition-colors ${
              tema === t.valor ? "bg-acento text-sobre-acento" : "text-texto-2 hover:text-texto"
            }`}
          >
            {t.nombre}
          </button>
        ))}
      </div>

      <p id="aspecto-color" className="mb-2 text-[13px] font-medium text-texto-2">
        Color principal
      </p>
      <div role="radiogroup" aria-labelledby="aspecto-color" className="flex flex-wrap gap-2.5">
        {ACENTOS.map((a) => {
          const elegido = acento !== undefined && acento === a.color;
          return (
            <button
              key={a.nombre}
              type="button"
              role="radio"
              aria-checked={elegido}
              aria-label={a.nombre}
              title={a.nombre}
              onClick={() => aplicarAcento(a.color)}
              className={`flex h-11 w-11 items-center justify-center rounded-full border-2 ${
                elegido ? "border-texto" : "border-transparent"
              }`}
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full border border-borde-fuerte"
                // «Sin color»: mitad y mitad, con los colores del texto y del fondo.
                style={{ background: a.color ?? "linear-gradient(135deg, var(--color-texto) 50%, var(--color-fondo) 50%)" }}
              >
                {elegido && a.color ? <Check size={15} strokeWidth={3} aria-hidden color="#000000" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <label className="mt-4 flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm text-texto-2">
        <input
          type="color"
          aria-label="Otro color"
          value={acento ?? "#808080"}
          onChange={(e) => aplicarAcento(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-borde-fuerte bg-transparent p-0.5"
        />
        {acento && !enLista ? `Otro color: ${acento}` : "Otro color…"}
      </label>
      <p className="mt-2 text-[13px] text-texto-3">
        Si el color no se lee bien sobre el fondo, los textos lo usan un poco más claro o más oscuro.
      </p>
    </Tarjeta>
  );
}
