import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configClaude, MODELOS_POR_DEFECTO, problemaVigente, usoDeSesion } from "@/lib/agente/claude/config";
import { costoUSD } from "@/lib/agente/claude/precios";
import { evaluarPresupuesto, mesDe, registrarUso } from "@/lib/agente/claude/presupuesto";
import { corto, type Sesion } from "@/lib/agente/datos";
import { definiciones } from "@/lib/agente/herramientas";
import { aMensajesClaude, armarPedidoClaude, crearClaude, ttlDe } from "@/lib/agente/proveedores/claude";
import { ordenEfectivo, proveedoresEnOrden } from "@/lib/agente/proveedores/indice";
import { correrTurno, type EventoTurno } from "@/lib/agente/runner";
import { ErrorProveedor, type PedidoLLM, type Trozo, type Uso } from "@/lib/agente/tipos";
import { juntar, levantarModelos, levantarSupabase, proveedorFalso, type ServidorModelos, type ServidorSupabase } from "./apoyo/falsos";

/**
 * Claude con un servidor de mentira que habla el protocolo de Anthropic
 * (streaming, herramientas, errores) y simula el caché de prompts. Comprueba
 * el formato y la lógica; no reemplaza una prueba con la API real.
 */

let modelos: ServidorModelos;
let urlModelos: string;
let supa: ServidorSupabase;
let sb: SupabaseClient;

beforeAll(async () => {
  ({ servidor: modelos, url: urlModelos } = await levantarModelos());
  ({ servidor: supa, sb } = await levantarSupabase());
});
afterAll(() => {
  modelos.close();
  supa.close();
});
beforeEach(() => {
  modelos.reiniciar();
  supa.reiniciar();
});

const USUARIO_ID = "11111111-1111-1111-1111-111111111111";
const cliente = () => new Anthropic({ apiKey: "clave-de-prueba", baseURL: urlModelos, maxRetries: 0 });
type Registro = { modelo: string; uso: Uso; tokens: { entrada: number; salida: number; cache5m: number; cache1h: number; lectura: number } };

function claude(extra: { modelos?: Record<Uso, string> } = {}) {
  const usados: Registro[] = [];
  const problemas: string[] = [];
  const prov = crearClaude({
    cliente: cliente(),
    modelos: extra.modelos ?? MODELOS_POR_DEFECTO,
    alUsar: async (r) => (usados.push(r), null),
    alProblema: async (t) => void problemas.push(t),
  });
  return { prov, usados, problemas };
}
const textoDe = (t: Trozo[]) => t.flatMap((x) => (x.tipo === "texto" ? [x.texto] : [])).join("");
const pedidos = () => modelos.pedidos().filter((p) => p.proveedor === "claude");

// Un sistema realista: lo bastante largo para pasar el mínimo de 512 tokens del caché.
const ESTABLE = "Sos el Agente de MiAgente, un coach directo en español rioplatense. ".repeat(40);
const FOTO = "Lo que sabés de esta persona: rinde mejor a la mañana. Proyectos: reformar el baño. ".repeat(20);
const pedidoBase = (extra: Partial<PedidoLLM> = {}): PedidoLLM => ({
  sistema: `${ESTABLE}\n\n${FOTO}`,
  sistemaPartes: [ESTABLE, FOTO],
  mensajes: [{ rol: "usuario", texto: "Hola" }],
  herramientas: definiciones(),
  uso: "chat",
  ...extra,
});

