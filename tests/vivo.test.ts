import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { definiciones } from "@/lib/agente/herramientas";
import type { EstadoLlamada } from "@/lib/voz/llamada";
import type { AlEnchufe } from "@/lib/voz/vivo/conexion";
import { LlamadaEnVivo, type OpcionesVivo } from "@/lib/voz/vivo/llamada";
import {
  aBase64,
  bytesDe,
  deBase64,
  leerMensaje,
  mensajeDeRespuestas,
  pcmAMuestras,
  Remuestreador,
  RUTA_SOCKET,
  volumenDe,
} from "@/lib/voz/vivo/protocolo";
import { ajustesVivo, configVivo, pedirTokenVivo, transcripcionPrevia } from "@/lib/voz/vivo/servidor";
import type { PedidoTurnoVivo, RespuestaSesionViva, ResultadoTurnoVivo } from "@/lib/voz/vivo/tipos";
import { levantarModelos, type ServidorModelos } from "./apoyo/falsos";

/**
 * La llamada en vivo: el formato de los mensajes, el audio y el control de la
 * conversación, con el servicio de voz de mentira. Comprueba la lógica; no
 * reemplaza una prueba con el servicio real ni con un teléfono.
 */

const AUDIO = aBase64(bytesDe(new Int16Array(2400).fill(1000))); // 100 ms a 24 kHz
const audio = { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: AUDIO } }] } } };
const dice = (text: string) => ({ serverContent: { outputTranscription: { text } } });
const dijiste = (text: string) => ({ serverContent: { inputTranscription: { text } } });
const finTurno = { serverContent: { turnComplete: true } };
const interrumpido = { serverContent: { interrupted: true } };

describe("mensajes de la API en vivo", () => {
  it("traduce lo que llega: audio, transcripciones, fin de turno e interrupción", () => {
    expect(leerMensaje({ setupComplete: {} })).toEqual([{ tipo: "listo" }]);
    expect(
      leerMensaje({
        serverContent: {
          modelTurn: { parts: [{ text: "razonamiento", thought: true }, { inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAAA" } }] },
          outputTranscription: { text: "Hola" },
          inputTranscription: { text: "buen día" },
          turnComplete: true,
        },
      }),
    ).toEqual([
      { tipo: "dijiste", texto: "buen día" },
      { tipo: "audio", datos: "AAAA", tasa: 24000 },
      { tipo: "dice", texto: "Hola" },
      { tipo: "fin_turno" },
    ]);
    // La interrupción va primero: lo demás del mensaje ya es de otro turno.
    expect(leerMensaje({ serverContent: { interrupted: true, turnComplete: true } }).map((e) => e.tipo)).toEqual(["interrumpido", "fin_turno"]);
  });

  it("traduce llamadas a herramientas, cancelaciones y el aviso de corte", () => {
    expect(leerMensaje({ toolCall: { functionCalls: [{ id: "f1", name: "crear_area", args: { nombre: "Casa" } }] } })).toEqual([
      { tipo: "llamadas", llamadas: [{ id: "f1", nombre: "crear_area", argumentos: { nombre: "Casa" } }] },
    ]);
    expect(leerMensaje({ toolCallCancellation: { ids: ["f1"] } })).toEqual([{ tipo: "canceladas", ids: ["f1"] }]);
    expect(leerMensaje({ goAway: { timeLeft: "9.5s" } })).toEqual([{ tipo: "se_va", ms: 9500 }]);
    expect(leerMensaje({ usageMetadata: { totalTokenCount: 3 } })).toEqual([]);
    expect(leerMensaje(null)).toEqual([]);
  });

  it("devuelve el resultado de una herramienta con su id", () => {
    expect(mensajeDeRespuestas([{ id: "f1", nombre: "crear_area", resultado: { ok: true } }])).toEqual({
      toolResponse: { functionResponses: [{ id: "f1", name: "crear_area", response: { resultado: { ok: true } } }] },
    });
  });
});

describe("audio de la llamada en vivo", () => {
  it("baja el micrófono a 16 kHz sin perder ni inventar muestras entre trozos", () => {
    const de48 = new Remuestreador(48_000);
    expect(de48.procesar(new Float32Array(4800).fill(0.5))).toHaveLength(1600);
    // 44,1 kHz no es múltiplo de 16: lo que sobra de un trozo se usa en el siguiente.
    const de441 = new Remuestreador(44_100);
    let total = 0;
    for (let i = 0; i < 50; i++) total += de441.procesar(new Float32Array(2048).fill(0.25)).length;
    expect(Math.abs(total - Math.round((50 * 2048 * 16_000) / 44_100))).toBeLessThanOrEqual(1);
    const salida = de441.procesar(new Float32Array(2048).fill(0.25));
    expect(new Set(salida)).toEqual(new Set([Math.round(0.25 * 32767)]));
  });

  it("no se pasa de rango y mide el volumen", () => {
    const fuerte = new Remuestreador(16_000).procesar(new Float32Array([2, -2, 0]));
    expect([...fuerte]).toEqual([32767, -32767, 0]);
    expect(volumenDe(new Int16Array(100))).toBe(0);
    expect(volumenDe(new Int16Array(100).fill(16384))).toBeCloseTo(0.5, 2);
  });

  it("el PCM va y vuelve en base64 sin cambiar", () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 12345]);
    const vuelta = pcmAMuestras(deBase64(aBase64(bytesDe(pcm))));
    expect([...vuelta].map((x) => Math.round(x * 32768))).toEqual([...pcm]);
    // Un trozo grande no revienta la conversión.
    expect(deBase64(aBase64(new Uint8Array(200_000).fill(7)))).toHaveLength(200_000);
  });
});

