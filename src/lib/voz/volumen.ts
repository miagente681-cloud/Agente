/**
 * Mide el volumen del micrófono en el navegador, sin mandar audio a ningún
 * lado. Sirve para detectar que la persona empezó a hablar encima del Agente.
 */
export function crearMonitor(microfono: MediaStream): { nivel: () => number; cerrar: () => void } {
  const Contexto = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const contexto = new Contexto();
  const fuente = contexto.createMediaStreamSource(microfono);
  const analizador = contexto.createAnalyser();
  analizador.fftSize = 1024;
  fuente.connect(analizador);
  const datos = new Float32Array(analizador.fftSize);
  return {
    /** Volumen eficaz (RMS) entre 0 y 1. */
    nivel() {
      analizador.getFloatTimeDomainData(datos);
      let suma = 0;
      for (const x of datos) suma += x * x;
      return Math.sqrt(suma / datos.length);
    },
    cerrar() {
      fuente.disconnect();
      void contexto.close().catch(() => null);
    },
  };
}

/** Por encima de esto, sostenido, se considera que la persona está hablando. */
export const UMBRAL_VOZ = 0.06;
export const SOSTENIDO_MS = 350;
