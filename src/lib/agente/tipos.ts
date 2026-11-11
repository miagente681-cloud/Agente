/**
 * Interfaz del modelo de lenguaje. Todo el Agente habla con esto y nunca con
 * un proveedor en particular: para cambiar de modelo (o pasar a uno pago) se
 * escribe otro adaptador y nada más.
 */

export type LlamadaHerramienta = {
  id: string;
  nombre: string;
  argumentos: unknown;
  /** Datos propios del proveedor que hay que devolverle tal cual (la firma de Gemini). */
  extra?: Record<string, unknown>;
  /**
   * Datos del proveedor que valen solo dentro del turno en curso (los bloques
   * de razonamiento de Claude). No se guardan en la base: en los turnos
   * siguientes la conversación viaja sin ellos.
   */
  extraTurno?: Record<string, unknown>;
};

/** Para qué se usa el modelo: decide qué modelo de Claude responde. */
export type Uso = "chat" | "llamada" | "entrevista" | "fondo";

export type MensajeLLM =
  | { rol: "usuario"; texto: string }
  | { rol: "agente"; texto: string; llamadas?: LlamadaHerramienta[] }
  | { rol: "herramienta"; id: string; nombre: string; resultado: unknown };

export type DefHerramienta = {
  nombre: string;
  descripcion: string;
  /** JSON Schema estándar del objeto de argumentos. */
  parametros: Record<string, unknown>;
};

export type Trozo =
  | { tipo: "texto"; texto: string }
  | { tipo: "llamada"; llamada: LlamadaHerramienta }
  | { tipo: "uso"; entrada: number; salida: number }
  /** Un aviso para mostrarle a la persona (por ejemplo, el 80 % del presupuesto de Claude). */
  | { tipo: "aviso"; mensaje: string };

export type PedidoLLM = {
  sistema: string;
  /**
   * El mismo sistema, partido de lo más estable a lo menos estable
   * (instrucciones; memorias y estado). Claude lo usa para el caché de prompts;
   * los demás proveedores usan `sistema`.
   */
  sistemaPartes?: string[];
  mensajes: MensajeLLM[];
  herramientas?: DefHerramienta[];
  /** Tareas de fondo (resumir, extraer memorias): usa el modelo liviano si hay. */
  liviano?: boolean;
  /** Para qué es el pedido. Si falta: «fondo» con `liviano`, «chat» sin. */
  uso?: Uso;
  /** Conversación de voz: los turnos van seguidos (decide la duración del caché). */
  voz?: boolean;
  senal?: AbortSignal;
};

export interface ProveedorLLM {
  /** "gemini", "groq", "ollama"… Se guarda en cada mensaje. */
  readonly id: string;
  modelo(uso?: Uso): string;
  generar(pedido: PedidoLLM): AsyncGenerator<Trozo>;
}

export type ClaseError =
  | "limite" // 429: se acabó el cupo
  | "clave" // la clave no sirve (401/403)
  | "credito" // sin crédito, o se llegó al límite de gasto de la consola
  | "sin_respuesta" // no contestó a tiempo o no se pudo conectar
  | "invalido" // respondió algo que no se puede usar
  | "otro";

export class ErrorProveedor extends Error {
  constructor(
    readonly proveedor: string,
    readonly clase: ClaseError,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorProveedor";
  }
}

export const usoDe = (pedido: Pick<PedidoLLM, "uso" | "liviano">): Uso =>
  pedido.uso ?? (pedido.liviano ? "fondo" : "chat");
