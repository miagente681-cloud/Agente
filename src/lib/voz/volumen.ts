import { contextoDeAudio } from "./desbloqueo";

/**
 * Mide el volumen del micrófono en el navegador, sin mandar audio a ningún
 * lado. Sirve para detectar que la persona empezó a hablar encima del Agente
 * (ver deteccion.ts) y para mostrar en pantalla que se la está oyendo.
 */
export type Monitor = {
  /**
   * Volumen eficaz (RMS) entre 0 y 1, o null si en este momento no se puede
   * medir: el audio de la página está suspendido o el sistema silenció el
   * micrófono. Distinguirlo de «hay silencio» permite avisarle a la persona.
   */
  nivel: () => number | null;
  /** El micrófono se cortó del todo (no vuelve solo): hay que pedirlo de nuevo. */
  terminado: () => boolean;
  cerrar: () => void;
};

/** Cada cuánto se vuelve a intentar reanudar el audio si quedó suspendido. */
const REINTENTO_MS = 1000;

export function crearMonitor(microfono: MediaStream): Monitor | null {
  const contexto = contextoDeAudio();
  const pista = microfono.getAudioTracks()[0];
  if (!contexto || !pista) return null;
  const fuente = contexto.createMediaStreamSource(microfono);
  const analizador = contexto.createAnalyser();
  analizador.fftSize = 1024;
  fuente.connect(analizador);
  const datos = new Float32Array(analizador.fftSize);
  let ultimoIntento = 0;
  return {
    nivel() {
      if (contexto.state !== "running") {
        // En iPhone el audio puede quedar suspendido o interrumpido (por
        // ejemplo, al arrancar el reconocimiento de voz). Se intenta reanudar.
        const ahora = Date.now();
        if (ahora - ultimoIntento > REINTENTO_MS) {
          ultimoIntento = ahora;
          void contexto.resume().catch(() => null);
        }
        return null;
      }
      if (pista.readyState !== "live" || pista.muted || !pista.enabled) return null;
      analizador.getFloatTimeDomainData(datos);
      let suma = 0;
      for (const x of datos) suma += x * x;
      return Math.sqrt(suma / datos.length);
    },
    terminado: () => pista.readyState === "ended",
    cerrar() {
      // El contexto es el de toda la página: no se cierra, solo se desconecta el micrófono.
      try {
        fuente.disconnect();
      } catch {
        // Ya estaba desconectado.
      }
    },
  };
}
