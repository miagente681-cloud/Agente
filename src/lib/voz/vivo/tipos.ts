import type { Cambio } from "@/lib/agente/herramientas";
import type { LlamadaViva, RespuestaViva } from "./protocolo";

/** Lo que viaja entre la pantalla de llamada y el servidor en una llamada en vivo. */

/** Respuesta de /api/voice/vivo: los datos para conectarse, o por qué no se puede. */
export type RespuestaSesionViva =
  | {
      vivo: true;
      /** Dirección del WebSocket, con un token de un solo uso y de pocos minutos. */
      url: string;
      /** Ajustes de la sesión (modelo, instrucciones, herramientas, voz). Van fijados en el token. */
      ajustes: unknown;
      modelo: string;
      /** Lo primero que hay que mandarle para que el Agente abra la conversación, si le toca. */
      apertura: string | null;
    }
  | { vivo: false; motivo: "sin_configurar" | "limite" | "error" };

/** Pedido a /api/voice/vivo/turno: lo que se habló desde el último guardado y las herramientas que pide el Agente. */
export type PedidoTurnoVivo = {
  usuario?: string;
  agente?: string;
  llamadas?: LlamadaViva[];
};

export type ResultadoTurnoVivo = {
  respuestas: RespuestaViva[];
  cambios: Cambio[];
  /** La persona pidió terminar: la llamada se corta cuando el Agente termina de despedirse. */
  terminar: boolean;
};

/** Voces del servicio en vivo que se ofrecen en Configuración. */
export const VOCES_VIVO: { id: string; nombre: string }[] = [
  { id: "Charon", nombre: "Charon (grave, serio)" },
  { id: "Orus", nombre: "Orus (grave, firme)" },
  { id: "Puck", nombre: "Puck (animado)" },
  { id: "Fenrir", nombre: "Fenrir (enérgico)" },
  { id: "Kore", nombre: "Kore (aguda, firme)" },
  { id: "Aoede", nombre: "Aoede (aguda, suave)" },
  { id: "Leda", nombre: "Leda (aguda, joven)" },
  { id: "Zephyr", nombre: "Zephyr (aguda, clara)" },
];
export const VOZ_VIVO_POR_DEFECTO = VOCES_VIVO[0].id;

// --- Preferencia guardada en el dispositivo -------------------------------------

/**
 * Cómo se hacen las llamadas en este dispositivo: «vivo» (audio continuo, se
 * puede hablar encima del Agente) o «turnos» (la voz y el dictado del
 * navegador, de a uno por vez).
 */
export type Motor = "vivo" | "turnos";
const CLAVE = "miagente.voz.motor";

export function leerMotor(): Motor {
  try {
    return window.localStorage.getItem(CLAVE) === "turnos" ? "turnos" : "vivo";
  } catch {
    return "vivo";
  }
}

export function guardarMotor(motor: Motor): void {
  try {
    window.localStorage.setItem(CLAVE, motor);
  } catch {
    // Sin almacenamiento, vale solo para esta vez.
  }
}
