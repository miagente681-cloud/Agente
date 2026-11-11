"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Etiqueta, Tarjeta } from "@/components/ui/varios";
import { estadoApp, type EstadoApp } from "@/lib/agente/cliente";
import { useDatos } from "@/lib/datos/almacen";
import { usePerfil } from "@/lib/datos/perfil";
import { ConfigClaude } from "./claude";

const PROVEEDORES: { id: string; nombre: string; detalle: string }[] = [
  { id: "claude", nombre: "Claude", detalle: "API de Anthropic. Pago, con tope mensual." },
  { id: "gemini", nombre: "Gemini", detalle: "Google, nivel gratuito." },
  { id: "groq", nombre: "Groq", detalle: "Plan gratuito. Más rápido, con un cupo por minuto chico." },
  { id: "ollama", nombre: "Modelo local (Ollama)", detalle: "En tu computadora: sin límites y sin que los datos salgan de ella. Solo responde si está prendida." },
];

/** Orden de los modelos del Agente y aviso de privacidad. */
export function ConfigAgente() {
  const { avisar } = useDatos();
  const { perfil, guardarConfig } = usePerfil();
  const [estado, setEstado] = useState<EstadoApp | null>(null);

  useEffect(() => {
    let vigente = true;
    void estadoApp().then((e) => vigente && setEstado(e));
    return () => {
      vigente = false;
    };
  }, []);

  const guardado = Array.isArray(perfil?.agent_config.orden_proveedores)
    ? (perfil.agent_config.orden_proveedores as string[])
    : [];
  // Como en el servidor: un orden guardado antes de que existiera Claude lo pone primero.
  const conClaude = guardado.length && !guardado.includes("claude") ? ["claude", ...guardado] : guardado;
  const orden = [...new Set([...conClaude, ...PROVEEDORES.map((p) => p.id)])].filter((id) =>
    PROVEEDORES.some((p) => p.id === id),
  );
  const configurados = new Set(estado?.proveedores.map((p) => p.id));

  async function mover(i: number, delta: number) {
    const nuevo = [...orden];
    [nuevo[i], nuevo[i + delta]] = [nuevo[i + delta], nuevo[i]];
    if (!(await guardarConfig({ orden_proveedores: nuevo }))) avisar("No se pudo guardar el orden.");
  }

  return (
    <Tarjeta>
      <h2 className="rotulo mb-1">Cerebro del Agente</h2>
      <p className="mb-4 text-sm text-texto-2">
        El Agente usa el primero de la lista. Si llega a su límite o no responde, sigue con el siguiente sin cortar
        la conversación. En cada sesión se ve cuál respondió.
      </p>
      <ol className="flex flex-col gap-2">
        {orden.map((id, i) => {
          const p = PROVEEDORES.find((x) => x.id === id)!;
          const listo = configurados.has(id);
          return (
            <li key={id} className="flex items-center gap-3 rounded-md border border-borde px-3 py-2.5">
              <span className="font-mono text-xs text-texto-3">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {p.nombre}
                  {estado ? (
                    <Etiqueta tono={listo ? "ok" : "neutro"}>{listo ? "Configurado" : "Falta configurar"}</Etiqueta>
                  ) : null}
                </p>
                <p className="text-[13px] text-texto-3">
                  {p.detalle}
                  {listo ? ` Modelo: ${estado?.proveedores.find((x) => x.id === id)?.modelo}.` : ""}
                </p>
              </div>
              <div className="flex shrink-0">
                <button
                  type="button"
                  aria-label={`Subir ${p.nombre}`}
                  disabled={i === 0 || !perfil}
                  onClick={() => void mover(i, -1)}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-texto-2 hover:bg-elevado hover:text-texto disabled:opacity-30"
                >
                  <ArrowUp size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Bajar ${p.nombre}`}
                  disabled={i === orden.length - 1 || !perfil}
                  onClick={() => void mover(i, 1)}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-texto-2 hover:bg-elevado hover:text-texto disabled:opacity-30"
                >
                  <ArrowDown size={15} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {estado && !estado.agente ? (
        <p className="mt-3 text-sm text-aviso">
          Ninguno está configurado todavía: el chat y las llamadas no van a responder.{" "}
          <Link href="/configurar" className="font-medium underline">
            Ver qué falta
          </Link>
        </p>
      ) : null}
      <ConfigClaude />
      <div className="mt-4 rounded-md border border-borde bg-fondo px-3 py-2.5 text-[13px] text-texto-2">
        <p className="font-medium text-texto">Privacidad</p>
        <p className="mt-1">
          En el nivel gratuito de Gemini, Google indica que el contenido que se envía puede usarse para mejorar sus
          productos. El Agente manda solo lo necesario: un resumen de tus proyectos y tareas, lo que sabe de vos y
          la conversación. Si querés que nada salga de tu computadora, poné el modelo local primero.
        </p>
      </div>
    </Tarjeta>
  );
}
