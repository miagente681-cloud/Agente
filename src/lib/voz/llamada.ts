import type { Cambio, EventoCliente } from "@/lib/agente/cliente";
import { DetectorDeVoz, type Sensibilidad } from "./deteccion";
import { Segmentador } from "./oraciones";
import type { ProveedorVoz } from "./tipos";

/**
 * El control de una llamada: quién habla, quién escucha y qué pasa cuando la
 * persona interrumpe. No sabe nada de React ni de Azure: recibe el proveedor
 * de voz y la función que pide un turno, así se puede probar con los dos de mentira.
 *
 * Ciclo: escuchando → (la persona termina una frase) → pensando → hablando →
 * escuchando. Mientras el Agente piensa o habla, el reconocimiento está en
 * pausa (no se manda audio). Si la persona le habla encima, se nota por el
 * volumen del micrófono (deteccion.ts): el Agente se calla en el acto y se
 * vuelve a escuchar, sin que haya que tocar nada.
 */

export type Fase = "conectando" | "escuchando" | "pensando" | "hablando" | "cerrada";
export type Linea = { id: number; quien: "vos" | "agente"; texto: string; cambios: Cambio[] };
export type EstadoLlamada = {
  fase: Fase;
  lineas: Linea[];
  /** Lo que se va reconociendo mientras la persona habla. */
  parcial: string;
  silenciado: boolean;
  /**
   * Hay micrófono, pero en este momento no se puede medir su volumen (el
   * sistema lo silenció o suspendió el audio): hablando no se puede
   * interrumpir, queda el botón.
   */
  sordo: boolean;
  /** El micrófono oye bastante al propio Agente: para interrumpirlo hay que hablar fuerte. */
  ecoFuerte: boolean;
  motor: ProveedorVoz["id"];
  aviso: string | null;
};

/** Mediciones seguidas sin poder medir (más o menos un segundo) para avisar que no se oye. */
const MEDICIONES_PARA_SORDO = 25;

type PedirTurno = (pedido: { texto?: string; inicio?: boolean }, senal: AbortSignal) => AsyncGenerator<EventoCliente>;

export class ControlLlamada {
  estado: EstadoLlamada;
  private voz: ProveedorVoz;
  /** Cambia con cada interrupción: lo que quedó en vuelo de antes se descarta. */
  private generacion = 0;
  private cola: Promise<void> = Promise.resolve();
  private pedido: AbortController | null = null;
  private detector: DetectorDeVoz;
  private sinMedir = 0;
  private n = 0;

  constructor(
    private p: {
      voz: ProveedorVoz;
      turno: PedirTurno;
      alCambiar: (estado: EstadoLlamada) => void;
      /** Volumen del micrófono (0 a 1), para detectar interrupciones. null: ahora no se puede medir. */
      nivel?: () => number | null;
      /** Cuánto hay que levantar la voz para interrumpir (lo elige la persona en Configuración). */
      sensibilidad?: Sensibilidad;
      /** Empieza sin escuchar: la persona escribe (o no dio permiso de micrófono). */
      silenciado?: boolean;
      /** El Agente terminó la sesión a pedido: se llama cuando terminó de despedirse. */
      alTerminar?: () => void;
    },
  ) {
    this.voz = p.voz;
    this.detector = new DetectorDeVoz(p.sensibilidad ?? "normal");
    this.estado = {
      fase: "conectando", lineas: [], parcial: "", silenciado: Boolean(p.silenciado), sordo: false, ecoFuerte: false, motor: p.voz.id, aviso: null,
    };
  }

  /** Conecta el medidor de volumen cuando el micrófono se activa (o se vuelve a pedir) a mitad de la sesión. */
  ponerNivel(nivel: () => number | null): void {
    this.p.nivel = nivel;
    this.sinMedir = 0;
  }

  avisar(mensaje: string): void {
    this.poner({ aviso: mensaje });
  }

  /** La persona escribió en lugar de hablar. El Agente responde igual en voz alta. */
  escribir(texto: string): void {
    const limpio = texto.trim();
    if (!limpio || this.estado.fase === "cerrada") return;
    if (this.estado.fase !== "escuchando") this.cortarAlAgente();
    this.poner({ parcial: "", lineas: [...this.estado.lineas, { id: this.n++, quien: "vos", texto: limpio, cambios: [] }] });
    void this.turno({ texto: limpio });
  }

  private poner(cambios: Partial<EstadoLlamada>) {
    this.estado = { ...this.estado, ...cambios };
    this.p.alCambiar(this.estado);
  }

  private editarLinea(id: number, cambio: (l: Linea) => Linea) {
    this.poner({ lineas: this.estado.lineas.map((l) => (l.id === id ? cambio(l) : l)) });
  }

  /** Arranca la llamada: abre el Agente, o se pone a escuchar si ya venía hablándose. */
  empezar(abreElAgente: boolean): Promise<void> {
    return abreElAgente ? this.turno({ inicio: true }) : this.escuchar();
  }

  private async escuchar(): Promise<void> {
    if (this.estado.fase === "cerrada") return;
    this.poner({ fase: "escuchando", parcial: "" });
    if (this.estado.silenciado) return;
    await this.voz.escuchar(
      (texto, final) => this.alTexto(texto, final),
      (mensaje) => this.poner({ aviso: mensaje }),
    );
  }

