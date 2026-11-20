import type { Control, EstadoLlamada, Linea } from "../llamada";
import type { Sensibilidad } from "../deteccion";
import type { AlEnchufe, Enchufe } from "./conexion";
import {
  aBase64,
  bytesDe,
  deBase64,
  mensajeDeAjustes,
  mensajeDeAudio,
  mensajeDeRespuestas,
  mensajeDeTexto,
  mensajeFinDeAudio,
  pcmAMuestras,
  type EventoVivo,
  type LlamadaViva,
} from "./protocolo";
import type { PedidoTurnoVivo, RespuestaSesionViva, ResultadoTurnoVivo } from "./tipos";

/**
 * El control de una llamada en vivo: el micrófono viaja todo el tiempo al
 * servicio de voz y la respuesta llega como audio. No hay turnos que
 * administrar: el servicio escucha mientras el Agente habla y, si la persona
 * le habla encima, avisa y acá se calla el parlante en el acto.
 *
 * No sabe nada de React, de Web Audio ni de la red: recibe el parlante, la
 * conexión y las funciones que hablan con el servidor, así se prueba con todo
 * de mentira. Muestra el mismo estado que el control por turnos
 * (ControlLlamada), para que la pantalla sea una sola.
 */

/** Lo que se dijo de un lado y del otro entre dos silencios del Agente. */
type Intercambio = {
  vos: number | null;
  agente: number | null;
  textoVos: string;
  textoAgente: string;
  /** Hasta dónde ya se guardó cada texto en el servidor. */
  vosGuardado: number;
  agenteGuardado: number;
  cerrado: boolean;
};

type ParlanteDeLlamada = {
  encolar: (muestras: Float32Array, tasa: number) => void;
  cortar: () => void;
  readonly sonando: boolean;
  alCallar: (() => void) | null;
};

export type OpcionesVivo = {
  /** Le pide al servidor los datos para conectarse. `inicio`: el Agente abre la conversación. */
  pedirSesion: (p: { inicio: boolean; sensibilidad: Sensibilidad }) => Promise<RespuestaSesionViva>;
  abrir: (url: string, al: AlEnchufe) => Enchufe;
  /** Guarda lo hablado y aplica las herramientas que pida el Agente. null: no se pudo. */
  guardar: (pedido: PedidoTurnoVivo) => Promise<ResultadoTurnoVivo | null>;
  parlante: ParlanteDeLlamada;
  alCambiar: (estado: EstadoLlamada) => void;
  /** Volumen del micrófono, para dibujarlo. null: ahora no llega audio. */
  nivel?: () => number | null;
  sensibilidad?: Sensibilidad;
  silenciado?: boolean;
  /** El Agente terminó la sesión a pedido: se llama cuando terminó de despedirse. */
  alTerminar?: () => void;
  /** Se cayó y no se pudo volver a conectar: la pantalla sigue con el motor por turnos. */
  alCaer?: (motivo: string) => void;
  /** Para el diagnóstico en los registros del servidor. */
  informar?: (evento: string, detalle?: string) => void;
};

export type ResultadoConexion = "ok" | "sin_configurar" | "limite" | "error";

/** Intentos seguidos de conexión antes de darse por caída. */
const MAX_FALLOS = 2;
/** Más reconexiones que estas en un minuto: algo anda mal, no se insiste. */
const MAX_RECONEXIONES_POR_MINUTO = 4;
const ESPERA_AJUSTES_MS = 12_000;
/** Si después de escribirle o de aplicar una herramienta no dice nada en este tiempo, se reconecta. */
const SIN_RESPUESTA_MS = 25_000;
/** Tras una interrupción, el servicio cierra el turno cortado: ese cierre no es el del turno nuevo. */
const COLA_DE_INTERRUPCION_MS = 1500;
/** Si el audio se termina sin que el servicio cierre el turno, se pasa a escuchar igual. */
const HUECO_MS = 1500;
/** Si pidió terminar y el Agente no dice nada más en este tiempo, la llamada se corta igual. */
const ESPERA_DESPEDIDA_MS = 6000;
const MEDICIONES_PARA_SORDO = 25;
/** Trozos de micrófono (de unos 40 ms) que se guardan mientras se renueva la conexión: unos 4 segundos. */
const MAX_AUDIO_EN_ESPERA = 100;
/** Antes de pedir una conexión nueva se espera a que quede guardado lo último que se habló. */
const ESPERA_GUARDADO_MS = 3000;
const ERROR_AL_APLICAR = { error: "No se pudo aplicar ahora. Avisale a la persona y seguí." };

