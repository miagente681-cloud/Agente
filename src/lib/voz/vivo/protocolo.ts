/**
 * El idioma de la API en vivo de Gemini (Live API), sin SDK: qué se manda por
 * el WebSocket y cómo se lee lo que llega. Es lógica pura (sin navegador ni
 * red), así se prueba con mensajes armados y la usan tanto la pantalla de
 * llamada como el servidor.
 *
 * La conversación es de audio en los dos sentidos: se manda el micrófono en
 * trozos de PCM de 16 bits a 16 kHz y llega la voz del Agente en PCM de 16
 * bits a 24 kHz. Quién habla lo decide el servicio escuchando el audio: si la
 * persona habla encima, avisa con «interrupted» y deja de generar.
 */

export const TASA_ENTRADA = 16_000;
export const TASA_SALIDA = 24_000;
export const RUTA_SOCKET = "/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export type LlamadaViva = { id: string; nombre: string; argumentos: unknown };
export type RespuestaViva = { id: string; nombre: string; resultado: unknown };

/** Lo que puede llegar del servicio, ya traducido. Un mensaje puede traer varios. */
export type EventoVivo =
  /** Aceptó los ajustes: desde acá se puede mandar audio. */
  | { tipo: "listo" }
  /** Un trozo de la voz del Agente (PCM de 16 bits en base64). */
  | { tipo: "audio"; datos: string; tasa: number }
  /** Lo que el servicio entendió de la persona. Llega en pedazos y puede llegar tarde. */
  | { tipo: "dijiste"; texto: string }
  /** Lo que el Agente va diciendo, en texto. */
  | { tipo: "dice"; texto: string }
  /** La persona habló encima: hay que callar lo que esté sonando. */
  | { tipo: "interrumpido" }
  | { tipo: "fin_turno" }
  | { tipo: "llamadas"; llamadas: LlamadaViva[] }
  /** Llamadas a herramientas que quedaron sin efecto porque la persona interrumpió. */
  | { tipo: "canceladas"; ids: string[] }
  /** El servicio va a cortar esta conexión en `ms`: hay que abrir otra. */
  | { tipo: "se_va"; ms: number };

type Parte = { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } };
type MensajeServidor = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: Parte[] };
    turnComplete?: boolean;
    interrupted?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: unknown }[] };
  toolCallCancellation?: { ids?: string[] };
  goAway?: { timeLeft?: string };
};

/** "9.5s" → 9500. Si no se entiende, se supone poco tiempo. */
function milisegundos(duracion: string | undefined): number {
  const m = /^([\d.]+)s$/.exec(duracion ?? "");
  return m ? Math.round(Number(m[1]) * 1000) : 5000;
}

function tasaDe(mime: string | undefined): number {
  const m = /rate=(\d+)/.exec(mime ?? "");
  return m ? Number(m[1]) : TASA_SALIDA;
}

/** Traduce un mensaje del servicio. Lo que no se conoce se ignora. */
export function leerMensaje(crudo: unknown): EventoVivo[] {
  if (!crudo || typeof crudo !== "object") return [];
  const m = crudo as MensajeServidor;
  const eventos: EventoVivo[] = [];
  if (m.setupComplete !== undefined) eventos.push({ tipo: "listo" });
  const c = m.serverContent;
  if (c) {
    // Primero la interrupción: lo que venga después ya es de otro turno.
    if (c.interrupted) eventos.push({ tipo: "interrumpido" });
    if (c.inputTranscription?.text) eventos.push({ tipo: "dijiste", texto: c.inputTranscription.text });
    for (const parte of c.modelTurn?.parts ?? []) {
      const audio = parte.inlineData;
      if (audio?.data && (audio.mimeType ?? "audio/pcm").startsWith("audio/")) {
        eventos.push({ tipo: "audio", datos: audio.data, tasa: tasaDe(audio.mimeType) });
      }
      // El texto de las partes es razonamiento del modelo: lo dicho llega por la transcripción.
    }
    if (c.outputTranscription?.text) eventos.push({ tipo: "dice", texto: c.outputTranscription.text });
    if (c.turnComplete) eventos.push({ tipo: "fin_turno" });
  }
  const llamadas = (m.toolCall?.functionCalls ?? [])
    .filter((l) => typeof l?.name === "string" && l.name)
    .map((l, i) => ({ id: String(l.id ?? `vivo-${Date.now()}-${i}`), nombre: String(l.name), argumentos: l.args ?? {} }));
  if (llamadas.length) eventos.push({ tipo: "llamadas", llamadas });
  const canceladas = (m.toolCallCancellation?.ids ?? []).map(String);
  if (canceladas.length) eventos.push({ tipo: "canceladas", ids: canceladas });
  if (m.goAway) eventos.push({ tipo: "se_va", ms: milisegundos(m.goAway.timeLeft) });
  return eventos;
}

