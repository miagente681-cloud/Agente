import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { definiciones } from "@/lib/agente/herramientas";
import {
  leerMensaje,
  mensajeDeAjustes,
  mensajeDeAudio,
  mensajeDeRespuestas,
  mensajeDeTexto,
  aBase64,
} from "@/lib/voz/vivo/protocolo";
import { ajustesVivo, configVivo, pedirTokenVivo, type FormatoHerramientas } from "@/lib/voz/vivo/servidor";
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
