"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { estadoApp, type EstadoApp } from "@/lib/agente/cliente";
import { configClaude, problemaVigente, USOS } from "@/lib/agente/claude/config";
import { MODELOS_CLAUDE, modeloClaude } from "@/lib/agente/claude/precios";
import { formatoUSD, mesDe, UMBRAL_AVISO } from "@/lib/agente/claude/presupuesto";
import { useDatos } from "@/lib/datos/almacen";
import { usePerfil } from "@/lib/datos/perfil";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { ResultadoPrueba } from "@/app/api/claude/probar/route";

type FilaUso = { uso: string; model: string; cost_usd: number | string };

const NOMBRE_USO: Record<string, string> = Object.fromEntries(USOS.map((u) => [u.id, u.nombre]));

function sumar(filas: FilaUso[], clave: "uso" | "model") {
  const totales = new Map<string, number>();
  for (const f of filas) totales.set(f[clave], (totales.get(f[clave]) ?? 0) + Number(f.cost_usd));
  return [...totales.entries()].sort((a, b) => b[1] - a[1]);
}

/** Claude dentro de «Cerebro del Agente»: prueba de conexión, gasto del mes, tope y modelo de cada uso. */
export function ConfigClaude() {
  const { zona, avisar } = useDatos();
  const { perfil, guardarConfig } = usePerfil();
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  const [filas, setFilas] = useState<FilaUso[] | null>(null);
  const [prueba, setPrueba] = useState<ResultadoPrueba | null>(null);
  const [probando, setProbando] = useState(false);
  const mes = mesDe(new Date(), zona);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const [e, u] = await Promise.all([
        estadoApp(),
        supabaseBrowser().from("llm_usage").select("uso,model,cost_usd").eq("mes", mes).limit(10_000),
      ]);
      if (!vigente) return;
      setEstado(e);
      setFilas((u.data as FilaUso[] | null) ?? []);
    })();
    return () => {
      vigente = false;
    };
  }, [mes]);

  async function probar() {
    setProbando(true);
    const r = (await fetch("/api/claude/probar", { method: "POST" })
      .then((x) => x.json())
      .catch(() => ({ ok: false, motivo: "sin_respuesta", mensaje: "No hay conexión." }))) as ResultadoPrueba;
    setPrueba(r);
    setProbando(false);
  }

  if (!estado) return null;
  if (!estado.claude) {
    return (
      <div className="mt-4 rounded-md border border-borde px-3 py-2.5 text-[13px] text-texto-2">
        <p className="font-medium text-texto">Claude</p>
        <p className="mt-1">
          Falta cargar la clave (<code className="font-mono text-[12px]">ANTHROPIC_API_KEY</code>). Mientras tanto el
          Agente usa los modelos gratuitos.{" "}
          <Link href="/configurar" className="font-medium text-acento hover:text-acento-fuerte">
            Ver qué falta
          </Link>
        </p>
      </div>
    );
  }

  const config = configClaude(perfil?.agent_config);
  const gasto = (filas ?? []).reduce((t, f) => t + Number(f.cost_usd), 0);
  const porcentaje = config.topeUSD > 0 ? Math.min(100, (gasto / config.topeUSD) * 100) : 100;
  const problema = perfil ? problemaVigente(perfil.agent_config, new Date()) : null;
  const guardar = async (cambios: Record<string, unknown>) => {
    if (!(await guardarConfig(cambios))) avisar("No se pudo guardar.");
  };

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-md border border-borde px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Claude</p>
        <Boton tamano="sm" onClick={() => void probar()} disabled={probando}>
          {probando ? "Probando…" : "Probar conexión"}
        </Boton>
      </div>
      {prueba ? (
        <p role="status" className={`text-[13px] ${prueba.ok ? "text-ok" : "text-peligro"}`}>
          {prueba.ok ? `Anda: respondió ${modeloClaude(prueba.modelo)?.nombre ?? prueba.modelo} en ${prueba.ms} ms.` : prueba.mensaje}
        </p>
      ) : null}
      {problema && !prueba?.ok ? (
        <p role="alert" className="rounded-md border border-peligro/30 bg-peligro-suave px-3 py-2 text-[13px] text-peligro">
          {problema.tipo === "clave"
            ? "La clave de Claude no es válida. Mientras tanto responden los modelos gratuitos."
            : "La cuenta de Claude se quedó sin crédito o llegó al límite de gasto de la consola. Mientras tanto responden los modelos gratuitos."}{" "}
          Cuando lo arregles, tocá «Probar conexión».
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <p className="flex justify-between text-[13px]">
          <span className="text-texto-2">Gasto de este mes</span>
          <span className="font-mono text-xs text-texto-3">
            {formatoUSD(gasto)} de {formatoUSD(config.topeUSD)}
          </span>
        </p>
        <div role="progressbar" aria-label="Gasto de Claude este mes" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(porcentaje)} className="h-1.5 overflow-hidden rounded-full bg-borde">
          <div className={`h-full rounded-full ${porcentaje >= 100 ? "bg-peligro" : porcentaje >= UMBRAL_AVISO * 100 ? "bg-aviso" : "bg-acento"}`} style={{ width: `${porcentaje}%` }} />
        </div>
        {porcentaje >= 100 ? (
          <p className="text-[13px] text-peligro">Llegaste al tope: hasta el mes que viene responden los modelos gratuitos.</p>
        ) : porcentaje >= UMBRAL_AVISO * 100 ? (
          <p className="text-[13px] text-aviso">Pasaste el 80 % del tope de este mes.</p>
        ) : null}
        {filas?.length ? (
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
            <div>
              <p className="rotulo mb-1 !text-[11px]">Por uso</p>
              {sumar(filas, "uso").map(([k, v]) => (
                <p key={k} className="flex justify-between gap-2 text-texto-2">
                  <span>{NOMBRE_USO[k] ?? k}</span>
                  <span className="font-mono text-xs">{formatoUSD(v)}</span>
                </p>
              ))}
            </div>
            <div>
              <p className="rotulo mb-1 !text-[11px]">Por modelo</p>
              {sumar(filas, "model").map(([k, v]) => (
                <p key={k} className="flex justify-between gap-2 text-texto-2">
                  <span>{modeloClaude(k)?.nombre ?? k}</span>
                  <span className="font-mono text-xs">{formatoUSD(v)}</span>
                </p>
              ))}
            </div>
          </div>
        ) : null}
        <p className="text-xs text-texto-3">
          Es una estimación hecha con los precios publicados. El gasto real está en la consola de Claude (platform.claude.com).
        </p>
      </div>

      <Campo etiqueta="Tope mensual (US$)" htmlFor="claude-tope" ayuda="Al 80 % te aviso; al llegar, sigo con los modelos gratuitos hasta el mes que viene.">
        <Entrada
          id="claude-tope"
          type="number"
          min={0}
          step="0.5"
          key={`tope-${config.topeUSD}`}
          defaultValue={config.topeUSD}
          disabled={!perfil}
          onBlur={(e) => {
            const n = Math.max(0, Math.round(Number(e.target.value) * 100) / 100);
            if (Number.isFinite(n) && n !== config.topeUSD) void guardar({ claude_tope_usd: n });
          }}
        />
      </Campo>

      <div className="flex flex-col gap-3">
        <p className="text-[13px] font-medium text-texto-2">Modelo para cada uso</p>
        {USOS.map((u) => (
          <Campo key={u.id} etiqueta={u.nombre} htmlFor={`claude-modelo-${u.id}`} ayuda={u.detalle}>
            <Selector
              id={`claude-modelo-${u.id}`}
              value={config.modelos[u.id]}
              disabled={!perfil}
              onChange={(e) => void guardar({ claude_modelos: { ...config.modelos, [u.id]: e.target.value } })}
            >
              {MODELOS_CLAUDE.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre} · US$ {m.precio.entrada.toFixed(2).replace(".", ",")} / {m.precio.salida.toFixed(2).replace(".", ",")} por millón
                </option>
              ))}
            </Selector>
          </Campo>
        ))}
      </div>
    </div>
  );
}