export class LlamadaEnVivo implements Control {
  estado: EstadoLlamada;
  private enchufe: Enchufe | null = null;
  /** Cambia con cada conexión: lo que llegue de una anterior se descarta. */
  private conexion = 0;
  private lista = false;
  private fallos = 0;
  private reconexiones: number[] = [];
  private reconectando = false;
  private n = 0;
  private actual: Intercambio | null = null;
  /** Se cortó al Agente con el botón: lo que falte llegar de ese turno no se reproduce. */
  private descartando = false;
  private ignorarFinHasta = 0;
  private pidioTerminar = false;
  private canceladas = new Set<string>();
  private guardados: Promise<unknown> = Promise.resolve();
  /** Lo escrito mientras se reconectaba: se manda al volver. */
  private porEnviar: string[] = [];
  /** El micrófono de los últimos segundos mientras se reconectaba: se manda al volver, para no perder lo dicho. */
  private audioEnEspera: unknown[] = [];
  /** Herramientas que se están aplicando en el servidor. */
  private aplicando = 0;
  /** Se le mandó algo y todavía no respondió (para mostrar «Pensando…» y para el tope de espera). */
  private espera: { desde: number; por: "texto" | "herramienta" } | null = null;
  private seVa = false;
  private relojSeVa: ReturnType<typeof setTimeout> | null = null;
  private relojHueco: ReturnType<typeof setTimeout> | null = null;
  private relojDespedida: ReturnType<typeof setTimeout> | null = null;
  private ultimoAudio = 0;
  private sinMedir = 0;

  constructor(private p: OpcionesVivo) {
    this.estado = {
      fase: "conectando", lineas: [], parcial: "", silenciado: Boolean(p.silenciado), sordo: false, ecoFuerte: false, motor: "vivo", aviso: null,
    };
    p.parlante.alCallar = () => this.alCallar();
  }

  // --- Lo que usa la pantalla ------------------------------------------------------

  /** Conecta. Si no se pudo, dice por qué (la pantalla sigue con el motor por turnos). */
  empezar(abreElAgente: boolean): Promise<ResultadoConexion> {
    return this.conectar(abreElAgente);
  }

  /** Un trozo del micrófono. Se manda siempre, también mientras el Agente habla. */
  recibirAudio(pcm: Int16Array): void {
    if (this.estado.silenciado || this.estado.fase === "cerrada") return;
    const mensaje = mensajeDeAudio(aBase64(bytesDe(pcm)));
    if (this.lista) return this.enchufe?.enviar(mensaje);
    // Renovando la conexión (dura un instante): se guarda lo último para mandarlo al volver.
    if (!this.reconectando) return;
    this.audioEnEspera.push(mensaje);
    if (this.audioEnEspera.length > MAX_AUDIO_EN_ESPERA) this.audioEnEspera.shift();
  }

  /** La persona escribió en lugar de hablar. El Agente responde igual en voz alta. */
  escribir(texto: string): void {
    const limpio = texto.trim();
    if (!limpio || this.estado.fase === "cerrada") return;
    this.cortarAlAgente();
    const x = this.intercambio();
    const id = this.lineaVos(x);
    x.textoVos = limpio;
    this.editarLinea(id, (l) => ({ ...l, texto: limpio }));
    if (this.lista) this.enchufe?.enviar(mensajeDeTexto(limpio));
    else this.porEnviar.push(limpio);
    this.espera = { desde: Date.now(), por: "texto" };
    this.poner({ fase: "pensando" });
  }

  /** El botón «Interrumpir». Hablando no hace falta: alcanza con hablar. */
  interrumpir(): void {
    if (this.estado.fase !== "hablando" && this.estado.fase !== "pensando") return;
    this.cortarAlAgente();
    this.espera = null;
    this.poner({ fase: "escuchando" });
  }

