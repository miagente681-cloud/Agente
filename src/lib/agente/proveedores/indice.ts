import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ProveedorLLM } from "../tipos";
import { crearClaude, type ConfigAdaptadorClaude } from "./claude";
import { crearGemini } from "./gemini";
import { crearOllama } from "./ollama";
import { crearCompatibleOpenAI } from "./openai";

export const ORDEN_POR_DEFECTO = ["claude", "gemini", "groq", "ollama"];
export const NOMBRES_PROVEEDOR: Record<string, string> = {
  claude: "Claude",
  gemini: "Gemini",
  groq: "Groq",
  ollama: "Modelo local (Ollama)",
};

const env = (n: string) => (process.env[n] ?? "").trim();

export const hayClaveClaude = () => env("ANTHROPIC_API_KEY") !== "";

/**
 * Cliente del SDK oficial. La clave sale de la variable de entorno y nunca se
 * escribe en ningún lado. Sin reintentos: si Claude falla, responde el
 * siguiente proveedor en lugar de hacer esperar a la persona.
 */
export function clienteClaude(): Anthropic {
  return new Anthropic({
    apiKey: env("ANTHROPIC_API_KEY"),
    // Solo para las pruebas: apunta el SDK a un servidor de mentira.
    ...(env("ANTHROPIC_BASE_URL") ? { baseURL: env("ANTHROPIC_BASE_URL") } : {}),
    maxRetries: 0,
    timeout: 90_000,
  });
}

export type OpcionesClaude = Omit<ConfigAdaptadorClaude, "cliente">;

function crear(id: string, claude: OpcionesClaude | null): ProveedorLLM | null {
  if (id === "claude") {
    // Solo si hay clave y el presupuesto del mes lo permite (lo decide quien llama).
    return hayClaveClaude() && claude ? crearClaude({ cliente: clienteClaude(), ...claude }) : null;
  }
  if (id === "gemini" && env("GEMINI_API_KEY")) {
    return crearGemini({
      clave: env("GEMINI_API_KEY"),
      // Los nombres cambian seguido: se ajustan por variable de entorno.
      modeloChat: env("GEMINI_MODEL_CHAT") || "gemini-3.6-flash",
      modeloFondo: env("GEMINI_MODEL_FONDO") || "gemini-3.5-flash-lite",
      baseUrl: env("GEMINI_BASE_URL"),
    });
  }
  if (id === "groq" && env("GROQ_API_KEY")) {
    return crearCompatibleOpenAI({
      id: "groq",
      clave: env("GROQ_API_KEY"),
      modelo: env("GROQ_MODEL") || "openai/gpt-oss-120b",
      baseUrl: env("GROQ_BASE_URL") || "https://api.groq.com/openai/v1",
    });
  }
  if (id === "ollama" && env("OLLAMA_BASE_URL") && env("OLLAMA_MODEL")) {
    return crearOllama({
      baseUrl: env("OLLAMA_BASE_URL"),
      modelo: env("OLLAMA_MODEL"),
      token: env("OLLAMA_AUTH_TOKEN"),
      primerByteMs: Number(env("OLLAMA_TIMEOUT_MS")) || undefined,
    });
  }
  return null;
}

/** Proveedores configurados, en el orden que eligió el usuario. */
export function ordenEfectivo(orden?: unknown): string[] {
  const pedido = Array.isArray(orden) ? orden.filter((x): x is string => typeof x === "string") : [];
  // Un orden guardado antes de que existiera Claude no lo trae: va primero, como el orden por defecto.
  const conClaude = pedido.length && !pedido.includes("claude") ? ["claude", ...pedido] : pedido;
  return [...new Set([...conClaude, ...ORDEN_POR_DEFECTO])].filter((id) => id in NOMBRES_PROVEEDOR);
}

/** Proveedores configurados, en el orden que eligió el usuario. Claude, solo con sus opciones. */
export function proveedoresEnOrden(orden?: unknown, claude: OpcionesClaude | null = null): ProveedorLLM[] {
  return ordenEfectivo(orden)
    .map((id) => crear(id, claude))
    .filter((p): p is ProveedorLLM => p !== null);
}