describe("precios", () => {
  const tokens = (t: Partial<Registro["tokens"]>) => ({ entrada: 0, salida: 0, cache5m: 0, cache1h: 0, lectura: 0, ...t });

  it("entrada, salida, escritura y lectura de caché con los precios de cada modelo", () => {
    // Haiku 5.5: 0,10 entrada · 0,50 salida · 0,125 caché 5 min · 0,20 caché 1 h · 0,01 lectura (por millón).
    expect(costoUSD("claude-haiku-5-5", tokens({ entrada: 100_000 }))).toBeCloseTo(0.01, 10);
    expect(costoUSD("claude-haiku-5-5", tokens({ entrada: 1000, salida: 1_000_000 }))).toBeCloseTo(0.0001 + 0.5, 10);
    expect(costoUSD("claude-haiku-5-5", tokens({ cache5m: 40_000, cache1h: 40_000, lectura: 20_000 }))).toBeCloseTo(
      (40_000 * 0.125 + 40_000 * 0.2 + 20_000 * 0.01) / 1e6,
      10,
    );
    // Sonnet 5.5: 2 · 10 · 2,50 · 4 · 0,10.
    expect(costoUSD("claude-sonnet-5-5", tokens({ entrada: 1000, salida: 500, cache5m: 2000, cache1h: 3000, lectura: 10_000 }))).toBeCloseTo(
      (1000 * 2 + 500 * 10 + 2000 * 2.5 + 3000 * 4 + 10_000 * 0.1) / 1e6,
      10,
    );
    expect(costoUSD("modelo-que-no-existe", tokens({ entrada: 1e6 }))).toBe(0);
  });

  it("Haiku por encima de 100.000 tokens cobra el tramo largo, contando también el caché", () => {
    const justo = tokens({ entrada: 50_000, lectura: 50_000, salida: 1000 });
    expect(costoUSD("claude-haiku-5-5", justo)).toBeCloseTo((50_000 * 0.1 + 50_000 * 0.01 + 1000 * 0.5) / 1e6, 10);
    // Un token más y todo el pedido pasa al tramo largo: 0,50 · 2,50 · 0,625 · 1 · 0,05.
    const largo = tokens({ entrada: 50_001, lectura: 50_000, salida: 1000 });
    expect(costoUSD("claude-haiku-5-5", largo)).toBeCloseTo((50_001 * 0.5 + 50_000 * 0.05 + 1000 * 2.5) / 1e6, 10);
    expect(costoUSD("claude-haiku-5-5", tokens({ cache5m: 60_000, cache1h: 50_000 }))).toBeCloseTo((60_000 * 0.625 + 50_000 * 1) / 1e6, 10);
    // Sonnet no tiene tramos.
    expect(costoUSD("claude-sonnet-5-5", tokens({ entrada: 200_000 }))).toBeCloseTo(0.4, 10);
  });
});

