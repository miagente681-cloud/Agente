import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prepararProveedores } from "@/lib/agente/claude/servidor";
import { topeGlobalDe } from "@/lib/agente/claude/config";
import { aMensajes, correrTurno, MAX_CARACTERES_MENSAJE } from "@/lib/agente/runner";
import type { Sesion } from "@/lib/agente/datos";
import { destinoPushValido } from "@/lib/push/destinos";
import { origenValido, politicaDeContenido, POLITICA_DE_PERMISOS } from "@/lib/seguridad/cabeceras";
import { consumirLimite, frenarSiHaceFalta, limiteDe } from "@/lib/seguridad/frecuencia";
import { puedeUsarClaude } from "@/lib/seguridad/permitidos";
import { juntar, levantarSupabase, proveedorFalso, type ServidorSupabase } from "./apoyo/falsos";

/**
 * Lo que encontró la auditoría, del lado del servidor: cada caso es un ataque
 * que antes pasaba y ahora tiene que quedar rechazado. Lo de la base (RLS,
 * disparadores, claves foráneas) está en esquema.test.ts contra un Postgres real.
 */

const YO = "11111111-1111-1111-1111-111111111111"; // el usuario del Supabase de mentira
const OTRO = "33333333-3333-3333-3333-333333333333";
const MI_CORREO = "prueba@ejemplo.com";

let supa: ServidorSupabase;
let sb: SupabaseClient;
const entorno = { ...process.env };

beforeAll(async () => {
  ({ servidor: supa, sb } = await levantarSupabase());
});
afterAll(() => supa.close());
beforeEach(() => {
  supa.reiniciar();
  process.env.ANTHROPIC_API_KEY = "clave-de-prueba";
  process.env.CLAUDE_USUARIOS_PERMITIDOS = ` Otra@Ejemplo.com, ${MI_CORREO.toUpperCase()} `;
  delete process.env.CLAUDE_TOPE_USD_GLOBAL;
});
afterEach(() => {
  for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_USUARIOS_PERMITIDOS", "CLAUDE_TOPE_USD_GLOBAL", "LIMITE_TURNO"]) {
    if (entorno[k] === undefined) delete process.env[k];
    else process.env[k] = entorno[k];
  }
});

const MES = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(new Date()).slice(0, 7);
const gasto = (userId: string, costo: number, extra: Record<string, unknown> = {}) =>
  supa.sembrar("llm_usage", { user_id: userId, model: "claude-haiku-5-5", uso: "chat", mes: MES, cost_usd: costo, ...extra });
const preparar = (extra: { correo?: string | null; sesionId?: string | null; admin?: SupabaseClient | null } = {}) =>
  prepararProveedores(sb, {
    usuario: { id: YO, email: extra.correo === undefined ? MI_CORREO : extra.correo },
    sesionId: extra.sesionId ?? null,
    admin: extra.admin === undefined ? sb : extra.admin,
  });
const usaClaude = async (extra: Parameters<typeof preparar>[0] = {}) =>
  (await preparar(extra)).proveedores.some((p) => p.id === "claude");

describe("quién puede usar Claude", () => {
  it("compara en minúsculas contra la lista; vacía, nadie", () => {
    expect(puedeUsarClaude("prueba@EJEMPLO.com")).toBe(true);
    expect(puedeUsarClaude("intruso@ejemplo.com")).toBe(false);
    expect(puedeUsarClaude(null)).toBe(false);
    expect(puedeUsarClaude("prueba@ejemplo.com", { CLAUDE_USUARIOS_PERMITIDOS: "" })).toBe(false);
    expect(puedeUsarClaude("prueba@ejemplo.com", {})).toBe(false);
  });

  it("un correo que no está en la lista nunca llega a Claude, aunque haya clave y presupuesto", async () => {
    expect(await usaClaude()).toBe(true);
    expect(await usaClaude({ correo: "intruso@ejemplo.com" })).toBe(false);
    expect(await usaClaude({ correo: null })).toBe(false);
    process.env.CLAUDE_USUARIOS_PERMITIDOS = "";
    const r = await preparar();
    expect(r.proveedores.map((p) => p.id)).not.toContain("claude");
  });

  it("sin la clave de servicio, Claude no se usa (el gasto lo escribe solo el servidor)", async () => {
    expect(await usaClaude({ admin: null })).toBe(false);
  });
});

