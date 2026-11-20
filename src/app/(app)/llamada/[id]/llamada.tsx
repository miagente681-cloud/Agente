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
import { ControlLlamada, type EstadoLlamada } from "@/lib/voz/llamada";
import { desbloquearAudio } from "@/lib/voz/desbloqueo";
import { crearVozNavegador, navegadorEscucha } from "@/lib/voz/navegador";
import type { ProveedorVoz, RespuestaToken } from "@/lib/voz/tipos";
import { leerSensibilidad, type Sensibilidad } from "@/lib/voz/deteccion";
import { crearMonitor, type Monitor } from "@/lib/voz/volumen";

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
const MOTOR: Record<string, string> = { azure: "Azure", navegador: "la del navegador", prueba: "de prueba" };
const ROTULO: Record<string, string> = { onboarding: "Entrevista inicial", chat: "Chat de voz", llamada_programada: "Llamada" };

const pedirToken = (): Promise<RespuestaToken> =>
  fetch("/api/voice/token", { method: "POST" })
    .then((r) => (r.ok ? (r.json() as Promise<RespuestaToken>) : { azure: false as const, motivo: "error" as const }))
    .catch(() => ({ azure: false as const, motivo: "error" as const }));

/** Gancho solo para las pruebas en navegador: un proveedor de voz de mentira. */
type VozDePrueba = ProveedorVoz & { nivel?: () => number };

/** Cada cuánto se mide el volumen del micrófono. */
const MEDIR_CADA_MS = 40;
/**
 * Si el sistema corta el micrófono (en algunos teléfonos pasa al arrancar el
 * reconocimiento de voz), se vuelve a pedir cuando hace falta: mientras el
 * Agente piensa o habla. Con un mínimo entre intentos y un tope por llamada.
 */
const ENTRE_REAPERTURAS_MS = 3000;
const MAX_REAPERTURAS = 30;
const vozDePrueba = () => (window as unknown as { __vozDePrueba?: VozDePrueba }).__vozDePrueba ?? null;

