import type { Cambio } from "./herramientas";
import type { EventoTurno } from "./runner";

/** Lado del navegador: pide un turno y entrega los eventos a medida que llegan. */

export type { Cambio };
export type EventoCliente = EventoTurno | { tipo: "sesion"; id: string };

export type PedidoTurno = {
  sesionId?: string;
  texto?: string;
  inicio?: boolean;
  tipo?: "chat" | "onboarding";
  canal?: "voz" | "texto";
  voz?: "azure" | "navegador";
};

export async function* pedirTurno(pedido: PedidoTurno, senal?: AbortSignal): AsyncGenerator<EventoCliente> {
  let respuesta: Response;
  try {
    respuesta = await fetch("/api/agent/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pedido),
      signal: senal,
    });
  } catch {
    if (senal?.aborted) return;
    yield { tipo: "error", mensaje: "No hay conexión. Revisala y probá de nuevo." };
    return;
  }
  if (!respuesta.ok || !respuesta.body) {
    const mensaje =
      respuesta.status === 409
        ? "Esta sesión ya terminó. Empezá una nueva."
        : respuesta.status === 401
          ? "Se venció tu sesión. Volvé a ingresar."
          : "No se pudo enviar. Probá de nuevo.";
    yield { tipo: "error", mensaje };
    return;
  }
  const lector = respuesta.body.getReader();
  const decodificador = new TextDecoder();
  let pendiente = "";
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      pendiente += decodificador.decode(value, { stream: true });
      let corte: number;
      while ((corte = pendiente.indexOf("\n\n")) !== -1) {
        const bloque = pendiente.slice(0, corte);
        pendiente = pendiente.slice(corte + 2);
        if (bloque.startsWith("data: ")) yield JSON.parse(bloque.slice(6)) as EventoCliente;
      }
    }
  } catch {
    if (!senal?.aborted) yield { tipo: "error", mensaje: "Se cortó la conexión a mitad de la respuesta." };
  }
}

export type EstadoApp = {
  agente: boolean;
  claude: boolean;
  proveedores: { id: string; nombre: string; modelo: string }[];
  azure: boolean;
  push: boolean;
  cron: boolean;
  servicio: boolean;
  vapid: string;
  cupos: { sttSegundos: number; ttsCaracteres: number };
};

let estadoEnCurso: Promise<EstadoApp | null> | null = null;
/** Qué integraciones tiene configuradas el servidor (se pide una vez por carga). */
export function estadoApp(): Promise<EstadoApp | null> {
  estadoEnCurso ??= fetch("/api/estado")
    .then((r) => (r.ok ? (r.json() as Promise<EstadoApp>) : null))
    .catch(() => null);
  return estadoEnCurso;
}

export const NOMBRE_PROVEEDOR: Record<string, string> = {
  claude: "Claude",
  gemini: "Gemini",
  groq: "Groq",
  ollama: "tu modelo local",
};

const MOTIVO: Record<string, string> = {
  limite: "llegó a su límite",
  sin_respuesta: "no respondió",
  invalido: "respondió mal",
  clave: "tiene un problema con la clave",
  credito: "se quedó sin crédito",
  otro: "falló",
};
export const fraseCambioProveedor = (de: string, motivo: string) =>
  `${(NOMBRE_PROVEEDOR[de] ?? de).replace(/^./, (c) => c.toUpperCase())} ${MOTIVO[motivo] ?? "falló"}; sigue el siguiente.`;

/** Nombre legible de un modelo: «Claude Haiku 5.5», o el identificador tal cual para los demás. */
export function nombreModelo(proveedor: string | null | undefined, modelo: string | null | undefined): string {
  if (!modelo) return NOMBRE_PROVEEDOR[proveedor ?? ""] ?? proveedor ?? "";
  const claude = /^claude-(haiku|sonnet|opus)-(\d+)-(\d+)$/.exec(modelo);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}.${claude[3]}`;
  return `${NOMBRE_PROVEEDOR[proveedor ?? ""] ?? proveedor} · ${modelo}`;
}
