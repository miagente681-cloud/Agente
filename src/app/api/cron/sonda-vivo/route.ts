import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { definiciones } from "@/lib/agente/herramientas";
import type { Sensibilidad } from "@/lib/voz/deteccion";
import {
  aBase64,
  bytesDe,
  deBase64,
  leerMensaje,
  mensajeDeAjustes,
  mensajeDeAudio,
  mensajeDeRespuestas,
  mensajeDeTexto,
  pcmAMuestras,
  Remuestreador,
  type EventoVivo,
} from "@/lib/voz/vivo/protocolo";
import { ajustesVivo, configVivo, pedirTokenVivo, type ConfigVivo, type FormatoHerramientas } from "@/lib/voz/vivo/servidor";
import { VOZ_VIVO_POR_DEFECTO } from "@/lib/voz/vivo/tipos";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * TEMPORAL: sonda para comprobar el protocolo de la llamada en vivo contra el
 * servicio real antes de habilitarla (ver DECISIONES.md). Abre una sesión de
 * prueba desde el servidor, le escribe una frase y devuelve qué contestó el
 * servicio (tipos de mensaje y tamaños, sin audio). No toca datos de nadie.
 * Se protege con una clave larga de la que acá solo está la huella; se borra
 * cuando la llamada en vivo quede habilitada.
 */
const HUELLA = "aeb1026ba0a71a45ea45456185984290f6fea062560507263bd7b5e91780952c";
const huella = (s: string) => createHash("sha256").update(s).digest();

const SISTEMA =
  "Sos un asistente de prueba. Hablá en español rioplatense y respondé en una sola frase corta. Si te piden crear un área, usá la herramienta crear_area y después confirmá en una frase.";

type Anotar = (texto: string) => void;

/** Abre una sesión y entrega cada evento. Termina cuando el servicio acepta los ajustes (o null si no se pudo). */
async function abrir(config: ConfigVivo, ajustes: unknown, anotar: Anotar, alEvento: (e: EventoVivo, socket: WebSocket) => void): Promise<WebSocket | null> {
  const token = await pedirTokenVivo(config, ajustes);
  if (!token.ok) {
    anotar(`token: ${token.estado} ${token.detalle}`);
    return null;
  }
  return new Promise((listo) => {
    const socket = new WebSocket(token.url);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => socket.send(JSON.stringify(mensajeDeAjustes(ajustes)));
    socket.onclose = (e) => {
      if (e.code !== 1000) anotar(`cierre ${e.code} ${e.reason}`.trim());
      listo(null);
    };
    socket.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
      const crudo = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data));
      for (const evento of leerMensaje(crudo)) {
        if (evento.tipo === "listo") listo(socket);
        else alEvento(evento, socket);
      }
    };
  });
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Prueba con voz de verdad: le pide al servicio que diga una frase, y después
 * usa ese audio como si fuera el micrófono de la persona en otra sesión.
 * Comprueba que el audio que mandamos se entiende, cuánto tarda en responder y
 * que hablarle encima lo interrumpe.
 */
