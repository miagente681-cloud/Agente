"use client";

import { useEffect, useState } from "react";
import { Campo, Selector } from "@/components/ui/campo";
import { Etiqueta, Tarjeta } from "@/components/ui/varios";
import { estadoApp, type EstadoApp } from "@/lib/agente/cliente";
import { useDatos } from "@/lib/datos/almacen";
import { usePerfil } from "@/lib/datos/perfil";
import { evaluarCupo } from "@/lib/voz/cupo";
import { guardarSensibilidad, leerSensibilidad, SENSIBILIDADES, type Sensibilidad } from "@/lib/voz/deteccion";
import { VOCES, VOZ_POR_DEFECTO } from "@/lib/voz/tipos";
import { guardarMotor, leerMotor, VOCES_VIVO, VOZ_VIVO_POR_DEFECTO, type Motor } from "@/lib/voz/vivo/tipos";

function Barra({ etiqueta, detalle, porcentaje }: { etiqueta: string; detalle: string; porcentaje: number }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex justify-between text-[13px]">
        <span className="text-texto-2">{etiqueta}</span>
        <span className="font-mono text-xs text-texto-3">{detalle}</span>
      </p>
      <div role="progressbar" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100} aria-valuenow={porcentaje} className="h-1.5 overflow-hidden rounded-full bg-borde">
        <div className={`h-full rounded-full ${porcentaje >= 90 ? "bg-peligro" : "bg-acento"}`} style={{ width: `${porcentaje}%` }} />
      </div>
    </div>
  );
}

/** Cómo son las llamadas (en vivo o por turnos), la voz del Agente y el uso del cupo gratuito de Azure. */
export function ConfigVoz() {
  const { avisar } = useDatos();
  const { perfil, guardarConfig } = usePerfil();
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  // Se guarda en este dispositivo: cada micrófono y cada parlante son distintos.
  const [sensibilidad, setSensibilidad] = useState<Sensibilidad | null>(null);
  const [motor, setMotor] = useState<Motor | null>(null);

  useEffect(() => {
    let vigente = true;
    void estadoApp().then((e) => vigente && setEstado(e));
    void Promise.resolve().then(() => {
      if (!vigente) return;
      setSensibilidad(leerSensibilidad());
      setMotor(leerMotor());
    });
    return () => {
      vigente = false;
    };
  }, []);

  const voz = typeof perfil?.agent_config.voz === "string" ? perfil.agent_config.voz : VOZ_POR_DEFECTO;
  const vozVivo = VOCES_VIVO.some((v) => v.id === perfil?.agent_config.voz_vivo) ? (perfil?.agent_config.voz_vivo as string) : VOZ_VIVO_POR_DEFECTO;
  const enVivo = Boolean(estado?.vivo) && motor !== "turnos";
  // El cupo es uno solo para todo el despliegue: solo lo ve quien lo administra.
  const uso = estado?.usoVoz ?? null;
  const cupo = estado?.cupos ? evaluarCupo(uso, estado.cupos) : null;

  return (
    <Tarjeta>
      <h2 className="rotulo mb-1 flex items-center gap-2">
        Voz
        {estado ? (
          <Etiqueta tono={enVivo || estado.azure ? "ok" : "neutro"}>
            {enVivo ? "Llamada en vivo" : estado.azure ? "Azure configurado" : "Voz del navegador"}
          </Etiqueta>
        ) : null}
      </h2>
      <p className="mb-4 text-sm text-texto-2">
        {enVivo
          ? "Las llamadas son en vivo: el micrófono queda abierto todo el tiempo y podés hablarle encima al Agente, como por teléfono. Si no se puede conectar, la llamada sigue por turnos."
          : estado?.azure
            ? "Las llamadas usan Azure Speech dentro del cupo gratuito. Si se agota, siguen con la voz del navegador o por texto."
            : "Azure Speech no está configurado: las llamadas usan el reconocimiento y la voz propios del navegador, de a un turno por vez, que no tienen cupo pero suenan peor y no andan en todos los navegadores."}
      </p>
      <div className="flex flex-col gap-4">
        {estado?.vivo ? (
          <>
            <Campo
              etiqueta="Cómo son las llamadas en este dispositivo"
              htmlFor="voz-motor"
              ayuda="En vivo, la voz la pone Gemini (gratis, con un límite diario) y el audio de la llamada lo procesa Google. Por turnos, todo queda en la voz y el dictado del navegador."
            >
              <Selector
                id="voz-motor"
                value={motor ?? "vivo"}
                disabled={motor === null}
                onChange={(e) => {
                  const nuevo = e.target.value as Motor;
                  setMotor(nuevo);
                  guardarMotor(nuevo);
                }}
              >
                <option value="vivo">En vivo: como una llamada (recomendado)</option>
                <option value="turnos">Por turnos: habla uno por vez</option>
              </Selector>
            </Campo>
            <Campo etiqueta="Voz del Agente (en vivo)" htmlFor="voz-vivo">
              <Selector
                id="voz-vivo"
                value={vozVivo}
                disabled={!perfil}
                onChange={async (e) => {
                  if (!(await guardarConfig({ voz_vivo: e.target.value }))) avisar("No se pudo guardar la voz.");
                }}
              >
                {VOCES_VIVO.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}
                  </option>
                ))}
              </Selector>
            </Campo>
          </>
        ) : null}
        <Campo
          etiqueta="Interrumpir al Agente hablando"
          htmlFor="voz-interrupcion"
          ayuda="Mientras el Agente habla, si empezás a hablar se calla y te escucha. Vale para este dispositivo. Con auriculares anda mejor."
        >
          <Selector
            id="voz-interrupcion"
            value={sensibilidad ?? "normal"}
            disabled={sensibilidad === null}
            onChange={(e) => {
              const nueva = e.target.value as Sensibilidad;
              setSensibilidad(nueva);
              guardarSensibilidad(nueva);
            }}
          >
            {SENSIBILIDADES.map((x) => (
              <option key={x.valor} value={x.valor}>
                {x.nombre}
              </option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Voz del Agente (Azure)" htmlFor="voz-agente" ayuda={estado?.azure ? undefined : "Se va a usar cuando configures Azure."}>
          <Selector
            id="voz-agente"
            value={voz}
            disabled={!perfil}
            onChange={async (e) => {
              if (!(await guardarConfig({ voz: e.target.value }))) avisar("No se pudo guardar la voz.");
            }}
          >
            {VOCES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre}
              </option>
            ))}
          </Selector>
        </Campo>
        {estado?.azure && cupo && estado.cupos ? (
          <div className="flex flex-col gap-3">
            <Barra
              etiqueta="Escucha este mes (todo el despliegue)"
              detalle={`${Math.round((uso?.stt_seconds ?? 0) / 60)} de ${Math.round(estado.cupos.sttSegundos / 60)} min`}
              porcentaje={cupo.stt}
            />
            <Barra
              etiqueta="Voz este mes (todo el despliegue)"
              detalle={`${(uso?.tts_chars ?? 0).toLocaleString("es-UY")} de ${estado.cupos.ttsCaracteres.toLocaleString("es-UY")} caracteres`}
              porcentaje={cupo.tts}
            />
            {cupo.agotado ? (
              <p className="text-[13px] text-peligro">Cupo agotado: hasta el mes que viene las llamadas usan la voz del navegador.</p>
            ) : cupo.aviso ? (
              <p className="text-[13px] text-aviso">Pasaste el 90 % del cupo gratuito de este mes.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Tarjeta>
  );
}