describe("ajustes y token de la llamada en vivo", () => {
  let servidor: ServidorModelos;
  let url: string;
  beforeAll(async () => {
    ({ servidor, url } = await levantarModelos());
  });
  afterAll(() => servidor.close());
  beforeEach(() => servidor.reiniciar());

  const ajustes = (sensibilidad: "alta" | "normal" | "baja" | "apagada" = "normal") =>
    ajustesVivo({ modelo: "gemini-vivo", sistema: "Sos el Agente.", herramientas: definiciones(["crear_area"]), voz: "Charon", sensibilidad });

  it("pide audio, transcripciones y las herramientas del Agente", () => {
    const a = ajustes() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(a.model).toBe("models/gemini-vivo");
    expect(a.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(a.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Charon");
    expect(a.systemInstruction.parts[0].text).toBe("Sos el Agente.");
    expect(a.tools[0].functionDeclarations[0]).toMatchObject({ name: "crear_area", parametersJsonSchema: { type: "object" } });
    expect(a).toMatchObject({ inputAudioTranscription: {}, outputAudioTranscription: {} });
  });

  it("la sensibilidad elegida decide qué tan fácil se corta al Agente", () => {
    const escucha = (s: Parameters<typeof ajustes>[0]) => (ajustes(s) as Record<string, any>).realtimeInputConfig; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(escucha("normal")).toEqual({ activityHandling: "START_OF_ACTIVITY_INTERRUPTS" });
    expect(escucha("alta").automaticActivityDetection.startOfSpeechSensitivity).toBe("START_SENSITIVITY_HIGH");
    expect(escucha("baja").automaticActivityDetection.startOfSpeechSensitivity).toBe("START_SENSITIVITY_LOW");
    expect(escucha("apagada")).toEqual({ activityHandling: "NO_INTERRUPTION" });
  });

  it("una conexión nueva recibe lo último que se habló", () => {
    expect(transcripcionPrevia([{ role: "sistema", content: "(Empieza la sesión.)" }])).toBe("");
    const texto = transcripcionPrevia([
      { role: "usuario", content: "Lo del patio lo terminé." },
      { role: "herramienta", content: null },
      { role: "agente", content: "Bien. ¿Y los azulejos?" },
    ]);
    expect(texto).toContain("Persona: Lo del patio lo terminé.\nVos: Bien. ¿Y los azulejos?");
    expect(texto).toContain("no vuelvas a saludar");
  });

  it("pide un token de un solo uso con los ajustes fijados; la clave no viaja en la dirección", async () => {
    const config = configVivo({ GEMINI_API_KEY: "clave-g", GEMINI_BASE_URL: url, GEMINI_MODEL_VIVO: "gemini-vivo" });
    expect(config).toMatchObject({ modelo: "gemini-vivo" });
    const ahora = new Date("2026-11-20T15:00:00Z");
    const token = await pedirTokenVivo(config!, ajustes(), ahora);
    expect(token).toMatchObject({ ok: true });
    const pedido = servidor.pedidos()[0];
    expect(pedido.cabeceras["x-goog-api-key"]).toBe("clave-g");
    expect(pedido.cuerpo).toMatchObject({ uses: 1, expireTime: "2026-11-20T15:30:00.000Z", newSessionExpireTime: "2026-11-20T15:02:00.000Z" });
    expect(pedido.cuerpo.bidiGenerateContentSetup.model).toBe("models/gemini-vivo");
    const direccion = (token as { url: string }).url;
    expect(direccion).toContain(`${url.replace("http", "ws")}${RUTA_SOCKET}?access_token=auth_tokens%2Fprueba-1`);
    expect(direccion).not.toContain("clave-g");
  });

  it("si el servicio no da el token, devuelve el motivo sin romperse", async () => {
    servidor.guion([{ proveedor: "vivo", estado: 404, mensaje: "models/gemini-vivo is not found" }]);
    const config = configVivo({ GEMINI_API_KEY: "clave-g", GEMINI_BASE_URL: url })!;
    expect(await pedirTokenVivo(config, ajustes())).toEqual({ ok: false, estado: 404, detalle: "models/gemini-vivo is not found" });
    expect(await pedirTokenVivo({ ...config, base: "http://127.0.0.1:9" }, ajustes())).toMatchObject({ ok: false, estado: 0 });
  });

  it("sin la clave de Gemini no hay llamada en vivo", () => {
    expect(configVivo({})).toBeNull();
    expect(configVivo({ GEMINI_API_KEY: "  " }, { aunqueNoEsteDisponible: true })).toBeNull();
    expect(configVivo({ GEMINI_API_KEY: "k" }, { aunqueNoEsteDisponible: true })).toMatchObject({
      base: "https://generativelanguage.googleapis.com",
    });
  });
});

// --- El control de la llamada, con todo de mentira -----------------------------------

type Mensaje = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function armar(opciones: Partial<OpcionesVivo> & { sesiones?: RespuestaSesionViva[]; resultados?: (ResultadoTurnoVivo | null)[] } = {}) {
  const enchufes: { url: string; al: AlEnchufe; enviados: Mensaje[]; cerrado: boolean }[] = [];
  const parlante = {
    cola: 0,
    cortes: 0,
    sonando: false,
    alCallar: null as (() => void) | null,
    encolar() {
      this.cola++;
      this.sonando = true;
    },
    cortar() {
      this.cortes++;
      this.sonando = false;
    },
    /** Terminó de sonar lo que había en cola. */
    callar() {
      this.sonando = false;
      this.alCallar?.();
    },
  };
  const estados: EstadoLlamada[] = [];
  const guardados: PedidoTurnoVivo[] = [];
  const sesiones: { inicio: boolean }[] = [];
  const informes: string[] = [];
  const respuestasDeSesion = [...(opciones.sesiones ?? [])];
  const resultados = [...(opciones.resultados ?? [])];
  let n = 0;
  const c = new LlamadaEnVivo({
    parlante,
    alCambiar: (e) => estados.push(e),
    informar: (evento, detalle) => informes.push(`${evento}${detalle ? `: ${detalle}` : ""}`),
    abrir(url, al) {
      const e = { url, al, enviados: [] as Mensaje[], cerrado: false };
      enchufes.push(e);
      queueMicrotask(() => al.abierto());
      return { enviar: (m) => e.enviados.push(m as Mensaje), cerrar: () => (e.cerrado = true) };
    },
    async pedirSesion(p) {
      sesiones.push({ inicio: p.inicio });
      return respuestasDeSesion.shift() ?? { vivo: true, url: `ws://servicio/${++n}`, ajustes: { model: "models/x" }, modelo: "x", apertura: p.inicio ? "(Abrí vos.)" : null };
    },
    async guardar(pedido) {
      guardados.push(pedido);
      return resultados.length ? resultados.shift()! : { respuestas: (pedido.llamadas ?? []).map((l) => ({ id: l.id, nombre: l.nombre, resultado: { ok: true } })), cambios: [], terminar: false };
    },
    ...opciones,
  });
  const ultimo = () => enchufes[enchufes.length - 1];
  /** El servicio manda mensajes por la conexión vigente. */
  const llega = (...mensajes: unknown[]) => {
    for (const m of mensajes) ultimo().al.eventos(leerMensaje(m));
  };
  /** Conecta y deja la llamada lista. */
  const conectar = async (abre = false) => {
    const pendiente = c.empezar(abre);
    await vi.waitFor(() => expect(ultimo()?.enviados[0]?.setup).toBeTruthy());
    llega({ setupComplete: {} });
    expect(await pendiente).toBe("ok");
  };
  const textos = () => ultimo().enviados.flatMap((m) => (m.realtimeInput?.text ? [m.realtimeInput.text] : []));
  const audios = () => ultimo().enviados.filter((m) => m.realtimeInput?.audio).length;
  const lineas = () => c.estado.lineas.map((l) => `${l.quien}: ${l.texto}`);
  return { c, enchufes, parlante, estados, guardados, sesiones, informes, ultimo, llega, conectar, textos, audios, lineas };
}

describe("control de la llamada en vivo", () => {
  afterEach(() => vi.useRealTimers());

  it("al atender manda los ajustes y, si le toca abrir, se lo pide al Agente", async () => {
    const t = armar();
    await t.conectar(true);
    expect(t.sesiones).toEqual([{ inicio: true }]);
    expect(t.ultimo().enviados[0]).toEqual({ setup: { model: "models/x" } });
    expect(t.textos()).toEqual(["(Abrí vos.)"]);
    expect(t.c.estado).toMatchObject({ fase: "pensando", motor: "vivo" });
  });

  it("el Agente habla: suena su audio, se ve lo que dice y al terminar se vuelve a escuchar", async () => {
    const t = armar();
    await t.conectar(true);
    t.llega(audio, dice("Hola. "), audio, dice("¿Saliste a correr?"));
    expect(t.c.estado.fase).toBe("hablando");
    expect(t.parlante.cola).toBe(2);
    expect(t.lineas()).toEqual(["agente: Hola. ¿Saliste a correr?"]);
    // El servicio da el turno por terminado, pero todavía suena lo último: sigue «hablando».
    t.llega(finTurno);
    expect(t.c.estado.fase).toBe("hablando");
    t.parlante.callar();
    expect(t.c.estado.fase).toBe("escuchando");
    await t.c.pendientes();
    expect(t.guardados).toEqual([{ agente: "Hola. ¿Saliste a correr?" }]);
  });

  it("el micrófono viaja todo el tiempo, también mientras el Agente habla", async () => {
    const t = armar();
    await t.conectar();
    const trozo = new Int16Array(640).fill(500);
    t.c.recibirAudio(trozo);
    t.llega(audio, dice("Te cuento…"));
    expect(t.c.estado.fase).toBe("hablando");
    t.c.recibirAudio(trozo);
    t.c.recibirAudio(trozo);
    expect(t.audios()).toBe(3);
    const enviado = t.ultimo().enviados.find((m) => m.realtimeInput?.audio)!.realtimeInput.audio;
    expect(enviado.mimeType).toBe("audio/pcm;rate=16000");
    expect(deBase64(enviado.data)).toHaveLength(1280);
  });

  it("si le hablo encima, se calla en el acto y me escucha, sin tocar nada", async () => {
    const t = armar();
    await t.conectar();
    t.llega(audio, dice("Te decía que lo del patio"));
    expect(t.c.estado.fase).toBe("hablando");
    // El servicio detecta mi voz: avisa la interrupción y cierra el turno cortado.
    t.llega(interrumpido, finTurno);
    expect(t.parlante.cortes).toBe(1);
    expect(t.c.estado.fase).toBe("escuchando");
    // Lo que digo y su respuesta son un intercambio nuevo, en orden.
    t.llega(dijiste("Pará, "), dijiste("eso ya lo hice."), audio, dice("Perfecto, lo marco."), finTurno);
    t.parlante.callar();
    expect(t.lineas()).toEqual(["agente: Te decía que lo del patio", "vos: Pará, eso ya lo hice.", "agente: Perfecto, lo marco."]);
    await t.c.pendientes();
    expect(t.guardados).toEqual([{ agente: "Te decía que lo del patio" }, { usuario: "Pará, eso ya lo hice.", agente: "Perfecto, lo marco." }]);
  });

  it("lo que dije queda antes de la respuesta aunque su transcripción llegue tarde", async () => {
    const t = armar();
    await t.conectar();
    t.llega(audio, dice("Dale, "), dijiste("Mové lo del patio al jueves."), dice("lo paso al jueves."), finTurno);
    expect(t.lineas()).toEqual(["vos: Mové lo del patio al jueves.", "agente: Dale, lo paso al jueves."]);
  });

  it("las herramientas se aplican en el servidor y el resultado vuelve al servicio", async () => {
    const cambio = { id: "c1", table_name: "tasks", row_id: "t1", operation: "actualizar" as const, summary: "Lo del patio: hecha" };
    const t = armar({ resultados: [{ respuestas: [{ id: "f1", nombre: "actualizar_tarea", resultado: { ok: true } }], cambios: [cambio], terminar: false }] });
    await t.conectar();
    const llamadas = [{ id: "f1", name: "actualizar_tarea", args: { tarea_id: "ab12cd34", estado: "hecha" } }];
    t.llega(dijiste("Lo del patio lo terminé."), { toolCall: { functionCalls: llamadas } });
    expect(t.c.estado.fase).toBe("pensando");
    await t.c.pendientes();
    // Se guarda lo dicho hasta ahí junto con la llamada, para que la transcripción quede en orden.
    expect(t.guardados[0]).toEqual({
      usuario: "Lo del patio lo terminé.",
      llamadas: [{ id: "f1", nombre: "actualizar_tarea", argumentos: { tarea_id: "ab12cd34", estado: "hecha" } }],
    });
    expect(t.ultimo().enviados.at(-1)).toEqual({
      toolResponse: { functionResponses: [{ id: "f1", name: "actualizar_tarea", response: { resultado: { ok: true } } }] },
    });
    expect(t.c.estado.lineas.at(-1)).toMatchObject({ quien: "agente", cambios: [cambio] });
    t.llega(audio, dice("Listo, la marqué como hecha."), finTurno);
    t.parlante.callar();
    await t.c.pendientes();
    expect(t.guardados[1]).toEqual({ agente: "Listo, la marqué como hecha." });
  });

  it("como en el servicio real: el turno se cierra al pedir la herramienta y la respuesta llega en otro", async () => {
    let soltar: (() => void) | null = null;
    const t = armar({
      guardar: (pedido) =>
        pedido.llamadas
          ? new Promise((listo) => {
              soltar = () => listo({ respuestas: pedido.llamadas!.map((l) => ({ id: l.id, nombre: l.nombre, resultado: { ok: true } })), cambios: [], terminar: false });
            })
          : Promise.resolve({ respuestas: [], cambios: [], terminar: false }),
    });
    await t.conectar();
    t.llega(dijiste("Creá el área Casa."), { toolCall: { functionCalls: [{ id: "f1", name: "crear_area", args: { nombre: "Casa" } }] } }, finTurno);
    // El servicio ya cerró el turno, pero la herramienta sigue aplicándose: no es «Te escucho» todavía.
    expect(t.c.estado.fase).toBe("pensando");
    await vi.waitFor(() => expect(soltar).toBeTruthy());
    soltar!();
    await t.c.pendientes();
    t.llega(audio, dice("Listo, creé el área Casa."), finTurno);
    t.parlante.callar();
    expect(t.c.estado.fase).toBe("escuchando");
    expect(t.lineas()).toEqual(["vos: Creá el área Casa.", "agente: ", "agente: Listo, creé el área Casa."]);
  });

  it("si pidió terminar y el Agente ya se había despedido, la llamada se corta igual", async () => {
    vi.useFakeTimers();
    const alTerminar = vi.fn();
    const t = armar({ alTerminar, resultados: [{ respuestas: [{ id: "f1", nombre: "terminar_sesion", resultado: { ok: true } }], cambios: [], terminar: true }] });
    const pendiente = t.c.empezar(false);
    await vi.advanceTimersByTimeAsync(0);
    t.llega({ setupComplete: {} });
    await pendiente;
    t.llega(audio, dice("Dale, nos vemos."), { toolCall: { functionCalls: [{ id: "f1", name: "terminar_sesion", args: {} }] } }, finTurno);
    t.parlante.callar();
    await vi.advanceTimersByTimeAsync(100);
    expect(alTerminar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(7000);
    expect(alTerminar).toHaveBeenCalledOnce();
  });

  it("tras «Interrumpir», si hablo, la respuesta nueva suena aunque el servicio no avise el corte", async () => {
    const t = armar();
    await t.conectar();
    t.llega(audio, dice("Tenés tres cosas"));
    t.c.interrumpir();
    t.llega(dijiste("¿Qué hora es?"), audio, dice("Las cinco."));
    expect(t.parlante.cola).toBe(2);
    expect(t.lineas().at(-1)).toBe("agente: Las cinco.");
  });

  it("si no se pudo aplicar, el Agente se entera; si interrumpí antes, no se le responde", async () => {
    const t = armar({ resultados: [null, { respuestas: [{ id: "f2", nombre: "crear_area", resultado: { ok: true } }], cambios: [], terminar: false }] });
    await t.conectar();
    t.llega({ toolCall: { functionCalls: [{ id: "f1", name: "crear_area", args: { nombre: "Casa" } }] } });
    await t.c.pendientes();
    expect(t.ultimo().enviados.at(-1)!.toolResponse.functionResponses[0].response.resultado.error).toContain("No se pudo aplicar");
    const antes = t.ultimo().enviados.length;
    t.llega({ toolCall: { functionCalls: [{ id: "f2", name: "crear_area", args: { nombre: "Trabajo" } }] } }, { toolCallCancellation: { ids: ["f2"] } });
    await t.c.pendientes();
    expect(t.ultimo().enviados).toHaveLength(antes);
  });

  it("«terminá la sesión»: se despide y recién entonces corta", async () => {
    const alTerminar = vi.fn();
    const t = armar({ alTerminar, resultados: [{ respuestas: [{ id: "f1", nombre: "terminar_sesion", resultado: { ok: true } }], cambios: [], terminar: true }] });
    await t.conectar();
    t.llega(dijiste("Listo, cortemos."), { toolCall: { functionCalls: [{ id: "f1", name: "terminar_sesion", args: {} }] } });
    await t.c.pendientes();
    t.llega(audio, dice("Dale, hablamos el jueves."), finTurno);
    expect(alTerminar).not.toHaveBeenCalled();
    t.parlante.callar();
    expect(alTerminar).toHaveBeenCalledOnce();
  });

  it("el botón «Interrumpir» calla y descarta lo que faltaba de esa respuesta", async () => {
    const t = armar();
    await t.conectar();
    t.llega(audio, dice("Tenés tres cosas vencidas:"));
    t.c.interrumpir();
    expect(t.parlante.cortes).toBe(1);
    expect(t.c.estado.fase).toBe("escuchando");
    // El servicio sigue mandando el turno cortado: no suena ni se muestra.
    t.llega(audio, dice(" la primera es"), finTurno);
    expect(t.parlante.cola).toBe(1);
    expect(t.lineas()).toEqual(["agente: Tenés tres cosas vencidas:"]);
    // La respuesta siguiente sí.
    t.llega(dijiste("¿Cuál es la más urgente?"), audio, dice("La del banco."), finTurno);
    expect(t.parlante.cola).toBe(2);
    expect(t.lineas().at(-1)).toBe("agente: La del banco.");
  });

  it("también se le puede escribir: corta lo que suena y manda el texto", async () => {
    const t = armar();
    await t.conectar();
    t.llega(audio, dice("Mientras tanto"));
    t.c.escribir("  Anotá comprar pintura  ");
    expect(t.parlante.cortes).toBe(1);
    expect(t.textos()).toEqual(["Anotá comprar pintura"]);
    expect(t.c.estado.fase).toBe("pensando");
    t.llega(interrumpido, finTurno);
    expect(t.c.estado.fase).toBe("pensando");
    t.llega(audio, dice("Anotado."), finTurno);
    t.parlante.callar();
    expect(t.lineas()).toEqual(["agente: Mientras tanto", "vos: Anotá comprar pintura", "agente: Anotado."]);
    expect(t.c.estado.fase).toBe("escuchando");
  });

  it("silenciado no manda audio y le avisa al servicio que se cortó", async () => {
    const t = armar();
    await t.conectar();
    t.c.silenciar(true);
    t.c.recibirAudio(new Int16Array(640));
    expect(t.audios()).toBe(0);
    expect(t.ultimo().enviados.at(-1)).toEqual({ realtimeInput: { audioStreamEnd: true } });
    t.c.silenciar(false);
    t.c.recibirAudio(new Int16Array(640));
    expect(t.audios()).toBe(1);
  });

  it("cuando el servicio avisa que corta, renueva la conexión al terminar de hablar, sin volver a saludar", async () => {
    const t = armar();
    await t.conectar(true);
    t.llega(audio, dice("Arranquemos."), { goAway: { timeLeft: "30s" } });
    expect(t.enchufes).toHaveLength(1);
    t.llega(finTurno);
    t.parlante.callar();
    await vi.waitFor(() => expect(t.enchufes).toHaveLength(2));
    expect(t.enchufes[0].cerrado).toBe(true);
    expect(t.sesiones).toEqual([{ inicio: true }, { inicio: false }]);
    await vi.waitFor(() => expect(t.ultimo().enviados[0]?.setup).toBeTruthy());
    t.llega({ setupComplete: {} });
    expect(t.textos()).toEqual([]);
    expect(t.c.estado.fase).toBe("escuchando");
    // Lo que llegue de la conexión vieja ya no cuenta.
    t.enchufes[0].al.eventos(leerMensaje(audio));
    expect(t.parlante.cola).toBe(1);
  });

  it("si se corta la conexión, se reconecta y manda lo que escribí mientras tanto", async () => {
    const t = armar();
    await t.conectar();
    t.ultimo().al.cierre(1006, "");
    expect(t.c.estado.fase).toBe("conectando");
    t.c.escribir("¿Seguís ahí?");
    await vi.waitFor(() => expect(t.enchufes).toHaveLength(2));
    await vi.waitFor(() => expect(t.ultimo().enviados[0]?.setup).toBeTruthy());
    t.llega({ setupComplete: {} });
    expect(t.textos()).toEqual(["¿Seguís ahí?"]);
    expect(t.informes).toEqual(["cierre: 1006"]);
  });

  it("lo que digo mientras se renueva la conexión no se pierde, y la conexión nueva ya tiene guardado lo último", async () => {
    let soltar: (() => void) | null = null;
    const guardados: PedidoTurnoVivo[] = [];
    const t = armar({
      // El guardado tarda: la conexión nueva no se pide hasta que termine.
      guardar: (pedido) =>
        new Promise((listo) => {
          soltar = () => {
            guardados.push(pedido);
            listo({ respuestas: [], cambios: [], terminar: false });
          };
        }),
    });
    await t.conectar();
    t.llega(audio, dice("Quedamos así."), finTurno);
    t.parlante.callar();
    t.ultimo().al.cierre(1006, "");
    const trozo = new Int16Array(640).fill(300);
    t.c.recibirAudio(trozo);
    t.c.recibirAudio(trozo);
    await new Promise((r) => setTimeout(r, 20));
    expect(t.sesiones).toHaveLength(1);
    soltar!();
    await vi.waitFor(() => expect(t.sesiones).toHaveLength(2));
    expect(guardados).toEqual([{ agente: "Quedamos así." }]);
    await vi.waitFor(() => expect(t.ultimo().enviados[0]?.setup).toBeTruthy());
    t.llega({ setupComplete: {} });
    // El audio guardado sale apenas vuelve la conexión, antes que cualquier otra cosa.
    expect(t.audios()).toBe(2);
  });

  it("mientras se aplica una herramienta lenta no se da por colgado al Agente", async () => {
    let soltar: (() => void) | null = null;
    const t = armar({
      guardar: (pedido) =>
        new Promise((listo) => {
          soltar = () => listo({ respuestas: (pedido.llamadas ?? []).map((l) => ({ id: l.id, nombre: l.nombre, resultado: { ok: true } })), cambios: [], terminar: false });
        }),
    });
    await t.conectar();
    t.llega({ toolCall: { functionCalls: [{ id: "f1", name: "armar_informe", args: {} }] } });
    expect(t.c.estado.fase).toBe("pensando");
    // Pasa medio minuto armando el informe: no se reconecta.
    t.c.revisarVolumen(Date.now() + 40_000);
    expect(t.enchufes).toHaveLength(1);
    await vi.waitFor(() => expect(soltar).toBeTruthy());
    soltar!();
    await t.c.pendientes();
    expect(t.ultimo().enviados.at(-1)!.toolResponse).toBeTruthy();
    // Con el resultado entregado sí corre el tope: si no dice nada, se renueva.
    t.c.revisarVolumen(Date.now() + 40_000);
    await vi.waitFor(() => expect(t.enchufes).toHaveLength(2));
  });

  it("si al atender el servicio falla, lo dice sin insistir (la pantalla sigue por turnos)", async () => {
    const alCaer = vi.fn();
    const t = armar({ alCaer, sesiones: [{ vivo: false, motivo: "error" }] });
    expect(await t.c.empezar(false)).toBe("error");
    expect(t.sesiones).toHaveLength(1);
    expect(alCaer).not.toHaveBeenCalled();
    expect(t.informes).toEqual(["sin_sesion: error"]);
  });

  it("una llamada que se cae en medio avisa una sola vez y no insiste sin fin", async () => {
    vi.useFakeTimers();
    const alCaer = vi.fn();
    const sinServicio: RespuestaSesionViva = { vivo: false, motivo: "error" };
    let primera = true;
    const t = armar({
      alCaer,
      pedirSesion: async () => {
        if (!primera) return sinServicio;
        primera = false;
        return { vivo: true, url: "ws://servicio/1", ajustes: {}, modelo: "x", apertura: null };
      },
    });
    const pendiente = t.c.empezar(false);
    await vi.advanceTimersByTimeAsync(0);
    t.llega({ setupComplete: {} });
    expect(await pendiente).toBe("ok");
    t.llega(audio, dice("Como te decía"));
    t.ultimo().al.cierre(1011, "Internal error");
    await vi.advanceTimersByTimeAsync(5000);
    expect(alCaer).toHaveBeenCalledOnce();
    expect(t.informes).toContain("caida: cierre 1011");
    // Lo que se llegó a decir queda guardado.
    expect(t.guardados).toEqual([{ agente: "Como te decía" }]);
  });

  it("si la llamada en vivo no está configurada, lo dice sin intentar conectarse", async () => {
    const t = armar({ sesiones: [{ vivo: false, motivo: "sin_configurar" }] });
    expect(await t.c.empezar(true)).toBe("sin_configurar");
    expect(t.enchufes).toHaveLength(0);
    expect(t.informes).toEqual([]);
  });

  it("si el servicio no acepta los ajustes a tiempo, no queda esperando para siempre", async () => {
    vi.useFakeTimers();
    const t = armar();
    const pendiente = t.c.empezar(true);
    await vi.advanceTimersByTimeAsync(13_000);
    expect(await pendiente).toBe("error");
    expect(t.ultimo().cerrado).toBe(true);
  });

  it("si el Agente no contesta lo que le escribí, renueva la conexión", async () => {
    const t = armar();
    await t.conectar();
    t.c.escribir("¿Hola?");
    const ahora = Date.now();
    t.c.revisarVolumen(ahora + 10_000);
    expect(t.enchufes).toHaveLength(1);
    t.c.revisarVolumen(ahora + 26_000);
    await vi.waitFor(() => expect(t.enchufes).toHaveLength(2));
  });

  it("al cortar guarda lo último y suelta todo", async () => {
    const t = armar();
    await t.conectar();
    t.llega(dijiste("Chau."), audio, dice("Nos vemos"));
    t.c.cerrar();
    expect(t.c.estado.fase).toBe("cerrada");
    expect(t.ultimo().cerrado).toBe(true);
    expect(t.parlante.cortes).toBe(1);
    await t.c.pendientes();
    expect(t.guardados).toEqual([{ usuario: "Chau.", agente: "Nos vemos" }]);
    // Después de cerrar no manda nada más.
    t.c.recibirAudio(new Int16Array(640));
    expect(t.audios()).toBe(0);
  });

  it("muestra el volumen del micrófono y avisa si dejó de llegar audio", async () => {
    let nivel: number | null = 0.2;
    const t = armar({ nivel: () => nivel });
    await t.conectar();
    expect(t.c.revisarVolumen()).toBe(0.2);
    nivel = null;
    for (let i = 0; i < 30; i++) t.c.revisarVolumen();
    expect(t.c.estado.sordo).toBe(true);
    nivel = 0.1;
    t.c.revisarVolumen();
    expect(t.c.estado.sordo).toBe(false);
  });
});
