import type { Uso } from "../tipos";
import { modeloClaude } from "./precios";

/** Qué modelo de Claude responde cada uso, y el tope de gasto. Se guarda en `profiles.agent_config`. */

export const USOS: { id: Uso; nombre: string; detalle: string }[] = [
  { id: "chat", nombre: "Chat", detalle: "El día a día, por escrito o hablando." },
  { id: "llamada", nombre: "Llamadas programadas", detalle: "Las de tus rutinas, por voz o por texto." },
  { id: "entrevista", nombre: "Entrevista inicial", detalle: "Se hace una vez y arma tu perfil." },
  { id: "fondo", nombre: "Tareas de fondo", detalle: "Resumir cada sesión y anotar lo que aprende." },
];

export const MODELOS_POR_DEFECTO: Record<Uso, string> = {
  chat: "claude-haiku-5-5",
  llamada: "claude-sonnet-5-5",
  entrevista: "claude-sonnet-5-5",
  fondo: "claude-haiku-5-5",
};

/** Tope del despliegue (todos los usuarios juntos) si no se carga CLAUDE_TOPE_USD_GLOBAL. */
export const TOPE_POR_DEFECTO_USD = 10;
/**
 * Una sesión que ya empezó con Claude puede pasarse del tope para no cortar
 * una llamada, pero como mucho este margen (20 %); después se corta igual.
 */
export const MARGEN_SESION_EN_CURSO = 1.2;

/** Tope de gasto mensual del despliegue, sumando a todos los usuarios. */
export function topeGlobalDe(env: Record<string, string | undefined> = process.env): number {
  const crudo = (env.CLAUDE_TOPE_USD_GLOBAL ?? "").trim();
  const n = Number(crudo);
  return crudo !== "" && Number.isFinite(n) && n >= 0 ? n : TOPE_POR_DEFECTO_USD;
}
/** Después de una clave inválida o falta de crédito, no se vuelve a probar por este tiempo. */
export const PAUSA_POR_PROBLEMA_MS = 60 * 60_000;

export type ConfigClaude = {
  modelos: Record<Uso, string>;
  /** Tope de esta persona: el del perfil, que nunca supera el del despliegue. */
  topeUSD: number;
  /** Si la persona eligió un tope propio (más bajo que el global). */
  topePropio: boolean;
};

/**
 * Lo que la persona eligió. El tope del perfil lo puede escribir ella misma
 * desde el navegador, así que solo sirve para bajar su límite: nunca supera
 * el tope global del despliegue.
 */
export function configClaude(
  agentConfig: Record<string, unknown> | null | undefined,
  topeGlobal: number = TOPE_POR_DEFECTO_USD,
): ConfigClaude {
  const guardados = (agentConfig?.claude_modelos ?? {}) as Record<string, unknown>;
  const modelos = { ...MODELOS_POR_DEFECTO };
  for (const uso of Object.keys(modelos) as Uso[]) {
    const elegido = guardados[uso];
    // Solo modelos de la lista cerrada: un valor raro vuelve al de por defecto.
    if (typeof elegido === "string" && modeloClaude(elegido)) modelos[uso] = elegido;
  }
  const crudo = agentConfig?.claude_tope_usd;
  const tope = typeof crudo === "number" || typeof crudo === "string" ? Number(crudo) : NaN;
  const valido = crudo !== "" && crudo !== null && Number.isFinite(tope) && tope >= 0;
  return {
    modelos,
    topeUSD: valido ? Math.min(tope, topeGlobal) : topeGlobal,
    topePropio: valido && tope < topeGlobal,
  };
}

export type ProblemaClaude = { tipo: "clave" | "credito"; desde: string };

export function problemaVigente(agentConfig: Record<string, unknown> | null | undefined, ahora: Date): ProblemaClaude | null {
  const p = agentConfig?.claude_problema as ProblemaClaude | undefined;
  if (!p || (p.tipo !== "clave" && p.tipo !== "credito") || !p.desde) return null;
  return ahora.getTime() - new Date(p.desde).getTime() < PAUSA_POR_PROBLEMA_MS ? p : null;
}

/** Uso de cada tipo de sesión. Se elige por el tipo, no por el canal: una llamada escrita sigue siendo una llamada. */
export function usoDeSesion(kind: string): Uso {
  if (kind === "llamada_programada") return "llamada";
  if (kind === "onboarding") return "entrevista";
  return "chat";
}
