"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { comparar, fechaCorta, motivoSinValor, valorDe } from "@/lib/informes/texto";
import type { BloqueCalculado, BloqueLista, BloqueNumero } from "@/lib/informes/tipos";
import { Grafico } from "./grafico";

const tarjeta = "rounded-lg border border-borde bg-panel p-4 sm:p-5";

/** Un número del informe, con su comparación contra el período anterior. */
function Numero({ bloque }: { bloque: BloqueNumero }) {
  const c = comparar(bloque);
  const motivo = motivoSinValor(bloque);
  const Icono = c?.direccion === "sube" ? TrendingUp : c?.direccion === "baja" ? TrendingDown : Minus;
  return (
    <div className={`${tarjeta} flex flex-col gap-1`}>
      <p className="text-[13px] text-texto-2">{bloque.titulo}</p>
      <p className="cifra mt-1 text-[2.75rem]">{valorDe(bloque)}</p>
      {c ? (
        // El color acompaña al ícono y al texto; nunca es lo único que lo dice.
        <p className={`flex items-center gap-1 text-xs ${c.sentido === "bien" ? "text-ok" : c.sentido === "mal" ? "text-peligro" : "text-texto-3"}`}>
          <Icono size={13} aria-hidden />
          <span>
            {c.texto} <span className="text-texto-3">vs. período anterior</span>
          </span>
        </p>
      ) : motivo ? (
        <p className="text-xs text-texto-3">{motivo}</p>
      ) : null}
    </div>
  );
}

function Lista({ bloque }: { bloque: BloqueLista }) {
  const conAnio = new Set(bloque.filas.map((f) => f.fecha?.slice(0, 4))).size > 1;
  return (
    <section className={tarjeta}>
      <h2 className="mb-3 text-[15px] font-medium">
        {bloque.titulo} <span className="font-normal text-texto-3">· {bloque.total}</span>
      </h2>
      {bloque.filas.length ? (
        <ul>
          {bloque.filas.map((f, i) => (
            <li key={i} className="flex items-baseline gap-3 border-b border-borde py-2 last:border-b-0">
              <span className="w-14 shrink-0 text-xs tabular-nums text-texto-3">{f.fecha ? fechaCorta(f.fecha, conAnio) : "—"}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{f.titulo}</span>
                <span className="block truncate text-xs text-texto-3">{f.proyecto}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-texto-2">
                <span className="sr-only">{bloque.columna}: </span>
                {f.detalle}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-texto-3">Ninguna en este período.</p>
      )}
      {bloque.total > bloque.filas.length ? (
        <p className="mt-3 text-xs text-texto-3">
          Se muestran las primeras {bloque.filas.length} de {bloque.total}.
        </p>
      ) : null}
    </section>
  );
}

/** Los bloques de un informe. Los números seguidos se acomodan en una misma fila. */
export function Bloques({ bloques }: { bloques: BloqueCalculado[] }) {
  const grupos: (Exclude<BloqueCalculado, BloqueNumero> | BloqueNumero[])[] = [];
  for (const b of bloques) {
    const ultimo = grupos[grupos.length - 1];
    if (b.tipo !== "numero") grupos.push(b);
    else if (Array.isArray(ultimo)) ultimo.push(b);
    else grupos.push([b]);
  }
  return (
    <>
      {grupos.map((g, i) =>
        Array.isArray(g) ? (
          <div key={i} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {g.map((n, j) => (
              <Numero key={j} bloque={n} />
            ))}
          </div>
        ) : g.tipo === "lista" ? (
          <Lista key={i} bloque={g} />
        ) : (
          <section key={i} className={tarjeta}>
            <h2 className="mb-2 text-[15px] font-medium">{g.titulo}</h2>
            <Grafico bloque={g} />
          </section>
        ),
      )}
    </>
  );
}
