"use client";

import { useEffect, useState } from "react";
import { Campo, Selector } from "@/components/ui/campo";
import { Etiqueta, Tarjeta } from "@/components/ui/varios";
import { estadoApp, type EstadoApp } from "@/lib/agente/cliente";
import { useDatos } from "@/lib/datos/almacen";
import { usePerfil } from "@/lib/datos/perfil";
import { supabaseBrowser } from "@/lib/supabase/client";
import { evaluarCupo } from "@/lib/voz/cupo";
import { VOCES, VOZ_POR_DEFECTO } from "@/lib/voz/tipos";

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

/** Voz del Agente y uso del cupo gratuito de Azure en el mes. */
export function ConfigVoz() {
  const { avisar } = useDatos();
  const { perfil, guardarConfig } = usePerfil();
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  const [uso, setUso] = useState<{ stt_seconds: number; tts_chars: number } | null>(null);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const mes = new Date().toISOString().slice(0, 7) + "-01";
      const [e, u] = await Promise.all([
        estadoApp(),
        supabaseBrowser().from("voice_usage").select("stt_seconds,tts_chars").eq("month", mes).maybeSingle(),
      ]);
      if (!vigente) return;
      setEstado(e);
      setUso(u.data as { stt_seconds: number; tts_chars: number } | null);
    })();
    return () => {
      vigente = false;
    };
  }, []);

  const voz = typeof perfil?.agent_config.voz === "string" ? perfil.agent_config.voz : VOZ_POR_DEFECTO;
  const cupo = estado ? evaluarCupo(uso, estado.cupos) : null;

  return (
    <Tarjeta>
      <h2 className="rotulo mb-1 flex items-center gap-2">
        Voz
        {estado ? <Etiqueta tono={estado.azure ? "ok" : "neutro"}>{estado.azure ? "Azure configurado" : "Voz del navegador"}</Etiqueta> : null}
      </h2>
      <p className="mb-4 text-sm text-texto-2">
        {estado?.azure
          ? "Las llamadas usan Azure Speech dentro del cupo gratuito. Si se agota, siguen con la voz del navegador o por texto."
          : "Azure Speech no está configurado: las llamadas usan el reconocimiento y la voz propios del navegador, que no tienen cupo pero suenan peor y no andan en todos los navegadores."}
      </p>
      <div className="flex flex-col gap-4">
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
        {estado?.azure && cupo ? (
          <div className="flex flex-col gap-3">
            <Barra
              etiqueta="Escucha este mes"
              detalle={`${Math.round((uso?.stt_seconds ?? 0) / 60)} de ${Math.round(estado.cupos.sttSegundos / 60)} min`}
              porcentaje={cupo.stt}
            />
            <Barra
              etiqueta="Voz este mes"
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