describe("qué modelo responde cada uso", () => {
  it("por defecto: Haiku para chat y fondo; Sonnet para llamadas y entrevista", () => {
    expect(configClaude({}).modelos).toEqual({
      chat: "claude-haiku-5-5", llamada: "claude-sonnet-5-5", entrevista: "claude-sonnet-5-5", fondo: "claude-haiku-5-5",
    });
    expect(configClaude({}).topeUSD).toBe(10);
    // Se elige por el tipo de sesión, no por el canal: una llamada escrita sigue siendo llamada.
    expect([usoDeSesion("chat"), usoDeSesion("llamada_programada"), usoDeSesion("onboarding")]).toEqual(["chat", "llamada", "entrevista"]);
  });

  it("lo que se elige en Configuración manda, solo dentro de la lista cerrada", () => {
    const c = configClaude({ claude_modelos: { chat: "claude-sonnet-5-5", fondo: "gpt-5", llamada: 3 }, claude_tope_usd: 25 }, 50);
    expect(c.modelos).toEqual({ ...MODELOS_POR_DEFECTO, chat: "claude-sonnet-5-5" });
    expect(c.topeUSD).toBe(25);
    // El tope del perfil lo escribe la persona: solo puede bajar el límite, nunca pasar el global.
    expect(configClaude({ claude_tope_usd: 1000 }, 10).topeUSD).toBe(10);
    expect(configClaude({ claude_tope_usd: "1e9" }, 10).topeUSD).toBe(10);
    expect(configClaude({ claude_tope_usd: -5 }, 10).topeUSD).toBe(10);
    expect(configClaude({ claude_tope_usd: 3 }, 10)).toMatchObject({ topeUSD: 3, topePropio: true });
  });

  it("cada pedido sale con el modelo de su uso, también después de cambiarlo", async () => {
    const { prov } = claude();
    for (const uso of ["chat", "llamada", "entrevista", "fondo"] as Uso[]) await juntar(prov.generar(pedidoBase({ uso })));
    expect(pedidos().map((p) => p.cuerpo.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    // `liviano` sin uso explícito es fondo.
    await juntar(prov.generar(pedidoBase({ uso: undefined, liviano: true })));
    expect(pedidos().at(-1)?.cuerpo.model).toBe("claude-haiku-5-5");

    const cambiado = claude({ modelos: configClaude({ claude_modelos: { chat: "claude-opus-5-5", llamada: "claude-haiku-5-5" } }).modelos });
    await juntar(cambiado.prov.generar(pedidoBase({ uso: "chat" })));
    await juntar(cambiado.prov.generar(pedidoBase({ uso: "llamada" })));
    expect(pedidos().slice(-2).map((p) => p.cuerpo.model)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
    expect(cambiado.prov.modelo("chat")).toBe("claude-opus-5-5");
  });

  it("Haiku sin razonamiento extendido y esfuerzo bajo; Sonnet razona con esfuerzo medio", () => {
    const haiku = armarPedidoClaude("claude-haiku-5-5", pedidoBase());
    expect(haiku).toMatchObject({ thinking: { type: "disabled" }, output_config: { effort: "low" }, stream: true });
    const sonnet = armarPedidoClaude("claude-sonnet-5-5", pedidoBase({ uso: "llamada" }));
    expect(sonnet).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
    expect(sonnet).not.toHaveProperty("temperature");
  });
});

describe("contexto y caché de prompts", () => {
  it("orden: herramientas, instrucciones, memorias y estado, conversación; un punto de caché en cada parte", () => {
    const p = armarPedidoClaude("claude-haiku-5-5", pedidoBase({
      mensajes: [
        { rol: "usuario", texto: "Terminé los azulejos" },
        { rol: "agente", texto: "", llamadas: [{ id: "toolu_1", nombre: "actualizar_tarea", argumentos: { tarea_id: "ab12cd34", estado: "hecha" } }] },
        { rol: "herramienta", id: "toolu_1", nombre: "actualizar_tarea", resultado: { ok: true } },
      ],
    }));
    expect(p.tools?.map((t) => (t as Anthropic.Tool).name)).toEqual(definiciones().map((d) => d.nombre));
    // Las herramientas no llevan marca propia: el primer punto (en las instrucciones) las incluye.
    expect(p.tools?.some((t) => "cache_control" in t)).toBe(false);
    const system = p.system as Anthropic.TextBlockParam[];
    expect(system.map((b) => b.text)).toEqual([ESTABLE, FOTO]);
    expect(system.map((b) => b.cache_control)).toEqual([{ type: "ephemeral", ttl: "1h" }, { type: "ephemeral", ttl: "1h" }]);
    // El último bloque de la conversación lleva el tercer punto; nada más lo lleva.
    const ultimo = p.messages.at(-1)!.content as Anthropic.ContentBlockParam[];
    expect(ultimo.at(-1)).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1", cache_control: { type: "ephemeral", ttl: "1h" } });
    const marcas = JSON.stringify(p).match(/cache_control/g) ?? [];
    expect(marcas).toHaveLength(3); // de un máximo de 4
  });

  it("la duración del caché depende del canal: 5 minutos en voz, 1 hora por escrito, nada en tareas de fondo", () => {
    expect(ttlDe({ uso: "llamada", voz: true })).toBe("5m");
    expect(ttlDe({ uso: "llamada", voz: false })).toBe("1h");
    expect(ttlDe({ uso: "chat" })).toBe("1h");
    expect(ttlDe({ liviano: true })).toBeNull();
    const fondo = armarPedidoClaude("claude-haiku-5-5", pedidoBase({ uso: "fondo", herramientas: undefined }));
    expect(JSON.stringify(fondo)).not.toContain("cache_control");
  });

  it("traduce bien la conversación: resultados agrupados, ids saneados, sin bloques vacíos", () => {
    const m = aMensajesClaude(
      [
        { rol: "usuario", texto: "Hola" },
        { rol: "agente", texto: "Dale.", llamadas: [
          { id: "fc/1:a", nombre: "ver_tarea", argumentos: { tarea_id: "ab12cd34" } },
          { id: "fc/2:b", nombre: "ver_tarea", argumentos: { tarea_id: "ef56ab78" } },
        ] },
        { rol: "herramienta", id: "fc/1:a", nombre: "ver_tarea", resultado: { a: 1 } },
        { rol: "herramienta", id: "fc/2:b", nombre: "ver_tarea", resultado: { b: 2 } },
        { rol: "agente", texto: "" },
        { rol: "usuario", texto: "Gracias" },
      ],
      null,
    );
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "user", "user"]);
    const resultados = m[2].content as Anthropic.ToolResultBlockParam[];
    expect(resultados.map((r) => r.tool_use_id)).toEqual(["fc_1_a", "fc_2_b"]);
    expect((m[1].content as Anthropic.ToolUseBlockParam[]).filter((b) => b.type === "tool_use").map((b) => b.id)).toEqual(["fc_1_a", "fc_2_b"]);
    expect(JSON.stringify(m)).not.toContain("cache_control");
  });

  it("el caché se usa de verdad: el segundo turno lee lo que escribió el primero", async () => {
    const { prov, usados } = claude();
    await juntar(prov.generar(pedidoBase({ voz: true, uso: "llamada" })));
    const primero = usados[0].tokens;
    expect(primero.lectura).toBe(0);
    expect(primero.cache5m).toBeGreaterThan(512);
    expect(primero.cache1h).toBe(0);

    await juntar(prov.generar(pedidoBase({
      voz: true,
      uso: "llamada",
      mensajes: [{ rol: "usuario", texto: "Hola" }, { rol: "agente", texto: "Hola, ¿cómo venís?" }, { rol: "usuario", texto: "Bien" }],
    })));
    const segundo = usados[1].tokens;
    // Lee todo lo del primer turno (herramientas, instrucciones, foto y el primer mensaje)
    // y solo escribe lo nuevo de la conversación.
    expect(segundo.lectura).toBe(primero.cache5m);
    expect(segundo.cache5m).toBeGreaterThan(0);
    expect(segundo.cache5m).toBeLessThan(primero.cache5m / 10);
    // El costo registrado baja: casi todo el pedido es lectura.
    expect(costoUSD(usados[1].modelo, segundo)).toBeLessThan(costoUSD(usados[0].modelo, primero) / 2);
  });

  it("si cambia lo estable, el caché no se lee (por eso la foto se congela por sesión)", async () => {
    const { prov, usados } = claude();
    await juntar(prov.generar(pedidoBase()));
    await juntar(prov.generar(pedidoBase({ sistemaPartes: [ESTABLE, FOTO + " Hora: 12:05."] })));
    // Lee hasta las instrucciones (que no cambiaron), no la foto.
    expect(usados[1].tokens.lectura).toBeGreaterThan(0);
    expect(usados[1].tokens.lectura).toBeLessThan(usados[0].tokens.cache1h);
  });
});

describe("streaming, herramientas y errores", () => {
  it("lee el texto en pedazos y las llamadas a herramientas con sus argumentos", async () => {
    modelos.guion([{ proveedor: "claude", texto: "Dale, lo anoto.", llamadas: [{ nombre: "actualizar_tarea", argumentos: { tarea_id: "ab12cd34", estado: "hecha" } }] }]);
    const { prov } = claude();
    const trozos = await juntar(prov.generar(pedidoBase()));
    expect(textoDe(trozos)).toBe("Dale, lo anoto.");
    expect(trozos.filter((t) => t.tipo === "texto").length).toBeGreaterThan(1);
    const llamada = trozos.find((t) => t.tipo === "llamada");
    expect(llamada).toMatchObject({ llamada: { nombre: "actualizar_tarea", argumentos: { tarea_id: "ab12cd34", estado: "hecha" } } });
    expect(pedidos()[0].cabeceras.authorization).toBe("Bearer clave-de-prueba");
  });

  it.each([
    [401, undefined, "clave", "clave"],
    [403, undefined, "clave", "clave"],
    [402, undefined, "credito", "credito"],
    [400, "Your credit balance is too low to access the Anthropic API.", "credito", "credito"],
    [400, "You have reached your specified API usage limits.", "credito", "credito"],
    [429, undefined, "limite", null],
    [529, undefined, "sin_respuesta", null],
    [500, undefined, "sin_respuesta", null],
  ])("un %i (%s) se clasifica como «%s»", async (estado, mensaje, clase, problema) => {
    modelos.guion([{ proveedor: "claude", estado, ...(mensaje ? { mensaje } : {}) } as never]);
    const { prov, problemas } = claude();
    const error = await juntar(prov.generar(pedidoBase())).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorProveedor);
    expect(error.clase).toBe(clase);
    expect(problemas).toEqual(problema ? [problema] : []);
  });

  it("una negativa por seguridad pasa al siguiente proveedor; un corte a mitad, también", async () => {
    modelos.guion([{ proveedor: "claude", refusal: true, texto: "No." } as never, { proveedor: "claude", texto: "Empiezo y", cortar: true }]);
    const { prov } = claude();
    expect((await juntar(prov.generar(pedidoBase())).catch((e) => e)).clase).toBe("invalido");
    expect((await juntar(prov.generar(pedidoBase())).catch((e) => e)).clase).toBe("sin_respuesta");
  });
});

