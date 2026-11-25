"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Hand, Keyboard, MessageSquareText, Mic, MicOff, PhoneOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { TarjetaCambio } from "@/components/agente/tarjeta-cambio";
import { Boton } from "@/components/ui/boton";
import { pedirTurno } from "@/lib/agente/cliente";
import { useDatos } from "@/lib/datos/almacen";
import { supabaseBrowser } from "@/lib/supabase/client";
import { crearVozAzure } from "@/lib/voz/azure";
import { ControlLlamada, type Control, type EstadoLlamada, type Linea } from "@/lib/voz/llamada";
import { contextoDeAudio, desbloquearAudio } from "@/lib/voz/desbloqueo";
import { crearVozNavegador, navegadorEscucha } from "@/lib/voz/navegador";
import type { ProveedorVoz, RespuestaToken } from "@/lib/voz/tipos";
import { leerSensibilidad, type Sensibilidad } from "@/lib/voz/deteccion";
import { crearMonitor, type Monitor } from "@/lib/voz/volumen";
import { abrirCaptura, modoLlamada, Parlante, type Captura } from "@/lib/voz/vivo/audio";
import { abrirEnchufe } from "@/lib/voz/vivo/conexion";
import { LlamadaEnVivo } from "@/lib/voz/vivo/llamada";
import { leerMotor, type RespuestaSesionViva, type ResultadoTurnoVivo } from "@/lib/voz/vivo/tipos";

type Sesion = { id: string; kind: string; status: string; scheduled_at: string | null; focus: string | null };
type Pantalla =
  | { tipo: "cargando" }
  | { tipo: "no_disponible"; mensaje: string }
  | { tipo: "lista"; sesion: Sesion; yaEmpezada: boolean }
  | { tipo: "en_llamada"; sesion: Sesion };

const FASE: Record<EstadoLlamada["fase"], string> = {
  conectando: "Conectando…",
  escuchando: "Te escucho",
  pensando: "Pensando…",
  hablando: "Hablando",
  cerrada: "Llamada terminada",
};
const MOTOR: Record<string, string> = { azure: "Azure", navegador: "la del navegador", prueba: "de prueba", vivo: "en vivo" };
const ROTULO: Record<string, string> = { onboarding: "Entrevista inicial", chat: "Chat de voz", llamada_programada: "Llamada" };

const pedirToken = (): Promise<RespuestaToken> =>
  fetch("/api/voice/token", { method: "POST" })
    .then((r) => (r.ok ? (r.json() as Promise<RespuestaToken>) : { azure: false as const, motivo: "error" as const }))
    .catch(() => ({ azure: false as const, motivo: "error" as const }));

const enviarJson = (ruta: string, cuerpo: unknown) =>
  // keepalive: el pedido sale aunque se esté cerrando la página.
  fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), keepalive: true });

/** Avisa al servidor qué pasó con la conexión de voz en vivo, para poder diagnosticar. */
const informar = (evento: string, detalle?: string) => void enviarJson("/api/voice/vivo/aviso", { evento, detalle }).catch(() => null);

/**
 * Gancho solo para las pruebas en navegador: un proveedor de voz de mentira.
 * Con `vivo`, primero se intenta la llamada en vivo y este queda de respaldo.
 */
type VozDePrueba = ProveedorVoz & { nivel?: () => number; vivo?: boolean };

/**
 * Lo que hereda el motor por turnos cuando la llamada en vivo no arranca o se
 * cae: el micrófono ya abierto (o que ya se pidió y no hubo permiso), lo
 * conversado y el aviso para la persona.
 */
type Heredado = { mic: MediaStream | null; pidioMicrofono: boolean; lineas: Linea[]; aviso: string | null };

/** Cada cuánto se mide el volumen del micrófono. */
const MEDIR_CADA_MS = 40;
/**
 * Si el sistema corta el micrófono (en algunos teléfonos pasa al arrancar el
 * reconocimiento de voz), se vuelve a pedir cuando hace falta: mientras el
 * Agente piensa o habla. Con un mínimo entre intentos y un tope por llamada.
 */
