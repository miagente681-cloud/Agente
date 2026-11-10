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
};

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
  | { tipo: "uso"; entrada: number; salida: number };

export type PedidoLLM = {
  sistema: string;
  mensajes: MensajeLLM[];
  herramientas?: DefHerramienta[];
  /** Tareas de fondo (resumir, extraer memorias): usa el modelo liviano si hay. */
  liviano?: boolean;
  senal?: AbortSignal;
};

export interface ProveedorLLM {
  /** "gemini", "groq", "ollama"… Se guarda en cada mensaje. */
  readonly id: string;
  modelo(liviano?: boolean): string;
  generar(pedido: PedidoLLM): AsyncGenerator<Trozo>;
}

export type ClaseError =
  | "limite" // 429: se acabó el cupo
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