describe("Claude dentro del Agente", () => {
  const sembrar = (sesion: Partial<Sesion>) => {
    const proyecto = supa.sembrar("projects", { name: "Reformar el baño" });
    const tarea = supa.sembrar("tasks", { project_id: proyecto.id, title: "Elegir azulejos" });
    const otra = supa.sembrar("tasks", { project_id: proyecto.id, title: "Comprar grifería" });
    const s = supa.sembrar("sessions", { kind: "chat", channel: "texto", ...sesion }) as unknown as Sesion;
    return { tarea, otra, sesion: s };
  };
  const de = <T extends EventoTurno["tipo"]>(e: EventoTurno[], tipo: T) => e.filter((x): x is Extract<EventoTurno, { tipo: T }> => x.tipo === tipo);

  it("en medio de una llamada, si Claude se cae sigue Gemini sin cortar y sin duplicar cambios", async () => {
    const { tarea, otra, sesion } = sembrar({ kind: "llamada_programada", channel: "voz", status: "notificada" });
    modelos.guion([
      { proveedor: "claude", texto: "Te lo marco.", llamadas: [{ nombre: "actualizar_tarea", argumentos: { tarea_id: corto(tarea.id), estado: "hecha" } }] },
      { proveedor: "claude", estado: 529 },
    ]);
    const { prov } = claude();
    const gemini = proveedorFalso("gemini", [
      { llamadas: [{ nombre: "actualizar_tarea", argumentos: { tarea_id: corto(otra.id), estado: "bloqueada", motivo_bloqueo: "Espera al plomero" } }] },
      { texto: "Listo, las dos quedaron." },
    ]);
    const eventos = await juntar(correrTurno({ sb, sesion, proveedores: [prov, gemini], voz: true, entrada: { texto: "Terminé los azulejos y lo otro está trabado" } }));
    expect(de(eventos, "proveedor").map((e) => e.modelo)).toEqual(["claude-sonnet-5-5", "gemini-prueba"]);
    expect(de(eventos, "cambio_proveedor")).toEqual([{ tipo: "cambio_proveedor", de: "claude", motivo: "sin_respuesta" }]);
    expect(de(eventos, "error")).toEqual([]);
    expect(de(eventos, "fin")[0]).toMatchObject({ proveedor: "gemini" });
    const tareas = supa.estado().tasks;
    expect(tareas.find((t) => t.id === tarea.id)?.status).toBe("hecha");
    expect(tareas.find((t) => t.id === otra.id)?.status).toBe("bloqueada");
    expect(supa.estado().change_log).toHaveLength(2);
    // Gemini recibió lo que ya había hecho Claude, con el resultado de la herramienta.
    expect(gemini.pedidos[0].mensajes.map((m) => m.rol)).toEqual(["usuario", "agente", "herramienta"]);
    expect(supa.estado().sessions.find((s) => s.id === sesion.id)?.providers_used).toEqual(["claude", "gemini"]);
    // Cada mensaje guarda quién respondió.
    expect(supa.estado().messages.filter((m) => m.role === "agente").map((m) => [m.provider, m.model])).toEqual([
      ["claude", "claude-sonnet-5-5"],
      ["gemini", "gemini-prueba"],
      ["gemini", "gemini-prueba"],
    ]);
  });

  it.each([401, 402, 429, 529])("con un %i en el primer pedido responde el siguiente proveedor", async (estado) => {
    const { sesion } = sembrar({});
    modelos.guion([{ proveedor: "claude", estado }]);
    const groq = proveedorFalso("groq", [{ texto: "Sigo yo." }]);
    const eventos = await juntar(correrTurno({ sb, sesion, proveedores: [claude().prov, groq], entrada: { texto: "Hola" } }));
    expect(de(eventos, "fin")[0]).toMatchObject({ proveedor: "groq", texto: "Sigo yo." });
  });

  it("la foto del contexto se congela: dos turnos de la misma sesión mandan el mismo principio", async () => {
    const { sesion } = sembrar({ kind: "llamada_programada", channel: "voz", status: "notificada" });
    supa.sembrar("memories", { category: "rutina", content: "Rinde mejor a la mañana." });
    const p = proveedorFalso("claude", [{ texto: "Uno." }, { texto: "Dos." }]);
    const t0 = new Date("2026-11-10T15:00:00Z");
    await juntar(correrTurno({ sb, sesion, proveedores: [p], voz: true, ahora: t0, entrada: { texto: "Hola" } }));
    // Entre turnos cambia el panel y pasan unos minutos.
    supa.sembrar("tasks", { project_id: supa.estado().projects[0].id, title: "Tarea nueva del panel" });
    const guardada = supa.estado().sessions.find((s) => s.id === sesion.id) as unknown as Sesion;
    await juntar(correrTurno({ sb, sesion: guardada, proveedores: [p], voz: true, ahora: new Date(t0.getTime() + 4 * 60_000), entrada: { texto: "Sigo" } }));
    const [a, b] = p.pedidos;
    expect(b.sistemaPartes).toEqual(a.sistemaPartes);
    expect(a.sistemaPartes).toHaveLength(2);
    // Primero lo estable (instrucciones); después memorias y estado, en ese orden.
    expect(a.sistemaPartes![0]).toContain("LLAMADA PROGRAMADA");
    expect(a.sistemaPartes![0]).not.toContain("Rinde mejor");
    const foto = a.sistemaPartes![1];
    expect(foto.indexOf("Rinde mejor a la mañana.")).toBeLessThan(foto.indexOf("Estado al empezar esta sesión"));
    expect(foto.indexOf("Estado al empezar")).toBeLessThan(foto.indexOf("Elegir azulejos"));
    expect(b.sistemaPartes!.join()).not.toContain("Tarea nueva del panel");
    expect(a).toMatchObject({ uso: "llamada", voz: true });

    // Pasada una hora se rehace (un chat retomado más tarde ve el panel actual).
    const despues = supa.estado().sessions.find((s) => s.id === sesion.id) as unknown as Sesion;
    const p2 = proveedorFalso("claude", [{ texto: "Tres." }]);
    await juntar(correrTurno({ sb, sesion: despues, proveedores: [p2], voz: true, ahora: new Date(t0.getTime() + 61 * 60_000), entrada: { texto: "Volví" } }));
    expect(p2.pedidos[0].sistemaPartes!.join()).toContain("Tarea nueva del panel");
  });

  it("al llegar al tope lo dice una vez, como parte de la respuesta, y queda en la transcripción", async () => {
    const { sesion } = sembrar({});
    const gemini = proveedorFalso("gemini", [{ texto: "¿En qué te ayudo?" }]);
    const eventos = await juntar(correrTurno({ sb, sesion, proveedores: [gemini], entrada: { texto: "Hola" }, avisoTope: "Este mes ya usé todo el presupuesto de Claude; sigo con el modelo gratuito." }));
    expect(de(eventos, "texto")[0].texto).toContain("ya usé todo el presupuesto de Claude");
    expect(de(eventos, "fin")[0].texto).toBe("Este mes ya usé todo el presupuesto de Claude; sigo con el modelo gratuito.\n\n¿En qué te ayudo?");
    // El modelo no recibió el aviso como último mensaje (sería un «prefill»).
    expect(gemini.pedidos[0].mensajes.at(-1)).toEqual({ rol: "usuario", texto: "Hola" });
    expect(supa.estado().messages.map((m) => m.role)).toEqual(["usuario", "agente", "agente"]);
  });
});