const ENTRE_REAPERTURAS_MS = 3000;
const MAX_REAPERTURAS = 30;
/** Al cortar, cuánto se espera a que termine de guardarse lo último que se habló. */
const ESPERA_GUARDADO_MS = 4000;
/** Cuánto tiene que estar frenado el sonido, con el Agente hablando, para pedirle un toque a la persona. */
const SONIDO_FRENADO_MS = 1500;
const SIN_PERMISO = "No tengo permiso para usar el micrófono. Podés escribir abajo y te respondo hablando.";
const vozDePrueba = () => (window as unknown as { __vozDePrueba?: VozDePrueba }).__vozDePrueba ?? null;

export function Llamada({ id }: { id: string }) {
  const router = useRouter();
  const { recargar } = useDatos();
  const [pantalla, setPantalla] = useState<Pantalla>({ tipo: "cargando" });
  const [estado, setEstado] = useState<EstadoLlamada | null>(null);
  const [conMicrofono, setConMicrofono] = useState(false);
  const [texto, setTexto] = useState("");
  const control = useRef<Control | null>(null);
  const limpiezas = useRef<(() => void)[]>([]);
  const finTranscripcion = useRef<HTMLDivElement>(null);
  // El aro que muestra que el micrófono te oye. Se mueve sin pasar por React (25 veces por segundo).
  const aro = useRef<HTMLSpanElement>(null);
  const monitor = useRef<Monitor | null>(null);
  const captura = useRef<Captura | null>(null);
  const microfono = useRef<MediaStream | null>(null);
  const parlante = useRef<Parlante | null>(null);
  const frenadoDesde = useRef<number | null>(null);
  const reaperturas = useRef({ veces: 0, ultima: 0 });
  const avisoSinAudio = useRef(false);
  const [sensibilidad, setSensibilidad] = useState<Sensibilidad>("normal");

  useEffect(() => {
    let vigente = true;
    (async () => {
      const sb = supabaseBrowser();
      const [{ data }, mensajes] = await Promise.all([
        sb.from("sessions").select("id,kind,status,scheduled_at,focus").eq("id", id).maybeSingle(),
        sb.from("messages").select("id").eq("session_id", id).limit(1),
      ]);
      if (!vigente) return;
      const sesion = data as Sesion | null;
      if (!sesion) return setPantalla({ tipo: "no_disponible", mensaje: "Esta sesión no existe." });
      if (["completada", "perdida", "reprogramada"].includes(sesion.status)) return router.replace(`/sesiones/${id}`);
      if (sesion.status === "programada" && sesion.scheduled_at && new Date(sesion.scheduled_at).getTime() > Date.now() + 60_000) {
        const hora = new Date(sesion.scheduled_at).toLocaleString("es-UY", { weekday: "long", hour: "2-digit", minute: "2-digit" });
        return setPantalla({ tipo: "no_disponible", mensaje: `Todavía no es la hora de esta llamada: está programada para el ${hora}.` });
      }
      setPantalla({ tipo: "lista", sesion, yaEmpezada: Boolean(mensajes.data?.length) });
    })();
    return () => {
      vigente = false;
    };
  }, [id, router]);

  const reportarUso = useCallback(() => {
    const segundos = control.current?.segundosNuevos() ?? 0;
    if (segundos > 0) void enviarJson("/api/voice/uso", { segundos: Math.min(segundos, 300) }).catch(() => null);
  }, []);

  const limpiar = useCallback(() => {
    reportarUso();
    control.current?.cerrar();
    control.current = null;
    captura.current = null;
    limpiezas.current.forEach((f) => f());
    limpiezas.current = [];
  }, [reportarUso]);

  // Al salir de la pantalla se corta todo: micrófono, voz y contadores.
  useEffect(() => limpiar, [limpiar]);

  useEffect(() => {
    finTranscripcion.current?.scrollIntoView({ block: "end" });
  }, [estado?.lineas, estado?.parcial]);

  /**
   * Arma el proveedor de voz: Azure si hay token, si no el navegador. Sin
   * micrófono sirve igual para que el Agente hable; solo no escucha.
   */
  const vozDelNavegador = () =>
    crearVozNavegador({
      alBloqueado: () =>
        control.current?.avisar("El teléfono bloqueó el sonido. Tocá la pantalla una vez y el Agente vuelve a hablar."),
    });

  async function armarVoz(microfono: MediaStream | null): Promise<{ voz: ProveedorVoz; aviso: string | null }> {
    const token = await pedirToken();
    let aviso: string | null = null;
    let azure: ProveedorVoz | null = null;
    if (token.azure) {
      azure = await crearVozAzure({
        inicial: token,
        pedirToken,
        microfono,
        alAgotarse: () => {
          const c = control.current;
          if (c instanceof ControlLlamada) c.cambiarVoz(vozDelNavegador(), "Se agotó el cupo de voz de Azure de este mes: sigo con la voz del navegador.");
        },
      }).catch(() => null);
      if (azure && token.aviso) aviso = `Vas por el ${token.porcentaje} % del cupo gratuito de voz de este mes.`;
    } else if (token.motivo === "agotado") {
      aviso = "Se agotó el cupo de voz de Azure de este mes: uso la voz del navegador.";
    }
    const voz = azure ?? vozDelNavegador();
    if (microfono && voz.id === "navegador" && !navegadorEscucha()) {
      aviso = "Este navegador no reconoce voz: podés escribir abajo y el Agente te responde hablando.";
    }
    return { voz, aviso };
  }

  /**
   * Pide el micrófono. Devuelve null si no hay permiso. La cancelación de eco
   * es lo que deja hablarle encima al Agente: sin ella el micrófono lo oiría
   * sobre todo a él.
   */
  async function pedirMicrofono(): Promise<MediaStream | null> {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      limpiezas.current.push(() => mic.getTracks().forEach((t) => t.stop()));
      microfono.current = mic;
      return mic;
    } catch {
      return null;
    }
  }

  /** Motor por turnos: el medidor de volumen que detecta que le hablan encima al Agente. */
  function medirMicrofono(mic: MediaStream): () => number | null {
    const nuevo = crearMonitor(mic);
    monitor.current = nuevo;
    limpiezas.current.push(() => nuevo?.cerrar());
    return () => nuevo?.nivel() ?? null;
  }

  /** Llamada en vivo: el micrófono viaja al servicio de voz todo el tiempo, en trozos. */
  async function transmitirMicrofono(c: LlamadaEnVivo, mic: MediaStream): Promise<Captura | null> {
    const contexto = contextoDeAudio();
    if (!contexto) return null;
    if (contexto.state !== "running") await contexto.resume().catch(() => null);
    const nueva = await abrirCaptura(contexto, mic, (pcm) => c.recibirAudio(pcm)).catch(() => null);
    if (!nueva) return null;
    captura.current = nueva;
    limpiezas.current.push(() => nueva.cerrar());
    c.ponerNivel(nueva.nivel);
    return nueva;
  }

  /** Mueve el aro con el volumen del micrófono y, si el sistema lo cortó, lo vuelve a pedir. */
  function medir() {
    const c = control.current;
    if (!c) return;
    const nivel = c.revisarVolumen();
    if (aro.current) {
      // De 0 a 0,15 de volumen, el aro crece hasta un 35 %.
      const tamano = nivel === null ? 0 : Math.min(0.35, nivel * 2.3);
      aro.current.style.transform = `scale(${1 + tamano})`;
      aro.current.style.opacity = nivel !== null && nivel > 0.01 ? "1" : "0";
    }
    const r = reaperturas.current;
    const puedeReabrir = r.veces < MAX_REAPERTURAS && Date.now() - r.ultima > ENTRE_REAPERTURAS_MS;
    if (c instanceof LlamadaEnVivo) {
      // El Agente "habla" pero el teléfono tiene el sonido frenado: hace falta un toque.
      const frenado = c.estado.fase === "hablando" && Boolean(parlante.current?.frenado);
      if (!frenado) frenadoDesde.current = null;
      else if (frenadoDesde.current === null) frenadoDesde.current = Date.now();
      else if (frenadoDesde.current > 0 && Date.now() - frenadoDesde.current > SONIDO_FRENADO_MS) {
        frenadoDesde.current = -1; // Ya se avisó.
        informar("sin_audio", "parlante frenado");
        c.avisar("El teléfono bloqueó el sonido. Tocá la pantalla una vez y el Agente vuelve a hablar.");
      }
      if (c.estado.sordo && !avisoSinAudio.current) {
        avisoSinAudio.current = true;
        informar("sin_audio", `captura ${captura.current?.via ?? "ninguna"}`);
      }
      if (captura.current?.terminado() && puedeReabrir) {
        reaperturas.current = { veces: r.veces + 1, ultima: Date.now() };
        captura.current.cerrar();
        captura.current = null;
        void pedirMicrofono().then((mic) => {
          if (mic && control.current === c) void transmitirMicrofono(c, mic);
        });
      }
      return;
    }
    // Por turnos: si el sistema cortó el micrófono del todo, no vuelve solo. Se pide de nuevo
    // cuando sirve para algo (mientras se escucha, el reconocimiento usa el suyo).
    const haceFalta = c.estado.fase === "pensando" || c.estado.fase === "hablando";
    if (haceFalta && monitor.current?.terminado() && puedeReabrir) {
      reaperturas.current = { veces: r.veces + 1, ultima: Date.now() };
      monitor.current = null;
      void pedirMicrofono().then((mic) => {
        if (mic && control.current === c) c.ponerNivel(medirMicrofono(mic));
      });
    }
  }

  /** Que el teléfono no apague la pantalla en medio de la llamada (se llevaría el micrófono). */
  function mantenerPantalla() {
    let bloqueo: WakeLockSentinel | null = null;
    const pedir = () => {
      if (document.visibilityState !== "visible") return;
      void navigator.wakeLock
        ?.request("screen")
        .then((b) => (bloqueo = b))
        .catch(() => null);
    };
    pedir();
    // El sistema lo suelta al salir de la app: se vuelve a pedir al volver.
    document.addEventListener("visibilitychange", pedir);
    limpiezas.current.push(() => {
      document.removeEventListener("visibilitychange", pedir);
      void bloqueo?.release().catch(() => null);
    });
  }

  /** Tiene que arrancar desde un toque: el navegador no da micrófono ni audio de otra forma. */
  async function empezar(sesion: Sesion, yaEmpezada: boolean, quiereMicrofono: boolean) {
    // Antes de cualquier espera: en iPhone el audio solo se habilita dentro del toque.
    desbloquearAudio();
    // Y cada toque durante la llamada lo vuelve a habilitar (por si el teléfono lo suspendió).
    window.addEventListener("pointerdown", desbloquearAudio);
    limpiezas.current.push(() => window.removeEventListener("pointerdown", desbloquearAudio));
    mantenerPantalla();
    setPantalla({ tipo: "en_llamada", sesion });
    const elegida = leerSensibilidad();
    setSensibilidad(elegida);
    const volumen = setInterval(medir, MEDIR_CADA_MS);
    const uso = setInterval(reportarUso, 30_000);
    limpiezas.current.push(() => clearInterval(volumen), () => clearInterval(uso));
    // En una llamada o en la entrevista abre el Agente; en un chat de voz empieza la persona.
    const abre = !yaEmpezada && sesion.kind !== "chat";
    const prueba = vozDePrueba();
    let heredado: Heredado | null = null;
    if ((!prueba || prueba.vivo) && leerMotor() === "vivo") {
      heredado = await empezarEnVivo(sesion, abre, quiereMicrofono, elegida);
      // Arrancó en vivo: si más adelante se cae, ella misma sigue por turnos.
      if (!heredado) return;
    }
    await empezarPorTurnos(sesion, abre, quiereMicrofono, elegida, heredado);
  }

  /**
   * Llamada en vivo: audio continuo en los dos sentidos, se le puede hablar
   * encima al Agente. Devuelve null si quedó andando; si no se pudo, lo que
   * necesita el motor por turnos para seguir sin volver a pedir el micrófono.
   */
  async function empezarEnVivo(sesion: Sesion, abre: boolean, quiereMicrofono: boolean, elegida: Sensibilidad): Promise<Heredado | null> {
    const contexto = contextoDeAudio();
    if (!contexto) return { mic: null, pidioMicrofono: false, lineas: [], aviso: null };
    const restaurar = modoLlamada();
    const mic = quiereMicrofono && !vozDePrueba() ? await pedirMicrofono() : null;
    const altavoz = new Parlante(contexto);
    parlante.current = altavoz;
    const c: LlamadaEnVivo = new LlamadaEnVivo({
      parlante: altavoz,
      sensibilidad: elegida,
      silenciado: !mic,
      alCambiar: (e) => control.current === c && setEstado(e),
      // «Terminá la sesión»: el Agente se despide y la llamada se corta sola, como con el botón.
      alTerminar: () => void cortar(),
      alCaer: () =>
        void pasarATurnos("Se cortó la llamada en vivo: sigo por turnos (para interrumpirme, hablá fuerte o tocá «Interrumpir»)."),
      informar,
      abrir: abrirEnchufe,
      pedirSesion: (p) =>
        enviarJson("/api/voice/vivo", { sesionId: sesion.id, ...p })
          .then((r) => (r.ok ? (r.json() as Promise<RespuestaSesionViva>) : { vivo: false as const, motivo: "error" as const }))
          .catch(() => ({ vivo: false as const, motivo: "error" as const })),
      guardar: (pedido) =>
        enviarJson("/api/voice/vivo/turno", { sesionId: sesion.id, ...pedido })
          .then((r) => (r.ok ? (r.json() as Promise<ResultadoTurnoVivo>) : null))
          .catch(() => null),
    });
    /** Suelta lo propio de la llamada en vivo (no el micrófono) y deja lo que hereda el otro motor. */
    const soltar = (aviso: string | null): Heredado | null => {
      if (control.current !== c) return null;
      const lineas = c.estado.lineas;
      control.current = null;
      c.cerrar();
      captura.current?.cerrar();
      captura.current = null;
      altavoz.cerrar();
      parlante.current = null;
      restaurar();
      // El micrófono puede haberse activado después de atender: vale el último que siga abierto.
      const abierto = microfono.current?.getAudioTracks().some((t) => t.readyState === "live") ? microfono.current : null;
      return { mic: abierto, pidioMicrofono: quiereMicrofono && !vozDePrueba(), lineas, aviso };
    };
    const pasarATurnos = async (aviso: string) => {
      const heredado = soltar(aviso);
      informar("respaldo", "en medio de la llamada");
      // Ya se venía hablando: el Agente no vuelve a abrir.
      if (heredado) await empezarPorTurnos(sesion, false, quiereMicrofono || Boolean(heredado.mic), elegida, heredado);
    };
    control.current = c;
    limpiezas.current.push(() => altavoz.cerrar(), restaurar);
    setEstado(c.estado);
    setConMicrofono(Boolean(mic));

    const resultado = await c.empezar(abre);
    if (control.current !== c) return null; // Cortaron mientras conectaba.
    if (resultado !== "ok") {
      if (resultado !== "sin_configurar") informar("respaldo", `al atender: ${resultado}`);
      return soltar(resultado === "sin_configurar" ? null : "No pude abrir la llamada en vivo: sigo por turnos (para interrumpirme, hablá fuerte o tocá «Interrumpir»).");
    }
    const abierta = mic ? await transmitirMicrofono(c, mic) : null;
    informar("conectada", abierta ? `micrófono por ${abierta.via} a ${abierta.tasa} Hz` : "sin micrófono");
    if (quiereMicrofono && !abierta) c.avisar(SIN_PERMISO);
    return null;
  }

  /** Motor por turnos: la voz y el dictado del navegador (o Azure), de a uno por vez. */
  async function empezarPorTurnos(sesion: Sesion, abre: boolean, quiereMicrofono: boolean, elegida: Sensibilidad, heredado: Heredado | null) {
    const prueba = vozDePrueba();
    let voz: ProveedorVoz;
    let aviso: string | null = null;
    let nivel: (() => number | null) | undefined;
    let hayMicrofono = false;

    if (prueba) {
      voz = prueba;
      nivel = prueba.nivel;
      hayMicrofono = quiereMicrofono;
    } else {
      const mic = heredado?.mic ?? (quiereMicrofono && !heredado?.pidioMicrofono ? await pedirMicrofono() : null);
      hayMicrofono = Boolean(mic);
      nivel = mic ? medirMicrofono(mic) : undefined;
      ({ voz, aviso } = await armarVoz(mic));
      if (quiereMicrofono && !mic) aviso = SIN_PERMISO;
    }
    setConMicrofono(hayMicrofono);

    const c: ControlLlamada = new ControlLlamada({
      voz,
      nivel,
      sensibilidad: elegida,
      silenciado: !hayMicrofono,
      lineas: heredado?.lineas,
      alCambiar: (e) => control.current === c && setEstado(e),
      // «Terminá la sesión»: el Agente se despide y la llamada se corta sola, como con el botón.
      alTerminar: () => void cortar(),
      turno: (pedido, senal) =>
        pedirTurno({ ...pedido, sesionId: sesion.id, canal: "voz", voz: c.estado.motor === "azure" ? "azure" : "navegador" }, senal),
    });
    control.current = c;
    setEstado(c.estado);
    const avisos = [heredado?.aviso, aviso].filter(Boolean).join(" ");
    if (avisos) c.avisar(avisos);
    await c.empezar(abre);
  }

  /** El botón del micrófono: silencia, vuelve a escuchar o, si nunca se activó, lo pide. */
  async function alternarMicrofono() {
    desbloquearAudio();
    const c = control.current;
    if (!c) return;
    if (conMicrofono) return c.silenciar(!c.estado.silenciado);
    const sinPermiso = "No tengo permiso para usar el micrófono. Habilitalo en los ajustes del sitio; mientras tanto podés escribir.";
    if (c instanceof LlamadaEnVivo) {
      const mic = await pedirMicrofono();
      if (!mic || control.current !== c || !(await transmitirMicrofono(c, mic))) return c.avisar(sinPermiso);
      setConMicrofono(true);
      return c.silenciar(false);
    }
    if (vozDePrueba()) {
      setConMicrofono(true);
      return c.silenciar(false);
    }
    const mic = await pedirMicrofono();
    if (!mic) return c.avisar(sinPermiso);
    const { voz, aviso } = await armarVoz(mic);
    c.ponerNivel(medirMicrofono(mic));
    if (c instanceof ControlLlamada) c.cambiarVoz(voz, aviso);
    setConMicrofono(true);
    c.silenciar(false);
  }

  function enviarTexto(e: FormEvent) {
    desbloquearAudio();
    e.preventDefault();
    if (!texto.trim()) return;
    control.current?.escribir(texto);
    setTexto("");
  }

  /** Corta todo y espera (un momento) a que quede guardado lo último que se habló en vivo. */
  async function soltarTodo() {
    const c = control.current;
    limpiar();
    if (c instanceof LlamadaEnVivo) {
      await Promise.race([c.pendientes(), new Promise((r) => setTimeout(r, ESPERA_GUARDADO_MS))]);
    }
  }

  async function cortar() {
    setEstado((e) => (e ? { ...e, fase: "cerrada" } : e));
    await soltarTodo();
    await fetch(`/api/sesiones/${id}/cerrar`, { method: "POST" }).catch(() => null);
    void recargar();
    router.replace(`/sesiones/${id}`);
  }

  async function pasarATexto() {
    await soltarTodo();
    router.replace(`/chat?sesion=${id}`);
  }

  // Ocupa toda la pantalla, por encima de la navegación.
  const marco = "fixed inset-0 z-50 flex flex-col bg-fondo px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))]";

  if (pantalla.tipo === "cargando") {
    return <div className={marco}><p className="m-auto text-sm text-texto-3">Cargando…</p></div>;
  }
  if (pantalla.tipo === "no_disponible") {
    return (
      <div className={marco}>
        <div className="m-auto flex max-w-sm flex-col items-center gap-4 text-center">
          <p className="text-texto-2">{pantalla.mensaje}</p>
          <Link href="/hoy" className="enlace">Volver</Link>
        </div>
      </div>
    );
  }
  if (pantalla.tipo === "lista") {
    const { sesion, yaEmpezada } = pantalla;
    const esChat = sesion.kind === "chat";
    return (
      <div className={marco}>
        <div className="m-auto flex max-w-sm flex-col items-center gap-5 text-center">
          <p className="rotulo">{esChat ? "Chat de voz" : sesion.kind === "onboarding" ? "Entrevista inicial" : "Llamada del Agente"}</p>
          <h1 className="titulo-pagina">
            {yaEmpezada ? "¿Seguimos?" : esChat ? "Hablá con tu Agente" : "Tu Agente te está llamando"}
          </h1>
          {sesion.focus ? <p className="text-sm text-texto-2">{sesion.focus}</p> : null}
          <Boton variante="primario" className="!h-14 !rounded-full !px-8 !text-base" onClick={() => void empezar(sesion, yaEmpezada, true)}>
            <Mic size={20} aria-hidden />
            {yaEmpezada ? "Seguir hablando" : esChat ? "Empezar a hablar" : "Atender"}
          </Boton>
          <Boton className="!rounded-full" onClick={() => void empezar(sesion, yaEmpezada, false)}>
            <Keyboard size={16} aria-hidden />
            Sin micrófono: yo escribo, el Agente habla
          </Boton>
          <button type="button" onClick={() => void pasarATexto()} className="rounded-sm text-sm text-texto-2 underline underline-offset-[3px] hover:text-texto">
            Hacerla toda por escrito
          </button>
          {esChat ? (
            <Link href="/chat" className="rounded-sm text-sm text-texto-3 hover:text-texto">Volver</Link>
          ) : null}
        </div>
      </div>
    );
  }

  const fase = estado?.fase ?? "conectando";
  const silenciado = Boolean(estado?.silenciado);
  const esperando = fase === "escuchando";
  // Con el micrófono andando y midiendo, alcanza con hablar para cortar al Agente.
  const puedeInterrumpirHablando = conMicrofono && !silenciado && !estado?.sordo && sensibilidad !== "apagada";
  const rotuloBoton = "flex flex-col items-center gap-2 text-center text-[11px] font-semibold uppercase leading-tight tracking-[0.1em] text-texto-2";
  return (
    <div className={marco}>
      <header className="flex min-h-11 items-center justify-between gap-3 px-1">
        <p className="cifra text-[2rem]">{ROTULO[pantalla.sesion.kind] ?? "Llamada"}</p>
        {estado ? (
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-texto-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-acento" />
            Voz: {MOTOR[estado.motor]}
          </p>
        ) : null}
      </header>

      <div className="flex flex-col items-center gap-2 pb-3 pt-4">
        <span className="relative flex h-40 w-40 items-center justify-center">
          {/* Crece con tu voz: muestra que el micrófono te está oyendo, también mientras habla el Agente. */}
          <span
            ref={aro}
            aria-hidden
            className="absolute inset-0 rounded-full bg-acento-suave opacity-0 transition-[transform,opacity] duration-100 ease-out"
          />
          {/* El círculo de puntos late mientras habla el Agente y se apaga con el micrófono silenciado. */}
          <span
            aria-hidden
            className={`trama-puntos relative flex h-40 w-40 items-center justify-center rounded-full transition-opacity ${
              fase === "hablando" ? "animate-pulse" : ""
            } ${silenciado || fase === "conectando" ? "opacity-35" : ""}`}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-fondo text-texto-2">
              {silenciado ? (
                <MicOff size={24} />
              ) : (
                <span className={`h-6 w-6 rounded-full ${esperando ? "bg-ok" : "bg-acento"}`} />
              )}
            </span>
          </span>
        </span>
        <p role="status" aria-live="polite" className="cifra mt-2 text-center text-[2.9rem]">
          {silenciado && esperando ? (conMicrofono ? "Micrófono silenciado" : "Escribí abajo") : FASE[fase]}
        </p>
        <div className="flex min-h-8 flex-col items-center justify-center gap-1.5">
          {fase === "hablando" && puedeInterrumpirHablando ? (
            <>
              <span className="max-w-xs text-center text-sm text-texto-2">
                {estado?.ecoFuerte
                  ? "El micrófono me oye a mí: para interrumpirme hablá fuerte. Con auriculares anda mejor."
                  : "Hablá cuando quieras: me callo al instante"}
              </span>
              <button
                type="button"
                onClick={() => control.current?.interrumpir()}
                className="rounded-sm text-xs text-texto-3 underline underline-offset-2 hover:text-texto"
              >
                o tocá acá para interrumpir
              </button>
            </>
          ) : fase === "hablando" || fase === "pensando" ? (
            <>
              <Boton tamano="sm" onClick={() => control.current?.interrumpir()}>
                <Hand size={14} aria-hidden />
                Interrumpir
              </Boton>
              {fase === "hablando" && conMicrofono && !silenciado ? (
                <span className="max-w-xs text-center text-xs text-texto-3">
                  {sensibilidad === "apagada"
                    ? "La interrupción hablando está apagada en Configuración → Voz."
                    : "Ahora no puedo oírte mientras hablo: tocá «Interrumpir»."}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-sm text-texto-2">
              {esperando ? (silenciado ? "El Agente te responde hablando" : "Hablá o escribí cuando quieras") : ""}
            </span>
          )}
        </div>
      </div>

      {estado?.aviso ? (
        <p role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-lg border-[1.5px] border-dotted border-aviso bg-panel px-4 py-2.5 text-[13px] text-texto-2">
          {estado.aviso}
          <button type="button" onClick={() => control.current?.quitarAviso()} className="shrink-0 font-medium text-texto underline underline-offset-[3px]">
            Entendido
          </button>
        </p>
      ) : null}

      {/* Lo conversado: un mosaico con renglones punteados, quién habló arriba de cada uno. */}
      <div
        className={`mx-auto w-full max-w-xl flex-1 overflow-y-auto rounded-xl px-[1.125rem] ${
          estado?.lineas.length || estado?.parcial ? "bg-panel" : ""
        }`}
        aria-label="Transcripción"
      >
        {estado?.lineas.map((l) =>
          l.texto || l.cambios.length ? (
            <div key={l.id} className="flex flex-col gap-1.5 border-b-[1.5px] border-dotted border-borde-fuerte py-2.5 last:border-b-0">
              {l.texto ? (
                <>
                  <p className="rotulo">{l.quien === "vos" ? "Vos" : "Agente"}</p>
                  <p className="whitespace-pre-wrap text-base font-medium leading-snug">{l.texto.trim()}</p>
                </>
              ) : null}
              {l.cambios.map((c) => (
                <TarjetaCambio key={c.id || c.summary} cambio={c} />
              ))}
            </div>
          ) : null,
        )}
        {estado?.parcial ? (
          <div className="flex flex-col gap-1.5 py-2.5">
            <p className="rotulo">Vos</p>
            <p className="text-base leading-snug text-texto-2">{estado.parcial}</p>
          </div>
        ) : null}
        <div ref={finTranscripcion} />
      </div>

      {/* Siempre se puede escribir: con el micrófono apagado, o cuando no conviene hablar. */}
      <form onSubmit={enviarTexto} className="mx-auto mt-3 flex w-full max-w-xl items-center gap-2 rounded-full border-[1.5px] border-dotted border-texto-3 p-1 pl-2">
        <label htmlFor="texto-llamada" className="sr-only">
          Escribirle al Agente
        </label>
        <input
          id="texto-llamada"
          value={texto}
          maxLength={4000}
          autoComplete="off"
          enterKeyHint="send"
          placeholder="O escribí acá…"
          onChange={(e) => setTexto(e.target.value)}
          className="h-10 min-w-0 flex-1 bg-transparent px-2.5 text-[15px] placeholder:text-texto-3 focus:outline-none"
        />
        <Boton type="submit" variante="primario" aria-label="Enviar" disabled={!texto.trim() || !estado} className="!h-10 !w-10 shrink-0 !px-0">
          <ArrowUp size={18} aria-hidden />
        </Boton>
      </form>

      <div className="mx-auto mt-4 grid w-full max-w-xl grid-cols-3 gap-2">
        <button type="button" aria-pressed={!silenciado} onClick={() => void alternarMicrofono()} className={rotuloBoton}>
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-panel text-texto">
            {silenciado ? <MicOff size={24} aria-hidden /> : <Mic size={24} aria-hidden />}
          </span>
          {silenciado ? (conMicrofono ? "Activar" : "Usar micrófono") : "Silenciar"}
        </button>
        <button type="button" onClick={() => void pasarATexto()} className={rotuloBoton}>
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-panel text-texto">
            <MessageSquareText size={24} aria-hidden />
          </span>
          A texto
        </button>
        <button type="button" onClick={() => void cortar()} className={rotuloBoton}>
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-peligro text-fondo">
            <PhoneOff size={24} aria-hidden />
          </span>
          Cortar
        </button>
      </div>
    </div>
  );
}