  silenciar(silenciado: boolean): void {
    if (silenciado === this.estado.silenciado) return;
    this.poner({ silenciado });
    // Se le avisa que el audio se corta, para que no quede esperando el final de una frase.
    if (silenciado && this.lista) this.enchufe?.enviar(mensajeFinDeAudio());
  }

  ponerNivel(nivel: () => number | null): void {
    this.p.nivel = nivel;
    this.sinMedir = 0;
  }

  /**
   * Se llama muchas veces por segundo. Devuelve el volumen del micrófono para
   * dibujarlo y, de paso, vigila que el Agente no se haya quedado sin responder.
   */
  revisarVolumen(ahora: number = Date.now()): number | null {
    if (this.espera && this.lista && ahora - this.espera.desde > SIN_RESPUESTA_MS) {
      this.espera = null;
      void this.reconectar("sin respuesta");
    }
    if (!this.p.nivel || this.estado.silenciado || this.estado.fase === "cerrada") {
      if (this.estado.sordo) this.poner({ sordo: false });
      return null;
    }
    const nivel = this.p.nivel();
    this.sinMedir = nivel === null ? this.sinMedir + 1 : 0;
    const sordo = this.sinMedir >= MEDICIONES_PARA_SORDO;
    if (sordo !== this.estado.sordo) this.poner({ sordo });
    return nivel;
  }

  avisar(mensaje: string): void {
    this.poner({ aviso: mensaje });
  }

  quitarAviso(): void {
    this.poner({ aviso: null });
  }

  /** No usa el cupo de Azure. */
  segundosNuevos(): number {
    return 0;
  }

  /** Termina cuando todo lo hablado quedó guardado (para cerrar la sesión después). */
  pendientes(): Promise<void> {
    return this.guardados.then(() => undefined);
  }

  cerrar(): void {
    if (this.estado.fase === "cerrada") return;
    this.cerrarIntercambio();
    this.conexion++;
    this.lista = false;
    this.enchufe?.cerrar();
    this.enchufe = null;
    this.p.parlante.cortar();
    this.p.parlante.alCallar = null;
    this.limpiarRelojes();
    this.audioEnEspera = [];
    this.poner({ fase: "cerrada", parcial: "" });
  }

  // --- Conexión --------------------------------------------------------------------

  private async conectar(inicio: boolean): Promise<ResultadoConexion> {
    const conexion = ++this.conexion;
    this.lista = false;
    this.enchufe?.cerrar();
    this.enchufe = null;
    const sesion = await this.p
      .pedirSesion({ inicio, sensibilidad: this.p.sensibilidad ?? "normal" })
      .catch((): RespuestaSesionViva => ({ vivo: false, motivo: "error" }));
    if (conexion !== this.conexion || this.estado.fase === "cerrada") return "error";
    if (!sesion.vivo) {
      if (sesion.motivo !== "sin_configurar") this.p.informar?.("sin_sesion", sesion.motivo);
      return sesion.motivo;
    }
    return new Promise<ResultadoConexion>((resolver) => {
      let resuelto = false;
      const terminar = (ok: boolean) => {
        if (resuelto) return;
        resuelto = true;
        clearTimeout(reloj);
        resolver(ok ? "ok" : "error");
      };
      const reloj = setTimeout(() => {
        if (conexion === this.conexion && !this.lista) {
          this.p.informar?.("sin_ajustes", "El servicio no aceptó los ajustes a tiempo");
          this.enchufe?.cerrar();
          this.enchufe = null;
        }
        terminar(false);
      }, ESPERA_AJUSTES_MS);
      const enchufe: Enchufe = this.p.abrir(sesion.url, {
        abierto: () => {
          if (conexion === this.conexion) enchufe.enviar(mensajeDeAjustes(sesion.ajustes));
        },
        eventos: (eventos) => {
          if (conexion !== this.conexion) return;
          for (const e of eventos) {
            if (e.tipo === "listo") {
              this.alListo(sesion.apertura);
              terminar(true);
            } else this.recibir(e);
          }
        },
        cierre: (codigo, motivo) => {
          if (conexion !== this.conexion) return;
          this.p.informar?.("cierre", `${codigo} ${motivo}`.trim().slice(0, 200));
          // Si nunca llegó a estar lista, decide quien la pidió (reintenta o se da por caída).
          if (!resuelto) return terminar(false);
          void this.reconectar(`cierre ${codigo}`);
        },
      });
      this.enchufe = enchufe;
    });
  }

