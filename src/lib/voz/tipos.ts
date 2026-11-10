/**
 * Interfaz del proveedor de voz. La pantalla de llamada habla con esto y no
 * sabe si detrás está Azure o el navegador: para cambiar de servicio se
 * escribe otra implementación y nada más.
 */
export type AlTexto = (texto: string, final: boolean) => void;

export interface ProveedorVoz {
  readonly id: "azure" | "navegador" | "prueba";
  /** Empieza a reconocer de forma continua. Cada frase llega primero parcial y después final. */
  escuchar(alTexto: AlTexto, alError: (mensaje: string) => void): Promise<void>;
  /** Deja de reconocer: mientras tanto no se envía audio a ningún lado. */
  pausar(): Promise<void>;
  /** Dice un texto. Termina cuando acabó de sonar o cuando se lo calló. */
  hablar(texto: string): Promise<void>;
  /** Corta lo que esté sonando. */
  callar(): void;
  cerrar(): void;
  /** Segundos de reconocimiento que cuentan para el cupo, desde la última consulta. */
  segundosNuevos(): number;
}

export const VOCES: { id: string; nombre: string }[] = [
  { id: "es-UY-MateoNeural", nombre: "Mateo (Uruguay)" },
  { id: "es-UY-ValentinaNeural", nombre: "Valentina (Uruguay)" },
  { id: "es-AR-TomasNeural", nombre: "Tomás (Argentina)" },
  { id: "es-AR-ElenaNeural", nombre: "Elena (Argentina)" },
];
export const VOZ_POR_DEFECTO = VOCES[0].id;

export type RespuestaToken =
  | { azure: true; token: string; region: string; voz: string; aviso: boolean; porcentaje: number }
  | { azure: false; motivo: "sin_configurar" | "agotado" | "error" };