describe("tope de gasto", () => {
  it("subirse el tope en el perfil no cambia el tope efectivo", async () => {
    supa.estado().profiles[0].agent_config = { claude_tope_usd: 1_000_000 };
    gasto(YO, 10);
    const r = await preparar();
    expect(r.presupuesto).toMatchObject({ topeUSD: 10, disponible: false, motivo: "tope" });
    expect(r.proveedores.map((p) => p.id)).not.toContain("claude");
  });

  it("el tope del perfil sí puede bajar el límite propio", async () => {
    supa.estado().profiles[0].agent_config = { claude_tope_usd: 2 };
    gasto(YO, 2);
    expect(await usaClaude()).toBe(false);
  });

  it("el tope global corta sumando el gasto de dos usuarios", async () => {
    process.env.CLAUDE_TOPE_USD_GLOBAL = "10";
    gasto(YO, 4);
    expect(await usaClaude()).toBe(true);
    gasto(OTRO, 6);
    const r = await preparar();
    expect(r.presupuesto).toMatchObject({ gastoMes: 4, gastoGlobal: 10, topeGlobal: 10, disponible: false });
    expect(r.proveedores.map((p) => p.id)).not.toContain("claude");
  });

  it("el tope global corta también con más de 1.000 filas de gasto en el mes", async () => {
    // 1.500 pedidos de un centavo: leyendo filas (1.000 por defecto) se contaban 10 US$ y no cortaba.
    for (let i = 0; i < 1500; i++) gasto(i % 2 ? YO : OTRO, 0.01);
    process.env.CLAUDE_TOPE_USD_GLOBAL = "12";
    const r = await preparar();
    expect(r.presupuesto?.gastoGlobal).toBeCloseTo(15, 6);
    expect(r.presupuesto?.disponible).toBe(false);
  });

  it("marcar providers_used = {claude} en la sesión no saltea el tope", async () => {
    gasto(YO, 10);
    const sesion = supa.sembrar("sessions", { kind: "chat", channel: "texto", providers_used: ["claude"] });
    expect(await usaClaude({ sesionId: sesion.id })).toBe(false);
  });

  it("una sesión que de verdad usó Claude (según el registro) sigue, pero como mucho un 20 % por encima", async () => {
    const sesion = supa.sembrar("sessions", { kind: "llamada_programada", channel: "voz" });
    gasto(YO, 10.5, { session_id: sesion.id });
    expect(await usaClaude({ sesionId: sesion.id })).toBe(true);
    expect(await usaClaude()).toBe(false); // otra sesión, no
    gasto(YO, 1.5, { session_id: sesion.id });
    expect(await usaClaude({ sesionId: sesion.id })).toBe(false); // 12 = 120 %: se corta igual
  });

  it("CLAUDE_TOPE_USD_GLOBAL vale 10 por defecto y acepta 0", () => {
    expect(topeGlobalDe({})).toBe(10);
    expect(topeGlobalDe({ CLAUDE_TOPE_USD_GLOBAL: "25" })).toBe(25);
    expect(topeGlobalDe({ CLAUDE_TOPE_USD_GLOBAL: "0" })).toBe(0);
    expect(topeGlobalDe({ CLAUDE_TOPE_USD_GLOBAL: "mucho" })).toBe(10);
  });
});

describe("columnas que maneja el servidor", () => {
  it("la foto del contexto y los proveedores usados se escriben con la clave de servicio; sin ella, no se guardan", async () => {
    const sesion = supa.sembrar("sessions", { kind: "chat", channel: "texto" }) as unknown as Sesion;
    const conAdmin = proveedorFalso("gemini", [{ texto: "Hola" }]);
    await juntar(correrTurno({ sb, admin: sb, sesion: { ...sesion }, proveedores: [conAdmin], entrada: { texto: "Hola" } }));
    expect(supa.estado().sessions[0]).toMatchObject({ providers_used: ["gemini"] });
    expect(supa.estado().sessions[0].context_snapshot).toBeTruthy();

    const otra = supa.sembrar("sessions", { kind: "chat", channel: "texto" }) as unknown as Sesion;
    const sinAdmin = proveedorFalso("gemini", [{ texto: "Hola" }]);
    await juntar(correrTurno({ sb, admin: null, sesion: { ...otra }, proveedores: [sinAdmin], entrada: { texto: "Hola" } }));
    const guardada = supa.estado().sessions.find((s) => s.id === otra.id);
    expect(guardada?.providers_used).toEqual([]);
    expect(guardada?.context_snapshot ?? null).toBeNull();
    // El modelo recibió la foto igual.
    expect(sinAdmin.pedidos[0].sistema).toContain("Estado al empezar esta sesión");
  });

  it("cada mensaje del historial se recorta al armar el pedido", () => {
    const enorme = "x".repeat(200_000);
    const mensajes = aMensajes([
      { role: "usuario", content: enorme, tool_calls: null, tool_result: null, created_at: "" },
      { role: "agente", content: enorme, tool_calls: [{ id: "1", nombre: "a", argumentos: { x: enorme } }], tool_result: null, created_at: "" },
      { role: "herramienta", content: null, tool_calls: null, tool_result: { id: "1", nombre: "a", resultado: { x: enorme } }, created_at: "" },
    ]);
    const largo = JSON.stringify(mensajes).length;
    expect(largo).toBeLessThan(3 * MAX_CARACTERES_MENSAJE + 20_000);
    expect(mensajes[0]).toMatchObject({ rol: "usuario" });
    expect((mensajes[0] as { texto: string }).texto.length).toBeLessThanOrEqual(MAX_CARACTERES_MENSAJE + 20);
  });
});

