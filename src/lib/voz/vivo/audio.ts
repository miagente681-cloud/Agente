import { Remuestreador, volumenDe } from "./protocolo";

/**
 * El audio de la llamada en vivo, del lado del navegador: sacar el micrófono
 * en trozos y hacer sonar la voz del Agente. Todo pasa por el audio de la
 * propia página (Web Audio) y no por la voz ni el dictado del sistema: así el
 * micrófono sigue abierto mientras el Agente habla y el teléfono le quita el
 * eco, que es lo que permite hablarle encima como en una llamada.
 */

export type Captura = {
  /** Volumen del micrófono (0 a 1), o null si hace un rato que no llega audio. */
  nivel: () => number | null;
  /** Cómo se está capturando (para el diagnóstico). */
  via: "worklet" | "procesador";
  tasa: number;
  /** El micrófono se cortó del todo: hay que pedirlo de nuevo. */
  terminado: () => boolean;
  cerrar: () => void;
};

/** Sin trozos nuevos en este tiempo, se considera que el micrófono no está entregando audio. */
const SIN_AUDIO_MS = 600;
const RUTA_WORKLET = "/audio/captura.js";
const conWorklet = new WeakSet<AudioContext>();

/**
 * Empieza a entregar el micrófono en trozos de PCM de 16 bits a 16 kHz.
 * Usa un AudioWorklet (hilo de audio); si el navegador no lo deja cargar, cae
 * al procesador clásico, que hace lo mismo desde el hilo de la página.
 */
export async function abrirCaptura(
  contexto: AudioContext,
  microfono: MediaStream,
  alTrozo: (pcm: Int16Array) => void,
): Promise<Captura> {
  const pista = microfono.getAudioTracks()[0];
  const fuente = contexto.createMediaStreamSource(microfono);
  const remuestreador = new Remuestreador(contexto.sampleRate);
  let ultimoNivel = 0;
  let ultimaVez = 0;
  let abierta = true;

  const recibir = (muestras: Float32Array) => {
    if (!abierta) return;
    const pcm = remuestreador.procesar(muestras);
    if (!pcm.length) return;
    ultimoNivel = volumenDe(pcm);
    ultimaVez = Date.now();
    alTrozo(pcm);
  };

  // Los dos caminos necesitan terminar en la salida para que el navegador los
  // haga correr; pasan por un volumen en cero para que el micrófono no suene.
  const mudo = contexto.createGain();
  mudo.gain.value = 0;
  mudo.connect(contexto.destination);

  let nodo: AudioNode;
  let via: Captura["via"] = "worklet";
  try {
    if (!contexto.audioWorklet) throw new Error("Sin AudioWorklet");
    if (!conWorklet.has(contexto)) {
      await contexto.audioWorklet.addModule(RUTA_WORKLET);
      conWorklet.add(contexto);
    }
    const worklet = new AudioWorkletNode(contexto, "captura", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => recibir(e.data);
    nodo = worklet;
  } catch {
    via = "procesador";
    const procesador = contexto.createScriptProcessor(4096, 1, 1);
    procesador.onaudioprocess = (e) => recibir(new Float32Array(e.inputBuffer.getChannelData(0)));
    nodo = procesador;
  }
  fuente.connect(nodo);
  nodo.connect(mudo);

  return {
    via,
    tasa: contexto.sampleRate,
    nivel() {
      if (!abierta || !pista || pista.readyState !== "live" || pista.muted || !pista.enabled) return null;
      return Date.now() - ultimaVez > SIN_AUDIO_MS ? null : ultimoNivel;
    },
    terminado: () => !pista || pista.readyState === "ended",
    cerrar() {
      abierta = false;
      for (const n of [fuente, nodo, mudo]) {
        try {
          n.disconnect();
        } catch {
          // Ya estaba desconectado.
        }
      }
    },
  };
}

/** Margen antes de hacer sonar el primer trozo de una respuesta: absorbe los saltos de la red. */
const COLCHON_S = 0.08;

/**
 * Hace sonar la voz del Agente a medida que llega, un trozo detrás del otro y
 * sin huecos. `cortar()` la calla en el acto: es lo que pasa cuando la persona
 * habla encima.
 */
export class Parlante {
  private fuentes = new Set<AudioBufferSourceNode>();
  private proximo = 0;
  private salida: GainNode;
  /** Se llama cuando termina de sonar todo lo que había en cola. */
  alCallar: (() => void) | null = null;

  constructor(private contexto: AudioContext) {
    this.salida = contexto.createGain();
    this.salida.connect(contexto.destination);
  }

  /**
   * El sistema tiene el audio de la página frenado (en iPhone pasa si otra app
   * tomó el sonido): lo encolado no suena hasta que se reanude con un toque.
   */
  get frenado(): boolean {
    return this.contexto.state !== "running";
  }

  encolar(muestras: Float32Array, tasa: number): void {
    if (!muestras.length) return;
    // Con el micrófono abierto, el navegador suele dejar reanudar sin un toque.
    if (this.frenado) void this.contexto.resume().catch(() => null);
    const buffer = this.contexto.createBuffer(1, muestras.length, tasa);
    buffer.getChannelData(0).set(muestras);
    const fuente = this.contexto.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(this.salida);
    const inicio = Math.max(this.proximo, this.contexto.currentTime + COLCHON_S);
    fuente.start(inicio);
    this.proximo = inicio + buffer.duration;
    this.fuentes.add(fuente);
    fuente.onended = () => {
      this.fuentes.delete(fuente);
      fuente.disconnect();
      if (!this.fuentes.size) this.alCallar?.();
    };
  }

  cortar(): void {
    for (const fuente of this.fuentes) {
      fuente.onended = null;
      try {
        fuente.stop();
        fuente.disconnect();
      } catch {
        // Todavía no había empezado o ya terminó.
      }
    }
    this.fuentes.clear();
    this.proximo = 0;
  }

  get sonando(): boolean {
    return this.fuentes.size > 0;
  }

  cerrar(): void {
    this.alCallar = null;
    this.cortar();
    try {
      this.salida.disconnect();
    } catch {
      // Ya estaba desconectada.
    }
  }
}

/**
 * En iPhone, avisa al sistema que la página habla y escucha a la vez (como una
 * llamada): el sonido sale por el parlante y el micrófono queda con cancelación
 * de eco. Donde no existe, no hace nada. Devuelve cómo volver atrás.
 */
export function modoLlamada(): () => void {
  type SesionDeAudio = { type: string };
  const sesion = (navigator as unknown as { audioSession?: SesionDeAudio }).audioSession;
  if (!sesion) return () => undefined;
  const anterior = sesion.type;
  try {
    sesion.type = "play-and-record";
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      sesion.type = anterior;
    } catch {
      // No se pudo restaurar: se restaura sola al cerrar la página.
    }
  };
}
