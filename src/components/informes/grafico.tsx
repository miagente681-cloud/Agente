"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { decirValor } from "@/lib/informes/calcular";
import { TEMA_PANTALLA } from "@/lib/informes/colores";
import { escenaDe, graficoVacio, leyendaDe, type Escena } from "@/lib/informes/escena";
import type { BloqueGrafico } from "@/lib/informes/tipos";

const ANCLA = { inicio: "start", medio: "middle", fin: "end" } as const;

/** El dibujo de una escena. Lo que se puede tocar son las franjas (zonas). */
function Dibujo({
  escena,
  nombre,
  activa,
  alActivar,
}: {
  escena: Escena;
  nombre: string;
  activa: number | null;
  alActivar: (i: number | null) => void;
}) {
  return (
    <svg
      viewBox={`0 0 ${escena.ancho} ${escena.alto}`}
      width={escena.ancho}
      height={escena.alto}
      role="group"
      aria-label={nombre}
      className="block max-w-full select-none"
      onPointerLeave={() => alActivar(null)}
    >
      {/* La franja activa se aclara apenas, para que se vea que responde. */}
      {activa !== null && escena.zonas[activa] ? (
        <rect
          x={escena.zonas[activa].x}
          y={escena.zonas[activa].y}
          width={escena.zonas[activa].ancho}
          height={escena.zonas[activa].alto}
          rx={4}
          fill="#ffffff"
          opacity={0.05}
        />
      ) : null}
      {escena.formas.map((f, i) => (
        <path
          key={i}
          d={f.d}
          fill={f.relleno ? TEMA_PANTALLA[f.relleno] : "none"}
          stroke={f.trazo ? TEMA_PANTALLA[f.trazo] : "none"}
          strokeWidth={f.grosor}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {escena.textos.map((t, i) => (
        <text
          key={i}
          x={t.x}
          y={t.y}
          fontSize={t.tam}
          textAnchor={ANCLA[t.ancla]}
          fill={TEMA_PANTALLA[t.tono]}
          style={t.ancla === "inicio" ? undefined : { fontVariantNumeric: "tabular-nums" }}
        >
          {t.texto}
        </text>
      ))}
      {escena.zonas.map((z, i) => (
        <rect
          key={i}
          x={z.x}
          y={z.y}
          width={z.ancho}
          height={z.alto}
          fill="transparent"
          tabIndex={0}
          role="img"
          aria-label={`${z.titulo}: ${z.filas.map((f) => `${f.nombre} ${f.valor}`).join(", ")}`}
          className="cursor-default outline-none focus-visible:stroke-[var(--color-acento)] focus-visible:[stroke-width:2]"
          onPointerEnter={() => alActivar(i)}
          onPointerDown={() => alActivar(i)}
          onFocus={() => alActivar(i)}
          onBlur={() => alActivar(null)}
        />
      ))}
    </svg>
  );
}

/**
 * Un gráfico del informe. Arriba lleva una línea que hace de leyenda y, al
 * pasar por una franja (o tocarla, o enfocarla con el teclado), muestra sus
 * valores. Todo valor también está en «Ver como tabla».
 */
export function Grafico({ bloque }: { bloque: BloqueGrafico }) {
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  const [activa, setActiva] = useState<number | null>(null);

  useEffect(() => {
    const nodo = caja.current;
    if (!nodo) return;
    const observador = new ResizeObserver(([e]) => setAncho(Math.floor(e.contentRect.width)));
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  const vacio = graficoVacio(bloque);
  const escena = useMemo(() => (ancho > 0 && !vacio ? escenaDe(bloque, ancho) : null), [bloque, ancho, vacio]);
  const leyenda = leyendaDe(bloque);
  const zona = activa !== null ? escena?.zonas[activa] : null;

  return (
    <div>
      {/* Leyenda y lectura de valores. Tiene alto fijo para que el gráfico no salte. */}
      <div className="mb-2 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" aria-live="polite">
        {zona ? <span className="font-medium text-texto">{zona.titulo}</span> : null}
        {leyenda.length > 1 || zona
          ? leyenda.map((l, i) => (
              <span key={l.nombre} className="inline-flex items-center gap-1.5 text-texto-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: TEMA_PANTALLA[l.tono] }} />
                {l.nombre}
                {zona ? <strong className="font-semibold text-texto">{zona.filas[i]?.valor}</strong> : null}
              </span>
            ))
          : null}
      </div>
      <div ref={caja}>
        {vacio ? (
          <p className="py-6 text-sm text-texto-3">No hay nada para mostrar en este período.</p>
        ) : escena ? (
          <Dibujo escena={escena} nombre={bloque.titulo} activa={activa} alActivar={setActiva} />
        ) : (
          <div className="h-[210px]" />
        )}
      </div>
      {vacio ? null : (
        <details className="mt-3 text-[13px]">
          <summary className="w-fit cursor-pointer rounded-sm text-texto-3 hover:text-texto">Ver como tabla</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-borde text-texto-3">
                  <th scope="col" className="py-1.5 pr-3 font-medium" />
                  {bloque.series.map((s) => (
                    <th key={s.medida} scope="col" className="py-1.5 pl-3 text-right font-medium">
                      {s.nombre}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bloque.categorias.map((cat, i) => (
                  <tr key={cat + i} className="border-b border-borde last:border-b-0">
                    <th scope="row" className="py-1.5 pr-3 font-normal text-texto-2">
                      {cat}
                    </th>
                    {bloque.series.map((s) => (
                      <td key={s.medida} className="py-1.5 pl-3 text-right tabular-nums text-texto">
                        {decirValor(s.valores[i], bloque.unidad)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