  private alListo(apertura: string | null): void {
    this.lista = true;
    this.fallos = 0;
    const textos = [...(apertura ? [apertura] : []), ...this.porEnviar];
    this.porEnviar = [];
    for (const mensaje of this.audioEnEspera) this.enchufe?.enviar(mensaje);
    this.audioEnEspera = [];
    for (const texto of textos) this.enchufe?.enviar(mensajeDeTexto(texto));
    if (textos.length) this.espera = { desde: Date.now(), por: "texto" };
    this.poner({ fase: textos.length ? "pensando" : this.p.parlante.sonando ? "hablando" : "escuchando" });
  }

  /** Abre una conexión nueva sin cortar la llamada: el servidor le pasa lo ya conversado. */
  private async reconectar(motivo: string): Promise<void> {
    if (this.estado.fase === "cerrada" || this.reconectando) return;
    this.reconectando = true;
    try {
      const ahora = Date.now();
      this.reconexiones = [...this.reconexiones.filter((t) => ahora - t < 60_000), ahora];
      if (this.reconexiones.length > MAX_RECONEXIONES_POR_MINUTO) return this.caer(`${motivo} (demasiadas reconexiones)`);
      this.lista = false;
      this.seVa = false;
      this.descartando = false;
      this.cerrarIntercambio();
      if (!this.p.parlante.sonando) this.poner({ fase: "conectando" });
      // La conexión nueva arranca con lo ya conversado: tiene que estar guardado lo último.
      await Promise.race([this.pendientes(), new Promise((r) => setTimeout(r, ESPERA_GUARDADO_MS))]);
      for (;;) {
        if ((await this.conectar(false)) === "ok") return;
        if ((this.estado.fase as string) === "cerrada") return;
        if (++this.fallos > MAX_FALLOS) return this.caer(motivo);
        await new Promise((r) => setTimeout(r, 400 * this.fallos));
      }
    } finally {
      this.reconectando = false;
    }
  }

  private caer(motivo: string): void {
    if (this.estado.fase === "cerrada") return;
    this.conexion++;
    this.lista = false;
    this.enchufe?.cerrar();
    this.enchufe = null;
    this.p.parlante.cortar();
    this.cerrarIntercambio();
    this.limpiarRelojes();
    this.p.informar?.("caida", motivo.slice(0, 200));
    if (this.p.alCaer) this.p.alCaer(motivo);
    else this.poner({ aviso: "Se cortó la conexión de voz. Podés seguir escribiendo o pasar la llamada a texto." });
  }

  // --- Lo que llega del servicio ---------------------------------------------------

  private recibir(e: EventoVivo): void {
    if (e.tipo === "dijiste") {
      // La persona habló: lo que venga después ya responde a esto, no es resto del turno cortado.
      this.descartando = false;
      // El servicio ya dio el turno por terminado y todavía suena el final: no hay aviso de
      // interrupción que esperar, se calla acá.
      if ((!this.actual || this.actual.cerrado) && this.p.parlante.sonando) {
        this.p.parlante.cortar();
        if (this.estado.fase === "hablando") this.poner({ fase: "escuchando" });
      }
      const x = this.intercambio();
      const id = this.lineaVos(x);
      x.textoVos += e.texto;
      this.editarLinea(id, (l) => ({ ...l, texto: x.textoVos }));
    } else if (e.tipo === "audio") {
      if (this.descartando) return;
      this.empezoAResponder();
      this.lineaAgente(this.intercambio());
      this.ultimoAudio = Date.now();
      this.p.parlante.encolar(pcmAMuestras(deBase64(e.datos)), e.tasa);
      if (this.estado.fase !== "hablando") this.poner({ fase: "hablando" });
    } else if (e.tipo === "dice") {
      if (this.descartando) return;
      this.empezoAResponder();
      const x = this.intercambio();
      const id = this.lineaAgente(x);
      x.textoAgente += e.texto;
      this.editarLinea(id, (l) => ({ ...l, texto: x.textoAgente }));
    } else if (e.tipo === "interrumpido") {
      // La persona habló encima: se calla en el acto.
      this.p.parlante.cortar();
      this.descartando = false;
      this.ignorarFinHasta = Date.now() + COLA_DE_INTERRUPCION_MS;
      this.cerrarIntercambio();
      if (this.espera?.por !== "texto") this.espera = null;
      this.poner({ fase: this.espera || this.aplicando ? "pensando" : "escuchando" });
    } else if (e.tipo === "fin_turno") {
      if (Date.now() < this.ignorarFinHasta) {
        // Es el cierre del turno que se acaba de cortar, no el de uno nuevo.
        this.ignorarFinHasta = 0;
        return;
      }
      const descartaba = this.descartando;
      this.descartando = false;
      this.cerrarIntercambio();
      if (descartaba) return;
      this.espera = null;
      if (!this.p.parlante.sonando) this.despuesDeHablar();
    } else if (e.tipo === "llamadas") {
      this.empezoAResponder();
      this.aplicar(e.llamadas);
    } else if (e.tipo === "canceladas") {
      for (const id of e.ids) this.canceladas.add(id);
    } else if (e.tipo === "se_va") {
      // Se renueva la conexión cuando el Agente termina de hablar, o antes de que venza el plazo.
      this.seVa = true;
      if (this.relojSeVa) clearTimeout(this.relojSeVa);
      this.relojSeVa = setTimeout(() => this.renovar(), Math.max(0, e.ms - 1500));
      if (!this.enTurno()) this.renovar();
    }
  }

