/**
 * Detecta que la persona empezó a hablar mientras el Agente habla, para que
 * pueda interrumpirlo sin tocar nada.
 *
 * Solo mira el volumen del micrófono (no manda audio a ningún lado). Es lógica
 * pura: recibe mediciones con su hora y decide; así se prueba con secuencias
 * armadas, sin micrófono ni reloj.
 *
 * Tres ideas:
 *  1. **El habla no es pareja.** Entre sílabas el volumen cae. Por eso no se
 *     pide que todas las mediciones superen el umbral: alcanza con que lo haga
 *     la mayoría dentro de una ventana corta.
 *  2. **El micrófono también oye al Agente.** Si el dispositivo no cancela el
 *     eco (una notebook con parlantes), la voz del Agente entra por el
 *     micrófono. Se mide cuánto entra y se exige hablar claramente más fuerte
 *     que eso: nunca tiene que interrumpirse solo.
 *  3. **Cada dispositivo es distinto.** La sensibilidad se puede ajustar (o
 *     apagar) desde Configuración, y queda guardada en el dispositivo.
 */

export type Sensibilidad = "alta" | "normal" | "baja" | "apagada";
export const SENSIBILIDADES: { valor: Sensibilidad; nombre: string }[] = [
  { valor: "normal", nombre: "Normal" },
  { valor: "alta", nombre: "Más sensible (me cuesta interrumpirlo)" },
  { valor: "baja", nombre: "Menos sensible (se corta solo)" },
  { valor: "apagada", nombre: "Apagada (uso el botón Interrumpir)" },
];

type Ajuste = {
  /** Volumen (RMS, de 0 a 1) a partir del cual puede ser voz, aunque no haya eco. */
  minimo: number;
  /** Cuántas veces más fuerte que el eco del Agente hay que hablar. */
  sobreEco: number;
};
const AJUSTES: Record<Exclude<Sensibilidad, "apagada">, Ajuste> = {
  alta: { minimo: 0.012, sobreEco: 1.4 },
  normal: { minimo: 0.022, sobreEco: 1.7 },
  baja: { minimo: 0.045, sobreEco: 2.2 },
};

/** Ventana en la que se busca voz, y cuánta tiene que haber. */
export const VENTANA_MS = 300;
const PROPORCION_CON_VOZ = 0.6;
const MINIMO_DE_MEDICIONES = 4;
/**
 * El eco se estima con lo medido hasta hace este rato: así la voz de la
 * persona, que recién empieza, no sube la vara antes de ser detectada.
 */
const ECO_ATRASO_MS = 400;
const ECO_MEMORIA_MS = 3000;
const MINIMO_PARA_ESTIMAR = 5;
/** La primera vez que habla el Agente todavía no se sabe cuánto eco hay: se escucha un momento antes de decidir. */
const ARRANQUE_MS = 600;

type Medicion = { t: number; nivel: number };

/** El valor por debajo del cual está el 90 % de las mediciones. */
function percentil90(mediciones: Medicion[]): number {
  const ordenadas = mediciones.map((m) => m.nivel).sort((a, b) => a - b);
  return ordenadas[Math.min(ordenadas.length - 1, Math.floor(ordenadas.length * 0.9))];
}

export class DetectorDeVoz {
  /** Lo medido en el tramo actual en que el Agente habla. */
  private tramo: Medicion[] = [];
  /** Cuánto eco hubo en los tramos anteriores. */
  private ecoPrevio: number | null = null;
  /** Interrupciones seguidas que llegaron apenas el Agente empezó a hablar. */
  private tempranas = 0;

  constructor(private sensibilidad: Sensibilidad = "normal") {}

  cambiarSensibilidad(sensibilidad: Sensibilidad): void {
    this.sensibilidad = sensibilidad;
  }

  /**
   * El micrófono oye bastante al propio Agente (el dispositivo no cancela el
   * eco): para interrumpirlo hay que hablar fuerte. Sirve para decirlo en pantalla.
   */
  get ecoFuerte(): boolean {
    if (this.sensibilidad === "apagada" || this.ecoPrevio === null) return false;
    const ajuste = AJUSTES[this.sensibilidad];
    return this.ecoPrevio * ajuste.sobreEco > ajuste.minimo * 2;
  }

