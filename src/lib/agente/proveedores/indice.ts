import "server-only";
import type { ProveedorLLM } from "../tipos";
import { crearGemini } from "./gemini";
import { crearOllama } from "./ollama";
import { crearCompatibleOpenAI } from "./openai";

export const ORDEN_POR_DEFECTO = ["gemini", "groq", "ollama"];
export const NOMBRES_PROVEEDOR: Record<string, string> = {
  gemini: "Gemini",
  groq: "Groq",
  ollama: "Modelo local (Ollama)",
};

const env = (n: string) => (process.env[n] ?? "").trim();

function crear(id: string): ProveedorLLM | null {
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
export function proveedoresEnOrden(orden?: unknown): ProveedorLLM[] {
  const pedido = Array.isArray(orden) ? orden.filter((x): x is string => typeof x === "string") : [];
  const ids = [...new Set([...pedido, ...ORDEN_POR_DEFECTO])].filter((id) => id in NOMBRES_PROVEEDOR);
  return ids.map(crear).filter((p): p is ProveedorLLM => p !== null);
}