  private empezoAResponder(): void {
    this.ignorarFinHasta = 0;
    if (this.relojHueco) clearTimeout(this.relojHueco);
    this.relojHueco = null;
  }

  private enTurno(): boolean {
    return this.p.parlante.sonando || Boolean(this.actual && !this.actual.cerrado && this.actual.agente !== null);
  }

  private renovar(): void {
    if (!this.seVa || this.estado.fase === "cerrada") return;
    this.seVa = false;
    if (this.relojSeVa) clearTimeout(this.relojSeVa);
    this.relojSeVa = null;
    void this.reconectar("renovación");
  }

  /** Terminó de sonar todo lo que había en cola. */
  private alCallar(): void {
    if (this.estado.fase !== "hablando") return;
    if (this.actual && !this.actual.cerrado) {
      // El turno sigue abierto: puede ser un hueco de la red. Si no llega nada más, se pasa a escuchar.
      if (this.relojHueco) clearTimeout(this.relojHueco);
      this.relojHueco = setTimeout(() => {
        if (this.estado.fase === "hablando" && !this.p.parlante.sonando) this.despuesDeHablar();
      }, HUECO_MS);
      return;
    }
    this.despuesDeHablar();
  }

  private despuesDeHablar(): void {
    if (this.estado.fase === "cerrada") return;
    // Pidió terminar: ya se despidió, se corta sin volver a escuchar.
    if (this.pidioTerminar && this.p.alTerminar) return this.p.alTerminar();
    this.poner({ fase: this.espera || this.aplicando ? "pensando" : "escuchando" });
    if (this.seVa) this.renovar();
  }

  /** El Agente pide herramientas: se aplican en el servidor y se le devuelve el resultado. */
  private aplicar(llamadas: LlamadaViva[]): void {
    const x = this.intercambio();
    const linea = this.lineaAgente(x);
    const conexion = this.conexion;
    const pedido: PedidoTurnoVivo = { ...this.sinGuardar(x), llamadas };
    this.aplicando++;
    if (!this.p.parlante.sonando) this.poner({ fase: "pensando" });
    this.enCola(async () => {
      const r = await this.p.guardar(pedido).catch(() => null);
      this.aplicando--;
      if (this.estado.fase === "cerrada") return;
      if (r?.cambios.length) this.editarLinea(linea, (l) => ({ ...l, cambios: [...l.cambios, ...r.cambios] }));
      if (r?.terminar) this.terminarAlDespedirse();
      // Si mientras tanto se reconectó, esa llamada ya no existe para el servicio.
      if (conexion !== this.conexion) return;
      const respuestas = (r?.respuestas ?? llamadas.map((l) => ({ id: l.id, nombre: l.nombre, resultado: ERROR_AL_APLICAR })))
        .filter((y) => !this.canceladas.has(y.id));
      if (!respuestas.length) return;
      this.enchufe?.enviar(mensajeDeRespuestas(respuestas));
      // Desde acá le toca hablar al Agente: si no dice nada, se nota por el tope de espera.
      this.espera = { desde: Date.now(), por: "herramienta" };
    });
  }

