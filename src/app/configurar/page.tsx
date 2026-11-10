import type { Metadata } from "next";
import Link from "next/link";
import { Check, CircleDashed, Minus } from "lucide-react";
import { supabaseConfigurado } from "@/lib/env";
import { integraciones } from "@/lib/integraciones";

export const metadata: Metadata = { title: "Integraciones" };
// Lee las variables de entorno en cada pedido, no al compilar.
export const dynamic = "force-dynamic";

/**
 * Qué integraciones tiene cargadas este despliegue. Muestra solo si cada
 * variable está o no: los valores nunca se leen para mostrarse.
 */
export default function Configurar() {
  const lista = integraciones();
  const pendientes = lista.filter((i) => i.configurada === false && !i.opcional).length;
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 px-5 py-10">
      <header>
        <h1 className="titulo-pagina">
          {supabaseConfigurado ? "Estado de las integraciones" : "Falta conectar la base de datos"}
        </h1>
        <p className="mt-1 text-sm text-texto-2">
          {supabaseConfigurado
            ? pendientes
              ? `Hay ${pendientes} ${pendientes === 1 ? "integración pendiente" : "integraciones pendientes"}. La app funciona igual; lo que dependa de ellas avisa que falta configurar.`
              : "Todo lo necesario está configurado."
            : "Este despliegue no tiene las variables de Supabase. Cargalas en Vercel y volvé a desplegar."}{" "}
          Los pasos de cada una están en el archivo <code className="font-mono text-[13px] text-texto">CREDENCIALES.md</code>.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {lista.map((i) => (
          <li key={i.id} className="flex gap-3 rounded-lg border border-borde bg-panel px-4 py-3">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                i.configurada === true ? "bg-ok-suave text-ok" : i.configurada === null ? "bg-elevado text-texto-3" : "bg-elevado text-aviso"
              }`}
            >
              {i.configurada === true ? <Check size={13} aria-hidden /> : i.configurada === null ? <Minus size={13} aria-hidden /> : <CircleDashed size={13} aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                {i.nombre}
                <span className={`text-xs font-normal ${i.configurada === true ? "text-ok" : "text-texto-3"}`}>
                  {i.configurada === true
                    ? "Configurada"
                    : i.configurada === null
                      ? "No se puede comprobar desde acá"
                      : i.opcional
                        ? "Pendiente (opcional)"
                        : "Pendiente"}
                </span>
              </p>
              <p className="mt-0.5 text-[13px] text-texto-2">{i.paraQue}</p>
              {i.variables.length ? (
                <p className="mt-1 break-words font-mono text-[11px] text-texto-3">{i.variables.join(" · ")}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {supabaseConfigurado ? (
        <Link href="/hoy" className="self-start rounded-sm text-sm font-medium text-acento hover:text-acento-fuerte">
          Volver a la app
        </Link>
      ) : null}
    </main>
  );
}