  private alTexto(texto: string, final: boolean) {
    if (this.estado.silenciado || this.estado.fase === "cerrada") return;
    if (!final) return this.poner({ parcial: texto });
    // Una frase final mientras el Agente habla también es una interrupción.
    if (this.estado.fase !== "escuchando") this.cortarAlAgente();
    this.poner({ parcial: "", lineas: [...this.estado.lineas, { id: this.n++, quien: "vos", texto, cambios: [] }] });
    void this.turno({ texto });
  }

  private async turno(pedido: { texto?: string; inicio?: boolean }): Promise<void> {
    const generacion = ++this.generacion;
    const vigente = () => generacion === this.generacion && this.estado.fase !== "cerrada";
    this.pedido?.abort();
    const control = (this.pedido = new AbortController());
    // Mientras piensa y habla no se escucha: no se gasta cupo de reconocimiento.
    await this.voz.pausar();
    if (!vigente()) return;

    const id = this.n++;
    let terminar = false;
    this.poner({ fase: "pensando", lineas: [...this.estado.lineas, { id, quien: "agente", texto: "", cambios: [] }] });
    let segmentos = new Segmentador();
    const decir = (bloque: string) => {
      this.cola = this.cola.then(async () => {
        if (!vigente()) return;
        this.poner({ fase: "hablando" });
        await this.voz.hablar(bloque);
      });
    };

    for await (const e of this.p.turno(pedido, control.signal)) {
      if (!vigente()) return;
      if (e.tipo === "texto") {
        this.editarLinea(id, (l) => ({ ...l, texto: l.texto + e.texto }));
        segmentos.agregar(e.texto).forEach(decir);
      } else if (e.tipo === "reiniciar") {
        // Va a responder otro proveedor: lo ya dicho no se puede desdecir, pero
        // lo que falta decir se descarta.
        this.editarLinea(id, (l) => ({ ...l, texto: "" }));
        segmentos = new Segmentador();
      } else if (e.tipo === "cambio") {
        this.editarLinea(id, (l) => ({ ...l, cambios: [...l.cambios, e.cambio] }));
      } else if (e.tipo === "error" || e.tipo === "aviso") {
        this.poner({ aviso: e.mensaje });
      } else if (e.tipo === "terminar") {
        terminar = true;
      }
    }
    if (!vigente()) return;
    segmentos.cerrar().forEach(decir);
    await this.cola;
    if (!vigente()) return;
    // Pidió terminar: se despide y corta, sin volver a escuchar.
    if (terminar && this.p.alTerminar) return this.p.alTerminar();
    await this.escuchar();
  }

  private cortarAlAgente() {
    this.generacion++;
    this.pedido?.abort();
    this.voz.callar();
    this.cola = Promise.resolve();
  }

  /** La persona habló encima (o tocó «Interrumpir»): el Agente corta y escucha. */
  interrumpir(): void {
    if (this.estado.fase !== "hablando" && this.estado.fase !== "pensando") return;
    this.cortarAlAgente();
    void this.escuchar();
  }

  /**
   * Se llama muchas veces por segundo con el reloj de la llamada. Si mientras
   * el Agente habla la persona empieza a hablar, lo interrumpe. Devuelve el
   * volumen medido (o null), para dibujarlo en pantalla.
   */
  revisarVolumen(ahora: number = Date.now()): number | null {
    if (!this.p.nivel || this.estado.silenciado || this.estado.fase === "cerrada") {
      this.detector.medir(null, ahora, false);
      if (this.estado.sordo) this.poner({ sordo: false });
      return null;
    }
    const nivel = this.p.nivel();
    this.sinMedir = nivel === null ? this.sinMedir + 1 : 0;
    const sordo = this.sinMedir >= MEDICIONES_PARA_SORDO;
    if (sordo !== this.estado.sordo) this.poner({ sordo });
    if (this.detector.medir(nivel, ahora, this.estado.fase === "hablando")) this.interrumpir();
    if (this.detector.ecoFuerte !== this.estado.ecoFuerte) this.poner({ ecoFuerte: this.detector.ecoFuerte });
    return nivel;
  }

  silenciar(silenciado: boolean): void {
    this.poner({ silenciado, parcial: "" });
    if (silenciado) void this.voz.pausar();
    else if (this.estado.fase === "escuchando") void this.escuchar();
  }

  /** Cambia de proveedor a mitad de la llamada (por ejemplo, si se agotó el cupo de Azure). */
  cambiarVoz(nueva: ProveedorVoz, aviso: string | null): void {
    const anterior = this.voz;
    this.voz = nueva;
    anterior.cerrar();
    this.poner({ motor: nueva.id, aviso: aviso ?? this.estado.aviso });
    if (this.estado.fase === "escuchando") void this.escuchar();
  }

  quitarAviso(): void {
    this.poner({ aviso: null });
  }

  segundosNuevos(): number {
    return this.voz.segundosNuevos();
  }

  cerrar(): void {
    if (this.estado.fase === "cerrada") return;
    this.generacion++;
    this.pedido?.abort();
    this.voz.cerrar();
    this.poner({ fase: "cerrada", parcial: "" });
  }
}
