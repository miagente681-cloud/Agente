import type { SupabaseClient } from "@supabase/supabase-js";
import { partesEnZona } from "@/lib/programacion/horarios";
import type { Uso } from "../tipos";
import { configClaude, problemaVigente } from "./config";
import { costoUSD, type UsoTokens } from "./precios";

/**
 * Gasto de Claude y tope mensual. El mes se cuenta en la zona horaria de la
 * persona: el 1.º de diciembre a las 0:30 en Montevideo ya es diciembre,
 * aunque en UTC todavía sea noviembre o ya sea otra hora.
 */

export const mesDe = (instante: Date, zona: string) => partesEnZona(instante, zona).fecha.slice(0, 7);
export const UMBRAL_AVISO = 0.8;

export type EstadoPresupuesto = {
  /** Si en esta sesión se puede usar Claude. */
  disponible: boolean;
  motivo: "sin_clave" | "problema" | "tope" | null;
  gastoMes: number;
  topeUSD: number;
  mes: string;
  /** Hay que decir una vez en el mes que se pasa a los gratuitos. */
  avisarTope: boolean;
};

/**
 * Decide si se usa Claude en esta sesión. Una sesión que ya empezó con Claude
 * la termina con Claude aunque se llegue al tope en el medio, para no cortar
 * una llamada: puede pasarse del tope por centavos.
 */
export function evaluarPresupuesto(p: {
  hayClave: boolean;
  agentConfig: Record<string, unknown>;
  gastoMes: number;
  mes: string;
  ahora: Date;
  sesionYaUsoClaude: boolean;
}): EstadoPresupuesto {
  const { topeUSD } = configClaude(p.agentConfig);
  const base = { gastoMes: p.gastoMes, topeUSD, mes: p.mes, avisarTope: false };
  if (!p.hayClave) return { ...base, disponible: false, motivo: "sin_clave" };
  if (problemaVigente(p.agentConfig, p.ahora)) return { ...base, disponible: false, motivo: "problema" };
  if (p.gastoMes >= topeUSD && !p.sesionYaUsoClaude) {
    return { ...base, disponible: false, motivo: "tope", avisarTope: p.agentConfig.claude_tope_avisado !== p.mes };
  }
  return { ...base, disponible: true, motivo: null };
}

/** Lo gastado en Claude en un mes (lo calcula la base: las filas ya guardan su costo). */
export async function gastoDelMes(sb: SupabaseClient, mes: string): Promise<number> {
  const { data } = await sb.from("llm_usage").select("cost_usd").eq("mes", mes).limit(10_000);
  return ((data ?? []) as { cost_usd: number | string }[]).reduce((t, f) => t + Number(f.cost_usd), 0);
}

/**
 * Guarda un pedido a Claude con su costo. Si con este pedido el mes pasa el
 * 80 % del tope por primera vez, lo marca y devuelve el aviso.
 */
export async function registrarUso(
  sb: SupabaseClient,
  p: { sesionId: string | null; modelo: string; uso: Uso; tokens: UsoTokens; zona: string; ahora?: Date },
): Promise<{ costo: number; aviso80: { gasto: number; tope: number } | null }> {
  const ahora = p.ahora ?? new Date();
  const mes = mesDe(ahora, p.zona);
  const costo = costoUSD(p.modelo, p.tokens);
  await sb.from("llm_usage").insert({
    session_id: p.sesionId,
    provider: "claude",
    model: p.modelo,
    uso: p.uso,
    mes,
    input_tokens: p.tokens.entrada,
    output_tokens: p.tokens.salida,
    cache_write_5m_tokens: p.tokens.cache5m,
    cache_write_1h_tokens: p.tokens.cache1h,
    cache_read_tokens: p.tokens.lectura,
    cost_usd: Number(costo.toFixed(6)),
  });

  const { data: perfil } = await sb.from("profiles").select("user_id,agent_config").maybeSingle();
  const config = ((perfil as { agent_config?: Record<string, unknown> } | null)?.agent_config ?? {}) as Record<string, unknown>;
  const { topeUSD } = configClaude(config);
  if (!perfil || topeUSD <= 0 || config.claude_aviso_80 === mes) return { costo, aviso80: null };
  const gasto = await gastoDelMes(sb, mes);
  if (gasto < topeUSD * UMBRAL_AVISO) return { costo, aviso80: null };
  // Se marca antes de avisar: si dos pedidos cruzan juntos, a lo sumo se avisa dos veces, nunca todo el mes.
  await sb
    .from("profiles")
    .update({ agent_config: { ...config, claude_aviso_80: mes } })
    .eq("user_id", (perfil as { user_id: string }).user_id);
  return { costo, aviso80: { gasto, tope: topeUSD } };
}

export const formatoUSD = (n: number) =>
  `US$ ${n.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 0.1 ? 4 : 2 })}`;