// --- Lo que se manda ---------------------------------------------------------------

/** El primer mensaje: los ajustes de la sesión (los arma el servidor y además van fijados en el token). */
export const mensajeDeAjustes = (ajustes: unknown) => ({ setup: ajustes });

export const mensajeDeAudio = (pcmBase64: string) => ({
  realtimeInput: { audio: { data: pcmBase64, mimeType: `audio/pcm;rate=${TASA_ENTRADA}` } },
});

/** Texto en medio de la conversación (lo que la persona escribe, o la orden de abrir la llamada). */
export const mensajeDeTexto = (texto: string) => ({ realtimeInput: { text: texto } });

/** Se dejó de mandar audio por un rato (micrófono silenciado): el servicio cierra lo que venía oyendo. */
export const mensajeFinDeAudio = () => ({ realtimeInput: { audioStreamEnd: true } });

export const mensajeDeRespuestas = (respuestas: RespuestaViva[]) => ({
  toolResponse: {
    functionResponses: respuestas.map((r) => ({ id: r.id, name: r.nombre, response: { resultado: r.resultado } })),
  },
});

// --- Audio -------------------------------------------------------------------------

/**
 * Lleva el audio del micrófono (la tasa que tenga el dispositivo, en general
 * 44,1 o 48 kHz) a 16 kHz y 16 bits. Baja la tasa promediando las muestras de
 * cada tramo, que para voz alcanza. Guarda lo que sobra de un trozo para el
 * siguiente: así no hay saltos aunque la relación no sea entera.
 */
export class Remuestreador {
  private resto = new Float32Array(0);
  /** Dónde empieza, dentro de `resto`, la próxima muestra de salida (puede ser fraccionario). */
  private posicion = 0;
  private readonly paso: number;

  constructor(tasaOrigen: number, tasaDestino: number = TASA_ENTRADA) {
    this.paso = tasaOrigen / tasaDestino;
  }

  procesar(entrada: Float32Array): Int16Array {
    const datos = new Float32Array(this.resto.length + entrada.length);
    datos.set(this.resto);
    datos.set(entrada, this.resto.length);
    const cuantas = Math.max(0, Math.floor((datos.length - this.posicion) / this.paso));
    const salida = new Int16Array(cuantas);
    for (let k = 0; k < cuantas; k++) {
      const desde = Math.floor(this.posicion + k * this.paso);
      const hasta = Math.max(desde + 1, Math.min(datos.length, Math.ceil(this.posicion + (k + 1) * this.paso)));
      let suma = 0;
      for (let i = desde; i < hasta; i++) suma += datos[i];
      const valor = Math.max(-1, Math.min(1, suma / (hasta - desde)));
      salida[k] = Math.round(valor * 32767);
    }
    const avance = this.posicion + cuantas * this.paso;
    const consumidas = Math.min(datos.length, Math.floor(avance));
    this.resto = datos.slice(consumidas);
    this.posicion = avance - consumidas;
    return salida;
  }
}

/** PCM de 16 bits (como llega del servicio) a muestras entre -1 y 1. */
export function pcmAMuestras(bytes: Uint8Array): Float32Array {
  const cuantas = bytes.length >> 1;
  const vista = new DataView(bytes.buffer, bytes.byteOffset, cuantas * 2);
  const salida = new Float32Array(cuantas);
  for (let i = 0; i < cuantas; i++) salida[i] = vista.getInt16(i * 2, true) / 32768;
  return salida;
}

/** Volumen eficaz (RMS) de un trozo de PCM de 16 bits, entre 0 y 1. */
export function volumenDe(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let suma = 0;
  for (let i = 0; i < pcm.length; i++) suma += (pcm[i] / 32768) ** 2;
  return Math.sqrt(suma / pcm.length);
}

const TROZO = 0x8000;

export function aBase64(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i += TROZO) binario += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  return btoa(binario);
}

export function deBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Los bytes de un trozo de PCM, en el orden que espera el servicio (little-endian). */
export function bytesDe(pcm: Int16Array): Uint8Array {
  const bytes = new Uint8Array(pcm.length * 2);
  const vista = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i++) vista.setInt16(i * 2, pcm[i], true);
  return bytes;
}