  /**
   * La persona pidió terminar. Lo normal es que el Agente se despida y la
   * llamada se corte cuando termina de sonar; si ya se había despedido antes de
   * pedir el cierre y no dice nada más, se corta igual a los pocos segundos.
   */
  private terminarAlDespedirse(): void {
    this.pidioTerminar = true;
    const desde = Date.now();
    if (this.relojDespedida) clearTimeout(this.relojDespedida);
    this.relojDespedida = setTimeout(() => {
      if (this.estado.fase === "cerrada" || this.p.parlante.sonando || this.ultimoAudio > desde) return;
      this.p.alTerminar?.();
    }, ESPERA_DESPEDIDA_MS);
  }

  // --- Transcripción ---------------------------------------------------------------

  private intercambio(): Intercambio {
    if (!this.actual || this.actual.cerrado) {
      this.actual = { vos: null, agente: null, textoVos: "", textoAgente: "", vosGuardado: 0, agenteGuardado: 0, cerrado: false };
    }
    return this.actual;
  }

  private lineaAgente(x: Intercambio): number {
    if (x.agente === null) {
      x.agente = this.n++;
      this.poner({ lineas: [...this.estado.lineas, { id: x.agente, quien: "agente", texto: "", cambios: [] }] });
    }
    return x.agente;
  }

  private lineaVos(x: Intercambio): number {
    if (x.vos === null) {
      x.vos = this.n++;
      const nueva: Linea = { id: x.vos, quien: "vos", texto: "", cambios: [] };
      const lineas = [...this.estado.lineas];
      // Lo que dijo la persona va antes de la respuesta, aunque su transcripción llegue después.
      const i = x.agente === null ? -1 : lineas.findIndex((l) => l.id === x.agente);
      if (i === -1) lineas.push(nueva);
      else lineas.splice(i, 0, nueva);
      this.poner({ lineas });
    }
    return x.vos;
  }

  /** Lo que todavía no se guardó de un intercambio (y lo da por guardado). */
  private sinGuardar(x: Intercambio): { usuario?: string; agente?: string } {
    const usuario = x.textoVos.slice(x.vosGuardado).trim();
    const agente = x.textoAgente.slice(x.agenteGuardado).trim();
    x.vosGuardado = x.textoVos.length;
    x.agenteGuardado = x.textoAgente.length;
    return { ...(usuario ? { usuario } : {}), ...(agente ? { agente } : {}) };
  }

  private cerrarIntercambio(): void {
    const x = this.actual;
    if (!x || x.cerrado) return;
    x.cerrado = true;
    const pedido = this.sinGuardar(x);
    if (pedido.usuario || pedido.agente) this.enCola(() => this.p.guardar(pedido).catch(() => null));
  }

  /** Corta lo que esté sonando por decisión de la persona (botón o texto escrito). */
  private cortarAlAgente(): void {
    this.p.parlante.cortar();
    const x = this.actual;
    // El servicio sigue generando el turno cortado: lo que falte llegar no se reproduce.
    if (x && !x.cerrado && x.agente !== null) this.descartando = true;
    this.cerrarIntercambio();
  }

  /** Los guardados van de a uno y en orden, para que la transcripción quede como se habló. */
  private enCola(tarea: () => Promise<unknown>): void {
    this.guardados = this.guardados.then(tarea, tarea);
  }

  private poner(cambios: Partial<EstadoLlamada>): void {
    this.estado = { ...this.estado, ...cambios };
    this.p.alCambiar(this.estado);
  }

  private editarLinea(id: number, cambio: (l: Linea) => Linea): void {
    this.poner({ lineas: this.estado.lineas.map((l) => (l.id === id ? cambio(l) : l)) });
  }

  private limpiarRelojes(): void {
    if (this.relojSeVa) clearTimeout(this.relojSeVa);
    if (this.relojHueco) clearTimeout(this.relojHueco);
    if (this.relojDespedida) clearTimeout(this.relojDespedida);
    this.relojSeVa = null;
    this.relojHueco = null;
    this.relojDespedida = null;
  }
}