  /**
   * Recibe una medición. `nivel` es null si en este momento no se puede medir
   * (micrófono silenciado por el sistema, audio suspendido). Devuelve true en
   * el instante en que detecta que la persona le habla encima al Agente.
   */
  medir(nivel: number | null, ahora: number, hablaElAgente: boolean): boolean {
    if (!hablaElAgente || this.sensibilidad === "apagada" || nivel === null) {
      this.cerrarTramo(false);
      return false;
    }
    const ajuste = AJUSTES[this.sensibilidad];
    this.tramo.push({ t: ahora, nivel });
    const inicio = this.tramo[0].t;
    while (this.tramo.length && this.tramo[0].t < ahora - ECO_MEMORIA_MS - ECO_ATRASO_MS) this.tramo.shift();

    // Cuánto del propio Agente entra por el micrófono: lo menor entre lo que se
    // vio antes y lo de este tramo. Si uno de los dos quedó «contaminado» por
    // la voz de la persona, manda el otro.
    const atrasadas = this.tramo.filter((m) => m.t <= ahora - ECO_ATRASO_MS);
    const ecoDelTramo = atrasadas.length >= MINIMO_PARA_ESTIMAR ? percentil90(atrasadas) : null;
    let eco: number;
    if (ecoDelTramo !== null && this.ecoPrevio !== null) eco = Math.min(ecoDelTramo, this.ecoPrevio);
    else if (ecoDelTramo !== null) eco = ecoDelTramo;
    else if (this.ecoPrevio !== null) eco = this.ecoPrevio;
    else if (ahora - inicio < ARRANQUE_MS) return false;
    else eco = 0;

    const umbral = Math.max(ajuste.minimo, eco * ajuste.sobreEco);
    const recientes = this.tramo.filter((m) => m.t > ahora - VENTANA_MS);
    const conVoz = recientes.filter((m) => m.nivel >= umbral).length;
    if (conVoz < MINIMO_DE_MEDICIONES || conVoz / recientes.length < PROPORCION_CON_VOZ) return false;

    this.cerrarTramo(true, ahora);
    return true;
  }

  /** Termina el tramo y se queda con cuánto eco hubo, para el próximo. */
  private cerrarTramo(porInterrupcion: boolean, ahora = 0): void {
    if (!this.tramo.length) return;
    // Si lo cortó la persona, lo último que se midió es su voz: no cuenta como eco.
    const delAgente = porInterrupcion ? this.tramo.filter((m) => m.t <= ahora - VENTANA_MS) : this.tramo;
    if (delAgente.length >= MINIMO_PARA_ESTIMAR) {
      this.ecoPrevio = percentil90(delAgente);
      this.tempranas = 0;
    } else if (porInterrupcion) {
      // Se cortó apenas empezó: no hay con qué estimar el eco. Una vez puede
      // ser la persona, que justo habló. Dos seguidas ya parece el propio eco
      // (por ejemplo, subieron el volumen): se sube la vara para que el Agente
      // no se corte solo una y otra vez.
      this.tempranas++;
      if (this.tempranas >= 2) this.ecoPrevio = Math.max(this.ecoPrevio ?? 0, percentil90(this.tramo));
    }
    this.tramo = [];
  }
}

// --- Preferencia guardada en el dispositivo -------------------------------------

const CLAVE = "miagente.voz.interrupcion";

export function leerSensibilidad(): Sensibilidad {
  try {
    const guardada = window.localStorage.getItem(CLAVE);
    return SENSIBILIDADES.some((s) => s.valor === guardada) ? (guardada as Sensibilidad) : "normal";
  } catch {
    return "normal";
  }
}

export function guardarSensibilidad(sensibilidad: Sensibilidad): void {
  try {
    window.localStorage.setItem(CLAVE, sensibilidad);
  } catch {
    // Sin almacenamiento, vale solo para esta vez.
  }
}