describe("presupuesto mensual", () => {
  const MVD = "America/Montevideo";

  it("el mes se cuenta en la zona horaria de la persona", () => {
    // 1.º de diciembre 02:30 UTC todavía es 30 de noviembre en Montevideo.
    expect(mesDe(new Date("2026-12-01T02:30:00Z"), MVD)).toBe("2026-11");
    expect(mesDe(new Date("2026-12-01T03:00:00Z"), MVD)).toBe("2026-12");
    expect(mesDe(new Date("2026-11-30T23:30:00Z"), "Asia/Tokyo")).toBe("2026-12");
  });

  const evaluar = (extra: Partial<Parameters<typeof evaluarPresupuesto>[0]>) =>
    evaluarPresupuesto({ hayClave: true, agentConfig: {}, gastoMes: 0, mes: "2026-11", ahora: new Date("2026-11-10T15:00:00Z"), sesionYaUsoClaude: false, ...extra });

  it("dentro del tope se usa; al llegar, no; una sesión que ya empezó con Claude sigue, como mucho un 20 % más", () => {
    expect(evaluar({ gastoMes: 9.99 })).toMatchObject({ disponible: true, motivo: null });
    expect(evaluar({ gastoMes: 10 })).toMatchObject({ disponible: false, motivo: "tope", avisarTope: true });
    expect(evaluar({ gastoMes: 10.02, sesionYaUsoClaude: true })).toMatchObject({ disponible: true });
    expect(evaluar({ gastoMes: 11.99, sesionYaUsoClaude: true })).toMatchObject({ disponible: true });
    expect(evaluar({ gastoMes: 12, sesionYaUsoClaude: true })).toMatchObject({ disponible: false, motivo: "tope" });
    // El aviso de «sigo con el gratuito» sale una sola vez por mes.
    expect(evaluar({ gastoMes: 12, agentConfig: { claude_tope_avisado: "2026-11" } })).toMatchObject({ disponible: false, avisarTope: false });
    expect(evaluar({ gastoMes: 12, agentConfig: { claude_tope_avisado: "2026-10" } })).toMatchObject({ avisarTope: true });
    // Subirse el tope en el perfil no cambia el tope efectivo.
    expect(evaluar({ gastoMes: 30, agentConfig: { claude_tope_usd: 50 } })).toMatchObject({ disponible: false, topeUSD: 10 });
    expect(evaluar({ gastoMes: 30, topeGlobal: 50, gastoGlobal: 30, agentConfig: { claude_tope_usd: 50 } })).toMatchObject({ disponible: true, topeUSD: 50 });
    // El global corta aunque la persona esté lejos de su tope.
    expect(evaluar({ gastoMes: 1, gastoGlobal: 10, topeGlobal: 10 })).toMatchObject({ disponible: false, motivo: "tope" });
    expect(evaluar({ gastoMes: 1, gastoGlobal: 11.9, topeGlobal: 10, sesionYaUsoClaude: true })).toMatchObject({ disponible: true });
    expect(evaluar({ gastoMes: 1, gastoGlobal: 12, topeGlobal: 10, sesionYaUsoClaude: true })).toMatchObject({ disponible: false });
    expect(evaluar({ agentConfig: { claude_tope_usd: 0 } })).toMatchObject({ disponible: false, motivo: "tope" });
    expect(evaluar({ hayClave: false })).toMatchObject({ disponible: false, motivo: "sin_clave" });
  });

  it("después de una clave inválida o sin crédito no se reintenta por una hora", () => {
    const ahora = new Date("2026-11-10T15:00:00Z");
    const problema = { claude_problema: { tipo: "credito", desde: "2026-11-10T14:30:00Z" } };
    expect(evaluar({ agentConfig: problema, ahora })).toMatchObject({ disponible: false, motivo: "problema" });
    expect(evaluar({ agentConfig: problema, ahora: new Date("2026-11-10T15:31:00Z") })).toMatchObject({ disponible: true });
    expect(problemaVigente({ claude_problema: { tipo: "otro", desde: ahora.toISOString() } }, ahora)).toBeNull();
  });

  it("registra cada pedido con su costo; el aviso del 80 % sale una sola vez y el contador vuelve a cero al cambiar de mes", async () => {
    supa.estado().profiles[0].agent_config = { claude_tope_usd: 1 };
    const tokens = { entrada: 0, salida: 400_000, cache5m: 0, cache1h: 0, lectura: 0 }; // 0,20 US$ en Haiku
    const reg = (ahora: string) =>
      registrarUso(sb, { userId: USUARIO_ID, sesionId: null, modelo: "claude-haiku-5-5", uso: "chat", tokens, zona: MVD, ahora: new Date(ahora) });

    const avisos = [];
    for (let i = 0; i < 6; i++) avisos.push((await reg("2026-11-20T15:00:00Z")).aviso80);
    // 0,20 · 0,40 · 0,60 · 0,80 ← acá avisa · 1,00 · 1,20
    expect(avisos.map((a) => (a ? Number(a.gasto.toFixed(2)) : null))).toEqual([null, null, null, 0.8, null, null]);
    expect(supa.estado().profiles[0].agent_config.claude_aviso_80).toBe("2026-11");
    const filas = supa.estado().llm_usage;
    expect(filas[0]).toMatchObject({ user_id: USUARIO_ID, provider: "claude", model: "claude-haiku-5-5", uso: "chat", mes: "2026-11", output_tokens: 400_000, cost_usd: 0.2 });

    // 30 de noviembre a las 23:30 en Montevideo sigue siendo noviembre…
    expect((await reg("2026-12-01T02:30:00Z")).aviso80).toBeNull();
    expect(supa.estado().llm_usage.at(-1)?.mes).toBe("2026-11");
    // …y el 1.º de diciembre el contador arranca de cero.
    const diciembre = [];
    for (let i = 0; i < 4; i++) diciembre.push((await reg("2026-12-01T12:00:00Z")).aviso80);
    expect(diciembre.map((a) => Boolean(a))).toEqual([false, false, false, true]);
    expect(evaluarPresupuesto({ hayClave: true, agentConfig: { claude_tope_usd: 1 }, gastoMes: 0.8, mes: "2026-12", ahora: new Date(), sesionYaUsoClaude: false }).disponible).toBe(true);
  });
});

describe("orden de proveedores", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });
  const opciones = { modelos: MODELOS_POR_DEFECTO };

  it("sin clave, Claude no está y todo sigue como antes", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(proveedoresEnOrden(undefined, opciones).map((p) => p.id)).not.toContain("claude");
  });

  it("con clave, Claude va primero; sin presupuesto (opciones nulas), no entra", () => {
    process.env.ANTHROPIC_API_KEY = "clave-de-prueba";
    expect(proveedoresEnOrden(undefined, opciones)[0]?.id).toBe("claude");
    expect(proveedoresEnOrden(undefined, null).map((p) => p.id)).not.toContain("claude");
  });

  it("un orden guardado antes de existir Claude lo pone primero; uno que ya lo trae se respeta", () => {
    expect(ordenEfectivo(["groq", "gemini"])).toEqual(["claude", "groq", "gemini", "ollama"]);
    expect(ordenEfectivo(["gemini", "claude"])).toEqual(["gemini", "claude", "groq", "ollama"]);
    expect(ordenEfectivo(undefined)).toEqual(["claude", "gemini", "groq", "ollama"]);
  });
});