describe("límite de frecuencia", () => {
  it("devuelve 429 al pasarse, con un mensaje claro", async () => {
    process.env.LIMITE_TURNO = "2/100";
    expect(limiteDe("turno")).toEqual({ porMinuto: 2, porDia: 100 });
    expect(await frenarSiHaceFalta(YO, "turno", sb)).toBeNull();
    expect(await frenarSiHaceFalta(YO, "turno", sb)).toBeNull();
    const r = await frenarSiHaceFalta(YO, "turno", sb);
    expect(r?.status).toBe(429);
    expect(r?.headers.get("Retry-After")).toBeTruthy();
    expect(await r?.json()).toMatchObject({ motivo: "limite", error: expect.stringMatching(/esperá un minuto/) });
    // Otro endpoint cuenta aparte.
    expect(await frenarSiHaceFalta(YO, "push_probar", sb)).toBeNull();
  });

  it("sin la clave de servicio no se puede contar: responde 503", async () => {
    expect(await consumirLimite(null, YO, "turno")).toEqual({ permitido: false, motivo: "sin_servicio" });
    expect((await frenarSiHaceFalta(YO, "turno", null))?.status).toBe(503);
  });

  it("valores por defecto razonables y configurables", () => {
    expect(limiteDe("turno", {})).toEqual({ porMinuto: 20, porDia: 600 });
    expect(limiteDe("voz_token", { LIMITE_VOZ_TOKEN: "1/5" })).toEqual({ porMinuto: 1, porDia: 5 });
    expect(limiteDe("voz_token", { LIMITE_VOZ_TOKEN: "basura" })).toEqual({ porMinuto: 6, porDia: 60 });
  });
});

describe("destinos de push", () => {
  it("acepta solo https y los servicios de push de los navegadores", () => {
    for (const bueno of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com/wp/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGx",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect(destinoPushValido(bueno), bueno).toBe(true);
    }
    for (const malo of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.com/x",
      "https://evil.com/fcm.googleapis.com",
      "https://usuario:clave@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://a.b.notify.windows.com/x",
      "https://169.254.169.254/latest",
      "https://localhost/x",
      "javascript:alert(1)",
      "",
      null,
    ]) {
      expect(destinoPushValido(malo), String(malo)).toBe(false);
    }
  });
});

describe("cabeceras y origen", () => {
  it("los pedidos que modifican algo tienen que venir de la propia app", () => {
    const host = "miagente.vercel.app";
    expect(origenValido({ metodo: "POST", origen: "https://miagente.vercel.app", host })).toBe(true);
    expect(origenValido({ metodo: "POST", origen: "https://evil.com", host })).toBe(false);
    expect(origenValido({ metodo: "POST", origen: null, host })).toBe(false);
    expect(origenValido({ metodo: "DELETE", origen: "null", host })).toBe(false);
    expect(origenValido({ metodo: "GET", origen: null, host })).toBe(true);
  });

  it("la política de contenido es estricta y permite solo lo que la app usa", () => {
    const csp = politicaDeContenido({ nonce: "abc", supabaseUrl: "https://ref.supabase.co" });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("connect-src 'self' https://ref.supabase.co wss://ref.supabase.co wss://*.stt.speech.microsoft.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(POLITICA_DE_PERMISOS).toContain("microphone=(self)");
    expect(POLITICA_DE_PERMISOS).toContain("camera=()");
    expect(POLITICA_DE_PERMISOS).toContain("geolocation=()");
  });
});
