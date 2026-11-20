/* Captura del micrófono para la llamada en vivo.
 * Corre en el hilo de audio (AudioWorklet): junta las muestras que entrega el
 * navegador (de a 128) y se las pasa a la página en trozos de unos 40 ms, que
 * es lo que después viaja al servicio de voz. No procesa ni guarda nada.
 */
const MUESTRAS_POR_TROZO = 2048;

class Captura extends AudioWorkletProcessor {
  constructor() {
    super();
    this.trozo = new Float32Array(MUESTRAS_POR_TROZO);
    this.llenas = 0;
  }

  process(entradas) {
    const canal = entradas[0] && entradas[0][0];
    if (!canal) return true;
    let leidas = 0;
    while (leidas < canal.length) {
      const caben = Math.min(canal.length - leidas, MUESTRAS_POR_TROZO - this.llenas);
      this.trozo.set(canal.subarray(leidas, leidas + caben), this.llenas);
      this.llenas += caben;
      leidas += caben;
      if (this.llenas === MUESTRAS_POR_TROZO) {
        this.port.postMessage(this.trozo, [this.trozo.buffer]);
        this.trozo = new Float32Array(MUESTRAS_POR_TROZO);
        this.llenas = 0;
      }
    }
    return true;
  }
}

registerProcessor("captura", Captura);