export function Llamada({ id }: { id: string }) {
  const router = useRouter();
  const { recargar } = useDatos();
  const [pantalla, setPantalla] = useState<Pantalla>({ tipo: "cargando" });
  const [estado, setEstado] = useState<EstadoLlamada | null>(null);
  const [conMicrofono, setConMicrofono] = useState(false);
  const [texto, setTexto] = useState("");
  const control = useRef<ControlLlamada | null>(null);
  const limpiezas = useRef<(() => void)[]>([]);
  const finTranscripcion = useRef<HTMLDivElement>(null);
  // El aro que muestra que el micrófono te oye. Se mueve sin pasar por React (25 veces por segundo).
  const aro = useRef<HTMLSpanElement>(null);
  const monitor = useRef<Monitor | null>(null);
  const reaperturas = useRef({ veces: 0, ultima: 0 });
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
    if (segundos > 0) {
      // keepalive: el pedido sale aunque se esté cerrando la página.
      void fetch("/api/voice/uso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segundos: Math.min(segundos, 300) }),
        keepalive: true,
      }).catch(() => null);
    }
  }, []);

  const limpiar = useCallback(() => {
    reportarUso();
    control.current?.cerrar();
    control.current = null;
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
        alAgotarse: () =>
          control.current?.cambiarVoz(vozDelNavegador(), "Se agotó el cupo de voz de Azure de este mes: sigo con la voz del navegador."),
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
   * Pide el micrófono y deja listo el medidor de volumen. Devuelve null si no
   * hay permiso. La cancelación de eco es lo que deja interrumpir hablando: sin
   * ella el micrófono oiría sobre todo al propio Agente.
   */
  async function abrirMicrofono(): Promise<{ mic: MediaStream; nivel: () => number | null } | null> {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const nuevo = crearMonitor(mic);
      monitor.current = nuevo;
      limpiezas.current.push(() => mic.getTracks().forEach((t) => t.stop()), () => nuevo?.cerrar());
      return { mic, nivel: () => nuevo?.nivel() ?? null };
    } catch {
      return null;
    }
  }

  /** Mide el volumen, deja que el control decida si es una interrupción y mueve el aro. */
  function medir(c: ControlLlamada) {
    const nivel = c.revisarVolumen();
    if (aro.current) {
      // De 0 a 0,15 de volumen, el aro crece hasta un 70 %.
      const tamano = nivel === null ? 0 : Math.min(0.7, nivel * 4.5);
      aro.current.style.transform = `scale(${1 + tamano})`;
      aro.current.style.opacity = nivel !== null && nivel > 0.01 ? "1" : "0";
    }
    // Si el sistema cortó el micrófono del todo, no vuelve solo: se pide de nuevo
    // cuando sirve para algo (mientras se escucha, el reconocimiento usa el suyo).
    const r = reaperturas.current;
    const haceFalta = c.estado.fase === "pensando" || c.estado.fase === "hablando";
    if (haceFalta && monitor.current?.terminado() && r.veces < MAX_REAPERTURAS && Date.now() - r.ultima > ENTRE_REAPERTURAS_MS) {
      reaperturas.current = { veces: r.veces + 1, ultima: Date.now() };
      monitor.current = null;
      void abrirMicrofono().then((abierto) => abierto && control.current === c && c.ponerNivel(abierto.nivel));
    }
  }

  /** Tiene que arrancar desde un toque: el navegador no da micrófono ni audio de otra forma. */
  async function empezar(sesion: Sesion, yaEmpezada: boolean, quiereMicrofono: boolean) {
    // Antes de cualquier espera: en iPhone el audio solo se habilita dentro del toque.
    desbloquearAudio();
    // Y cada toque durante la llamada lo vuelve a habilitar (por si el teléfono lo suspendió).
    window.addEventListener("pointerdown", desbloquearAudio);
    limpiezas.current.push(() => window.removeEventListener("pointerdown", desbloquearAudio));
    setPantalla({ tipo: "en_llamada", sesion });
    const prueba = vozDePrueba();
    let voz: ProveedorVoz;
    let aviso: string | null = null;
    let nivel: (() => number | null) | undefined;
    let hayMicrofono = false;
    const elegida = leerSensibilidad();
    setSensibilidad(elegida);

    if (prueba) {
      voz = prueba;
      nivel = prueba.nivel;
      hayMicrofono = quiereMicrofono;
    } else {
      const abierto = quiereMicrofono ? await abrirMicrofono() : null;
      hayMicrofono = Boolean(abierto);
      nivel = abierto?.nivel;
      ({ voz, aviso } = await armarVoz(abierto?.mic ?? null));
      if (quiereMicrofono && !abierto) {
        aviso = "No tengo permiso para usar el micrófono. Podés escribir abajo y te respondo hablando.";
      }
    }
    setConMicrofono(hayMicrofono);

    const c: ControlLlamada = new ControlLlamada({
      voz,
      nivel,
      sensibilidad: elegida,
      silenciado: !hayMicrofono,
      alCambiar: setEstado,
      // «Terminá la sesión»: el Agente se despide y la llamada se corta sola, como con el botón.
      alTerminar: () => void cortar(),
      turno: (pedido, senal) =>
        pedirTurno({ ...pedido, sesionId: sesion.id, canal: "voz", voz: c.estado.motor === "azure" ? "azure" : "navegador" }, senal),
    });
    control.current = c;
    setEstado({ ...c.estado, aviso });
    const volumen = setInterval(() => medir(c), MEDIR_CADA_MS);
    const uso = setInterval(reportarUso, 30_000);
    limpiezas.current.push(() => clearInterval(volumen), () => clearInterval(uso));
    // En una llamada o en la entrevista abre el Agente; en un chat de voz empieza la persona.
    await c.empezar(!yaEmpezada && sesion.kind !== "chat");
  }

  /** El botón del micrófono: silencia, vuelve a escuchar o, si nunca se activó, lo pide. */
  async function alternarMicrofono() {
    desbloquearAudio();
    const c = control.current;
    if (!c) return;
    if (conMicrofono) return c.silenciar(!c.estado.silenciado);
    if (vozDePrueba()) {
      setConMicrofono(true);
      return c.silenciar(false);
    }
    const abierto = await abrirMicrofono();
    if (!abierto) return c.avisar("No tengo permiso para usar el micrófono. Habilitalo en los ajustes del sitio; mientras tanto podés escribir.");
    const { voz, aviso } = await armarVoz(abierto.mic);
    c.ponerNivel(abierto.nivel);
    c.cambiarVoz(voz, aviso);
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

  async function cortar() {
    limpiar();
    setEstado((e) => (e ? { ...e, fase: "cerrada" } : e));
    await fetch(`/api/sesiones/${id}/cerrar`, { method: "POST" }).catch(() => null);
    void recargar();
    router.replace(`/sesiones/${id}`);
  }

  function pasarATexto() {
    limpiar();
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
          <Link href="/hoy" className="font-medium text-acento hover:text-acento-fuerte">Volver</Link>
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
          <button type="button" onClick={pasarATexto} className="rounded-sm text-sm text-texto-2 hover:text-texto">
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
  return (
    <div className={marco}>
      <header className="flex items-center justify-between gap-3">
        <p className="rotulo">{ROTULO[pantalla.sesion.kind] ?? "Llamada"}</p>
        {estado ? <p className="text-xs text-texto-3">Voz: {MOTOR[estado.motor]}</p> : null}
      </header>

      <div className="flex flex-col items-center gap-3 py-5">
        <span className="relative flex h-20 w-20 items-center justify-center">
          {/* Crece con tu voz: muestra que el micrófono te está oyendo, también mientras habla el Agente. */}
          <span
            ref={aro}
            aria-hidden
            className="absolute inset-0 rounded-full bg-ok/25 opacity-0 transition-[transform,opacity] duration-100 ease-out"
          />
          <span
            aria-hidden
            className={`relative flex h-20 w-20 items-center justify-center rounded-full border-2 transition-colors ${
              esperando && !silenciado
                ? "border-ok bg-ok-suave"
                : fase === "hablando"
                  ? "animate-pulse border-acento bg-acento-suave"
                  : "border-borde-fuerte bg-panel"
            }`}
          >
            {silenciado ? <MicOff size={28} className="text-texto-3" /> : <Mic size={28} className={esperando ? "text-ok" : fase === "hablando" ? "text-acento" : "text-texto-3"} />}
          </span>
        </span>
        <p role="status" aria-live="polite" className="text-lg font-medium">
          {silenciado && esperando ? (conMicrofono ? "Micrófono silenciado" : "Escribí abajo") : FASE[fase]}
        </p>
        <div className="flex min-h-8 flex-col items-center justify-center gap-1.5">
          {fase === "hablando" && puedeInterrumpirHablando ? (
            <>
              <span className="max-w-xs text-center text-xs text-texto-2">
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
            <span className="text-xs text-texto-3">
              {esperando ? (silenciado ? "El Agente te responde hablando" : "Hablá o escribí cuando quieras") : ""}
            </span>
          )}
        </div>
      </div>

      {estado?.aviso ? (
        <p role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-md border border-aviso/40 bg-panel px-3 py-2 text-[13px] text-texto-2">
          {estado.aviso}
          <button type="button" onClick={() => control.current?.quitarAviso()} className="shrink-0 font-medium text-texto hover:underline">
            Entendido
          </button>
        </p>
      ) : null}

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 overflow-y-auto" aria-label="Transcripción">
        {estado?.lineas.map((l) => (
          <div key={l.id} className={`flex flex-col gap-1.5 ${l.quien === "vos" ? "items-end" : "items-start"}`}>
            {l.texto ? (
              <p className={l.quien === "vos" ? "max-w-[85%] rounded-2xl rounded-br-md bg-elevado px-3.5 py-2" : "max-w-[92%] whitespace-pre-wrap leading-relaxed"}>
                {l.texto.trim()}
              </p>
            ) : null}
            {l.cambios.map((c) => (
              <div key={c.id || c.summary} className="w-full max-w-[92%]">
                <TarjetaCambio cambio={c} />
              </div>
            ))}
          </div>
        ))}
        {estado?.parcial ? <p className="max-w-[85%] self-end rounded-2xl rounded-br-md border border-dashed border-borde px-3.5 py-2 text-texto-2">{estado.parcial}</p> : null}
        <div ref={finTranscripcion} />
      </div>

      {/* Siempre se puede escribir: con el micrófono apagado, o cuando no conviene hablar. */}
      <form onSubmit={enviarTexto} className="mx-auto mt-3 flex w-full max-w-xl items-center gap-2 rounded-xl border border-borde-fuerte bg-elevado p-1.5">
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
          className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-[15px] placeholder:text-texto-3 focus:outline-none"
        />
        <Boton type="submit" variante="primario" aria-label="Enviar" disabled={!texto.trim() || !estado} className="!h-9 !w-9 shrink-0 !rounded-lg !px-0">
          <ArrowUp size={18} aria-hidden />
        </Boton>
      </form>

      <div className="mx-auto mt-3 flex w-full max-w-xl items-center justify-center gap-3">
        <Boton
          className="!h-14 flex-1 !rounded-full"
          aria-pressed={!silenciado}
          onClick={() => void alternarMicrofono()}
        >
          {silenciado ? <MicOff size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
          {silenciado ? (conMicrofono ? "Activar" : "Usar micrófono") : "Silenciar"}
        </Boton>
        <Boton className="!h-14 flex-1 !rounded-full" onClick={pasarATexto}>
          <MessageSquareText size={18} aria-hidden />
          A texto
        </Boton>
        <Boton variante="peligro" className="!h-14 flex-1 !rounded-full" onClick={() => void cortar()}>
          <PhoneOff size={18} aria-hidden />
          Cortar
        </Boton>
      </div>
    </div>
  );
}
