import type { Cambio, EventoCliente } from "@/lib/agente/cliente";
import { Segmentador } from "./oraciones";
import type { ProveedorVoz } from "./tipos";
import { SOSTENIDO_MS, UMBRAL_VOZ } from "./volumen";

/**
 * El control de una llamada: quién habla, quién escucha y qué pasa cuando la
 * persona interrumpe. No sabe nada de React ni de Azure: recibe el proveedor
 * de voz y la función que pide un turno, así se puede probar con los dos de mentira.
 *
 * Ciclo: escuchando → (la persona termina una frase) → pensando → hablando →
 * escuchando. Mientras el Agente piensa o habla, el reconocimiento está en
 * pausa (no se manda audio); la interrupción se detecta por el volumen del
 * micrófono y recién ahí se vuelve a escuchar.
 */

export type Fase = "conectando" | "escuchando" | "pensando" | "hablando" | "cerrada";
export type Linea = { id: number; quien: "vos" | "agente"; texto: string; cambios: Cambio[] };
export type EstadoLlamada = {
  fase: Fase;
  lineas: Linea[];
  /** Lo que se va reconociendo mientras la persona habla. */
  parcial: string;
  silenciado: boolean;
  motor: ProveedorVoz["id"];
  aviso: string | null;
};

type PedirTurno = (pedido: { texto?: string; inicio?: boolean }, senal: AbortSignal) => AsyncGenerator<EventoCliente>;

export class ControlLlamada {
  estado: EstadoLlamada;
  private voz: ProveedorVoz;
  /** Cambia con cada interrupción: lo que quedó en vuelo de antes se descarta. */
  private generacion = 0;
  private cola: Promise<void> = Promise.resolve();
  private pedido: AbortController | null = null;
  private vozDesde: number | null = null;
  private n = 0;

  constructor(
    private p: {
      voz: ProveedorVoz;
      turno: PedirTurno;
      alCambiar: (estado: EstadoLlamada) => void;
      /** Volumen del micrófono (0 a 1), para detectar interrupciones. */
      nivel?: () => number;
    },
  ) {
    this.voz = p.voz;
    this.estado = { fase: "conectando", lineas: [], parcial: "", silenciado: false, motor: p.voz.id, aviso: null };
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
      } else if (e.tipo === "error") {
        this.poner({ aviso: e.mensaje });
      }
    }
    if (!vigente()) return;
    segmentos.cerrar().forEach(decir);
    await this.cola;
    if (vigente()) await this.escuchar();
  }

  private cortarAlAgente() {
    this.generacion++;
    this.pedido?.abort();
    this.voz.callar();
    this.cola = Promise.resolve();
    this.vozDesde = null;
  }

  /** La persona habló encima (o tocó «Interrumpir»): el Agente corta y escucha. */
  interrumpir(): void {
    if (this.estado.fase !== "hablando" && this.estado.fase !== "pensando") return;
    this.cortarAlAgente();
    void this.escuchar();
  }

  /**
   * Se llama varias veces por segundo. Si mientras el Agente habla el volumen
   * del micrófono se mantiene alto un rato, lo interrumpe.
   */
  revisarVolumen(ahora: number = Date.now()): void {
    if (this.estado.fase !== "hablando" || this.estado.silenciado || !this.p.nivel) {
      this.vozDesde = null;
      return;
    }
    if (this.p.nivel() < UMBRAL_VOZ) {
      this.vozDesde = null;
      return;
    }
    this.vozDesde ??= ahora;
    if (ahora - this.vozDesde >= SOSTENIDO_MS) this.interrumpir();
  }

  silenciar(silenciado: boolean): void {
    this.poner({ silenciado, parcial: "" });
    if (silenciado) void this.voz.pausar();
    else if (this.estado.fase === "escuchando") void this.escuchar();
  }

  /** Cambia de proveedor a mitad de la llamada (por ejemplo, si se agotó el cupo de Azure). */
  cambiarVoz(nueva: ProveedorVoz, aviso: string): void {
    const anterior = this.voz;
    this.voz = nueva;
    anterior.cerrar();
    this.poner({ motor: nueva.id, aviso });
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
