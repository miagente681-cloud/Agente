import type { SupabaseClient } from "@supabase/supabase-js";
import { partesEnZona } from "@/lib/programacion/horarios";
import type { Uso } from "../tipos";
import { configClaude, MARGEN_SESION_EN_CURSO, problemaVigente, TOPE_POR_DEFECTO_USD } from "./config";
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
  /** Lo gastado por esta persona en el mes. */
  gastoMes: number;
  /** Su tope: el del perfil, nunca más que el global. */
  topeUSD: number;
  /** Lo gastado por todo el despliegue en el mes, y su tope. */
  gastoGlobal: number;
  topeGlobal: number;
  mes: string;
  /** Hay que decir una vez en el mes que se pasa a los gratuitos. */
  avisarTope: boolean;
};

/**
 * Decide si se usa Claude en esta sesión. Corta al llegar al tope de la
 * persona o al global del despliegue, lo que pase primero. Una sesión que ya
 * usó Claude (según el registro de gasto, que solo escribe el servidor) sigue
 * con Claude para no cortar una llamada, pero como mucho un 20 % por encima.
 */
export function evaluarPresupuesto(p: {
  hayClave: boolean;
  agentConfig: Record<string, unknown>;
  gastoMes: number;
  gastoGlobal?: number;
  topeGlobal?: number;
  mes: string;
  ahora: Date;
  sesionYaUsoClaude: boolean;
}): EstadoPresupuesto {
  const topeGlobal = p.topeGlobal ?? TOPE_POR_DEFECTO_USD;
  const gastoGlobal = p.gastoGlobal ?? p.gastoMes;
  const { topeUSD } = configClaude(p.agentConfig, topeGlobal);
  const base = { gastoMes: p.gastoMes, topeUSD, gastoGlobal, topeGlobal, mes: p.mes, avisarTope: false };
  if (!p.hayClave) return { ...base, disponible: false, motivo: "sin_clave" };
  if (problemaVigente(p.agentConfig, p.ahora)) return { ...base, disponible: false, motivo: "problema" };
  const margen = p.sesionYaUsoClaude ? MARGEN_SESION_EN_CURSO : 1;
  const pasado = (gasto: number, tope: number) => tope <= 0 || gasto >= tope * margen;
  if (pasado(p.gastoMes, topeUSD) || pasado(gastoGlobal, topeGlobal)) {
    return { ...base, disponible: false, motivo: "tope", avisarTope: p.agentConfig.claude_tope_avisado !== p.mes };
  }
  return { ...base, disponible: true, motivo: null };
}

/**
 * Lo gastado en Claude en un mes, por la persona y por todo el despliegue. Lo
 * suma la base (función solo para la clave de servicio): no hay límite de
 * filas que deje la cuenta corta.
 */
export async function gastoDelMes(admin: SupabaseClient, userId: string, mes: string): Promise<{ propio: number; global: number }> {
  const { data, error } = await admin.rpc("gasto_claude_mes", { p_user: userId, p_mes: mes });
  // Si no se puede saber cuánto se gastó, se actúa como si se hubiera llegado al tope.
  if (error) return { propio: Number.POSITIVE_INFINITY, global: Number.POSITIVE_INFINITY };
  const fila = (Array.isArray(data) ? data[0] : data) as { propio: number | string; global: number | string } | null;
  return { propio: Number(fila?.propio ?? 0), global: Number(fila?.global ?? 0) };
}

/** ¿Esta sesión ya usó Claude? Se mira el registro de gasto, que solo escribe el servidor. */
export async function sesionUsoClaude(admin: SupabaseClient, userId: string, sesionId: string | null): Promise<boolean> {
  if (!sesionId) return false;
  const { data } = await admin.from("llm_usage").select("id").eq("user_id", userId).eq("session_id", sesionId).limit(1);
  return Boolean(data?.length);
}

/**
 * Guarda un pedido a Claude con su costo, con la clave de servicio y a nombre
 * de la persona. Si con este pedido se pasa el 80 % de su tope (o del global)
 * por primera vez en el mes, lo marca y devuelve el aviso.
 */
export async function registrarUso(
  admin: SupabaseClient,
  p: {
    userId: string;
    sesionId: string | null;
    modelo: string;
    uso: Uso;
    tokens: UsoTokens;
    zona: string;
    ahora?: Date;
    topeGlobal?: number;
  },
): Promise<{ costo: number; aviso80: { gasto: number; tope: number } | null }> {
  const ahora = p.ahora ?? new Date();
  const mes = mesDe(ahora, p.zona);
  const costo = costoUSD(p.modelo, p.tokens);
  await admin.from("llm_usage").insert({
    user_id: p.userId,
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

  const { data: perfil } = await admin.from("profiles").select("user_id,agent_config").eq("user_id", p.userId).maybeSingle();
  const config = ((perfil as { agent_config?: Record<string, unknown> } | null)?.agent_config ?? {}) as Record<string, unknown>;
  const topeGlobal = p.topeGlobal ?? TOPE_POR_DEFECTO_USD;
  const { topeUSD } = configClaude(config, topeGlobal);
  if (!perfil || topeUSD <= 0 || config.claude_aviso_80 === mes) return { costo, aviso80: null };
  const gasto = await gastoDelMes(admin, p.userId, mes);
  // Se avisa por el tope que esté más cerca: el propio o el de todo el despliegue.
  const propio = gasto.propio / topeUSD;
  const global = topeGlobal > 0 ? gasto.global / topeGlobal : 0;
  if (!Number.isFinite(propio) || Math.max(propio, global) < UMBRAL_AVISO) return { costo, aviso80: null };
  // Se marca antes de avisar: si dos pedidos cruzan juntos, a lo sumo se avisa dos veces, nunca todo el mes.
  await admin
    .from("profiles")
    .update({ agent_config: { ...config, claude_aviso_80: mes } })
    .eq("user_id", p.userId);
  return {
    costo,
    aviso80: propio >= global ? { gasto: gasto.propio, tope: topeUSD } : { gasto: gasto.global, tope: topeGlobal },
  };
}

export const formatoUSD = (n: number) =>
  `US$ ${n.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 0.1 ? 4 : 2 })}`;