async function probarConVoz(config: ConfigVivo, sensibilidad: Sensibilidad, anotar: Anotar): Promise<void> {
  // 1. Conseguir una frase hablada.
  const trozos: Uint8Array[] = [];
  let lista = false;
  const a = await abrir(
    config,
    ajustesVivo({ modelo: config.modelo, sistema: "Decí exactamente lo que te pidan, sin agregar nada.", herramientas: [], voz: "Kore", sensibilidad: "normal" }),
    anotar,
    (e) => {
      if (e.tipo === "audio") trozos.push(deBase64(e.datos));
      else if (e.tipo === "fin_turno") lista = true;
    },
  );
  if (!a) return anotar("no se pudo abrir la primera sesión");
  a.send(JSON.stringify(mensajeDeTexto("Decí exactamente: Hola, ¿me escuchás? Quiero que me cuentes con detalle cómo viene mi semana.")));
  for (let i = 0; i < 150 && !lista; i++) await pausa(100);
  a.close(1000);
  const bytes = new Uint8Array(trozos.reduce((n, t) => n + t.length, 0));
  let hasta = 0;
  for (const t of trozos) {
    bytes.set(t, hasta);
    hasta += t.length;
  }
  // De 24 kHz (como habla el servicio) a 16 kHz (como viaja el micrófono).
  const frase = new Remuestreador(24_000).procesar(pcmAMuestras(bytes));
  const duracion = Math.round(frase.length / 16);
  anotar(`frase lista: ${duracion} ms de voz`);
  if (duracion < 500) return anotar("no hay frase para probar");

  // 2. Otra sesión: esa frase entra como micrófono, de a 40 ms y a velocidad real.
  let cola = new Int16Array(0);
  let entendido = "";
  let dicho = "";
  let audio = 0;
  let finDeLaFrase = 0;
  let primerAudio = 0;
  let encimaDesde = 0;
  let interrumpido = 0;
  let turnosTrasInterrumpir = 0;
  const b = await abrir(
    config,
    ajustesVivo({
      modelo: config.modelo,
      sistema: "Sos un asistente de prueba. Cuando te hablen, respondé con un relato largo, de al menos doce oraciones, en español rioplatense.",
      herramientas: definiciones(),
      voz: VOZ_VIVO_POR_DEFECTO,
      sensibilidad,
    }),
    anotar,
    (e, socket) => {
      if (e.tipo === "dijiste") entendido += e.texto;
      else if (e.tipo === "dice") dicho += e.texto;
      else if (e.tipo === "audio") {
        audio += deBase64(e.datos).length;
        if (!primerAudio) {
          primerAudio = Date.now();
          anotar(`primer audio de la respuesta, ${primerAudio - finDeLaFrase} ms después de terminar la frase (entendió «${entendido}»)`);
        }
      } else if (e.tipo === "interrumpido") {
        interrumpido = Date.now();
        anotar(`interrupted ${encimaDesde ? `${interrumpido - encimaDesde} ms después de empezar a hablarle encima` : "sin haberle hablado encima"} (llevaba ${Math.round(audio / 48)} ms de audio, dijo «${dicho.slice(0, 80)}»)`);
        dicho = "";
        audio = 0;
      } else if (e.tipo === "llamadas") {
        anotar(`toolCall ${e.llamadas.map((l) => l.nombre).join(",")}`);
        socket.send(JSON.stringify(mensajeDeRespuestas(e.llamadas.map((l) => ({ id: l.id, nombre: l.nombre, resultado: { ok: true } })))));
      } else if (e.tipo === "fin_turno") {
        anotar(`turnComplete (audio ${Math.round(audio / 48)} ms, dijo «${dicho.slice(0, 80)}», entendió «${entendido}»)`);
        if (interrumpido && audio) turnosTrasInterrumpir++;
      }
    },
  );
  if (!b) return anotar("no se pudo abrir la segunda sesión");
  const reloj = setInterval(() => {
    const trozo = new Int16Array(640);
    trozo.set(cola.subarray(0, 640));
    cola = cola.subarray(Math.min(640, cola.length));
    if (b.readyState === WebSocket.OPEN) b.send(JSON.stringify(mensajeDeAudio(aBase64(bytesDe(trozo)))));
  }, 40);
  try {
    await pausa(600);
    cola = frase.slice();
    finDeLaFrase = Date.now() + duracion;
    anotar("empieza a hablar");
    for (let i = 0; i < 150 && !primerAudio; i++) await pausa(100);
    if (!primerAudio) return anotar(`no respondió a la voz (entendió «${entendido}»)`);
    // Le habla encima un segundo y medio después de que empezó a responder.
    await pausa(1500);
    entendido = "";
    cola = frase.slice();
    encimaDesde = Date.now();
    anotar("le habla encima");
    for (let i = 0; i < 200 && !turnosTrasInterrumpir; i++) await pausa(100);
    if (!interrumpido) anotar("NO lo interrumpió");
  } finally {
    clearInterval(reloj);
    b.close(1000);
  }
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  if (!timingSafeEqual(huella(q.get("clave") ?? ""), Buffer.from(HUELLA, "hex"))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  const base = configVivo(process.env, { aunqueNoEsteDisponible: true });
  if (!base) return NextResponse.json({ error: "Falta GEMINI_API_KEY" });
  const config = { ...base, modelo: q.get("modelo") || base.modelo };

  if (q.get("listar")) {
    const r = await fetch(`${config.base}/v1beta/models?pageSize=1000`, { headers: { "x-goog-api-key": config.clave } });
    const cuerpo = (await r.json().catch(() => null)) as {
      models?: { name: string; supportedGenerationMethods?: string[] }[];
      error?: { message?: string };
    } | null;
    return NextResponse.json({
      estado: r.status,
      error: cuerpo?.error?.message,
      total: cuerpo?.models?.length ?? 0,
      enVivo: (cuerpo?.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).some((x) => /bidi/i.test(x)) || /live|audio/i.test(m.name))
        .map((m) => `${m.name} [${(m.supportedGenerationMethods ?? []).join(",")}]`),
    });
  }

  const inicio = Date.now();
  const traza: string[] = [];
  const anotar = (texto: string) => traza.push(`${Date.now() - inicio} ms · ${texto}`);
  if (q.get("modo") === "voz") {
    if (typeof WebSocket === "undefined") return NextResponse.json({ error: "Este servidor no tiene WebSocket" });
    await probarConVoz(config, (q.get("sensibilidad") as Sensibilidad | null) ?? "normal", anotar);
    return NextResponse.json({ modelo: config.modelo, traza });
  }
  const ajustes = ajustesVivo({
    modelo: config.modelo,
    sistema: SISTEMA,
    herramientas: definiciones(),
    voz: q.get("voz") || VOZ_VIVO_POR_DEFECTO,
    sensibilidad: "normal",
    formato: (q.get("herramientas") as FormatoHerramientas | null) ?? "json",
  });
  for (const campo of (q.get("quitar") ?? "").split(",").filter(Boolean)) delete ajustes[campo];
  const token = await pedirTokenVivo(config, ajustes);
  anotar(token.ok ? "token: ok" : `token: ${token.estado} ${token.detalle}`);
  if (!token.ok) return NextResponse.json({ modelo: config.modelo, traza });
  if (typeof WebSocket === "undefined") return NextResponse.json({ modelo: config.modelo, traza, error: "Este servidor no tiene WebSocket" });

  const texto = q.get("texto") || "Decí solamente: hola, probando.";
  const comoCliente = q.get("entrada") === "cliente";
  const enviarTexto = (socket: WebSocket, t: string) =>
    socket.send(
      JSON.stringify(comoCliente ? { clientContent: { turns: [{ role: "user", parts: [{ text: t }] }], turnComplete: true } } : mensajeDeTexto(t)),
    );
  const espera = Math.min(Number(q.get("espera")) || 20, 50) * 1000;

  await new Promise<void>((listo) => {
    const socket = new WebSocket(token.url);
    socket.binaryType = "arraybuffer";
    let audio = 0;
    let trozos = 0;
    let dicho = "";
    let entendido = "";
    let interrumpio = false;
    let esperaHerramienta = false;
    const cerrar = (motivo: string) => {
      anotar(motivo);
      clearTimeout(reloj);
      try {
        socket.close(1000);
      } catch {
        // Ya estaba cerrada.
      }
      listo();
    };
    const reloj = setTimeout(() => cerrar(`se acabó el tiempo (audio ${audio} bytes en ${trozos} trozos, dijo «${dicho}»)`), espera);
    socket.onopen = () => {
      anotar("socket abierto");
      socket.send(JSON.stringify(mensajeDeAjustes(q.get("ajustes") === "minimo" ? { model: `models/${config.modelo}` } : ajustes)));
    };
    socket.onerror = () => anotar("error del socket");
    socket.onclose = (e) => {
      anotar(`cierre ${e.code} ${e.reason}`.trim());
      clearTimeout(reloj);
      listo();
    };
    socket.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
      const crudo = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)) as Record<string, unknown>;
      const contenido = crudo.serverContent as Record<string, unknown> | undefined;
      const otros = Object.keys(crudo).filter((k) => !["serverContent", "setupComplete", "toolCall", "usageMetadata"].includes(k));
      if (otros.length) anotar(`otros: ${JSON.stringify(crudo).slice(0, 300)}`);
      if (contenido) {
        const raros = Object.keys(contenido).filter(
          (k) => !["modelTurn", "outputTranscription", "inputTranscription", "turnComplete", "interrupted", "generationComplete"].includes(k),
        );
        if (raros.length) anotar(`campos: ${raros.join(",")}`);
        if (contenido.generationComplete) anotar("generationComplete");
      }
      for (const evento of leerMensaje(crudo)) {
        if (evento.tipo === "listo") {
          anotar(`setupComplete ${JSON.stringify(crudo.setupComplete).slice(0, 200)}`);
          if (q.get("silencio")) {
            // Medio segundo de silencio: comprueba que el formato del audio se acepta.
            for (let i = 0; i < 5; i++) socket.send(JSON.stringify(mensajeDeAudio(aBase64(new Uint8Array(3200)))));
            anotar("audio de prueba enviado");
          }
          enviarTexto(socket, texto);
          anotar(`texto enviado (${comoCliente ? "clientContent" : "realtimeInput"})`);
        } else if (evento.tipo === "audio") {
          if (!trozos) anotar(`primer audio (tasa ${evento.tasa})`);
          trozos++;
          audio += Math.floor((evento.datos.length * 3) / 4);
          if (q.get("interrumpir") && !interrumpio && trozos >= 3) {
            interrumpio = true;
            enviarTexto(socket, "Pará. Decí solamente: listo.");
            anotar("texto enviado encima de la respuesta");
          }
        } else if (evento.tipo === "dice") dicho += evento.texto;
        else if (evento.tipo === "dijiste") entendido += evento.texto;
        else if (evento.tipo === "interrumpido") anotar(`interrupted (audio ${audio} bytes, dijo «${dicho}»)`);
        else if (evento.tipo === "llamadas") {
          anotar(`toolCall ${JSON.stringify(evento.llamadas).slice(0, 300)}`);
          esperaHerramienta = true;
          socket.send(
            JSON.stringify(mensajeDeRespuestas(evento.llamadas.map((l) => ({ id: l.id, nombre: l.nombre, resultado: { ok: true, nota: "Hecho (prueba)." } })))),
          );
          anotar("toolResponse enviado");
        } else if (evento.tipo === "canceladas") anotar(`toolCallCancellation ${evento.ids.join(",")}`);
        else if (evento.tipo === "se_va") anotar(`goAway ${evento.ms} ms`);
        else if (evento.tipo === "fin_turno") {
          anotar(`turnComplete (audio ${audio} bytes en ${trozos} trozos, dijo «${dicho}», entendió «${entendido}»)`);
          // Tras una herramienta o una interrupción falta el turno que sigue.
          if (esperaHerramienta && !audio) continue;
          if (interrumpio && !/listo/i.test(dicho)) continue;
          cerrar("fin");
        }
      }
    };
  });
  return NextResponse.json({ modelo: config.modelo, traza });
}
