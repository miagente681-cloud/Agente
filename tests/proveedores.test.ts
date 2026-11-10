import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearGemini } from "@/lib/agente/proveedores/gemini";
import { crearOllama } from "@/lib/agente/proveedores/ollama";
import { crearCompatibleOpenAI } from "@/lib/agente/proveedores/openai";
import { ErrorProveedor, type MensajeLLM, type ProveedorLLM, type Trozo } from "@/lib/agente/tipos";
import { definiciones } from "@/lib/agente/herramientas";
import { juntar, levantarModelos, type ServidorModelos } from "./apoyo/falsos";

/**
 * Los tres adaptadores contra servidores de mentira que hablan cada protocolo
 * (streaming incluido). Comprueba el formato de ida y de vuelta; no reemplaza
 * una prueba con las APIs reales.
 */
let servidor: ServidorModelos;
let gemini: ProveedorLLM;
let groq: ProveedorLLM;
let ollama: ProveedorLLM;
let url: string;

beforeAll(async () => {
  ({ servidor, url } = await levantarModelos());
  gemini = crearGemini({ clave: "clave-g", modeloChat: "gemini-chat", modeloFondo: "gemini-fondo", baseUrl: url });
  groq = crearCompatibleOpenAI({ id: "groq", clave: "clave-q", modelo: "openai/gpt-oss-120b", baseUrl: `${url}/groq` });
  ollama = crearOllama({ baseUrl: url, modelo: "qwen3:8b", token: "secreto-tunel" });
});
afterAll(() => servidor.close());
beforeEach(() => servidor.reiniciar());

const herramientas = definiciones(["actualizar_tarea"]);
const LLAMADA = { nombre: "actualizar_tarea", argumentos: { tarea_id: "ab12cd34", estado: "hecha" } };
const texto = (trozos: Trozo[]) => trozos.flatMap((t) => (t.tipo === "texto" ? [t.texto] : [])).join("");
const llamadas = (trozos: Trozo[]) => trozos.flatMap((t) => (t.tipo === "llamada" ? [t.llamada] : []));

describe.each([
  ["gemini", () => gemini],
  ["groq", () => groq],
  ["ollama", () => ollama],
])("adaptador de %s", (id, dame) => {
  it("lee texto en streaming y el uso de tokens", async () => {
    servidor.guion([{ texto: "Hola, ¿qué pasó con los azulejos?" }]);
    const trozos = await juntar(dame().generar({ sistema: "Sos un coach.", mensajes: [{ rol: "usuario", texto: "Hola" }] }));
    expect(texto(trozos)).toBe("Hola, ¿qué pasó con los azulejos?");
    expect(trozos.filter((t) => t.tipo === "texto").length).toBeGreaterThan(1); // llegó en pedazos
    expect(trozos.at(-1)).toEqual({ tipo: "uso", entrada: 11, salida: 7 });
  });

  it("lee llamadas a herramientas con sus argumentos", async () => {
    servidor.guion([{ texto: "Dale.", llamadas: [LLAMADA, { nombre: "actualizar_tarea", argumentos: { tarea_id: "ffff0000", estado: "bloqueada" } }] }]);
    const trozos = await juntar(dame().generar({ sistema: "s", mensajes: [{ rol: "usuario", texto: "Terminé" }], herramientas }));
    const pedidas = llamadas(trozos);
    expect(pedidas).toHaveLength(2);
    expect(pedidas[0]).toMatchObject({ nombre: "actualizar_tarea", argumentos: { tarea_id: "ab12cd34", estado: "hecha" } });
    expect(pedidas[1].argumentos).toEqual({ tarea_id: "ffff0000", estado: "bloqueada" });
    expect(new Set(pedidas.map((p) => p.id)).size).toBe(2);
    expect(servidor.pedidos()[0].proveedor).toBe(id);
  });

  it("un 429 es un error de límite; un corte a mitad, falta de respuesta", async () => {
    servidor.guion([{ estado: 429 }, { texto: "Empiezo a contestar y", cortar: true }]);
    const pedido = { sistema: "s", mensajes: [{ rol: "usuario", texto: "Hola" } as MensajeLLM] };
    await expect(juntar(dame().generar(pedido))).rejects.toMatchObject({ name: "ErrorProveedor", clase: "limite" });
    await expect(juntar(dame().generar(pedido))).rejects.toMatchObject({ clase: "sin_respuesta" });
  });

  it("devuelve el resultado de la herramienta en el formato del proveedor", async () => {
    servidor.guion([{ llamadas: [LLAMADA] }, { texto: "Listo." }]);
    const mensajes: MensajeLLM[] = [{ rol: "usuario", texto: "Terminé los azulejos" }];
    const [pedida] = llamadas(await juntar(dame().generar({ sistema: "s", mensajes, herramientas })));
    mensajes.push({ rol: "agente", texto: "", llamadas: [pedida] });
    mensajes.push({ rol: "herramienta", id: pedida.id, nombre: pedida.nombre, resultado: { ok: true } });
    expect(texto(await juntar(dame().generar({ sistema: "s", mensajes, herramientas })))).toBe("Listo.");
  });
});

describe("detalles de cada protocolo", () => {
  it("Gemini: clave en la cabecera, esquema JSON estándar, y la firma y el id vuelven tal cual", async () => {
    servidor.guion([{ llamadas: [LLAMADA] }, { texto: "Listo." }]);
    const mensajes: MensajeLLM[] = [{ rol: "usuario", texto: "Terminé" }];
    const [pedida] = llamadas(await juntar(gemini.generar({ sistema: "Sos un coach.", mensajes, herramientas })));
    expect(pedida.extra).toEqual({ thoughtSignature: "firma-de-prueba" });
    mensajes.push({ rol: "agente", texto: "", llamadas: [pedida] }, { rol: "herramienta", id: pedida.id, nombre: pedida.nombre, resultado: { ok: true } });
    await juntar(gemini.generar({ sistema: "Sos un coach.", mensajes, herramientas, liviano: true }));

    const [primero, segundo] = servidor.pedidos();
    expect(primero.cabeceras["x-goog-api-key"]).toBe("clave-g");
    expect((primero as unknown as { ruta: string }).ruta).toBe("/v1beta/models/gemini-chat:streamGenerateContent");
    expect((segundo as unknown as { ruta: string }).ruta).toContain("gemini-fondo"); // tareas de fondo: modelo liviano
    expect(primero.cuerpo.systemInstruction.parts[0].text).toBe("Sos un coach.");
    expect(primero.cuerpo.tools[0].functionDeclarations[0]).toHaveProperty("parametersJsonSchema.properties.tarea_id");
    const [, modelo, respuesta] = segundo.cuerpo.contents;
    expect(modelo).toEqual({
      role: "model",
      parts: [{ functionCall: { id: pedida.id, name: "actualizar_tarea", args: LLAMADA.argumentos }, thoughtSignature: "firma-de-prueba" }],
    });
    expect(respuesta.parts[0].functionResponse).toEqual({ id: pedida.id, name: "actualizar_tarea", response: { resultado: { ok: true } } });
  });

  it("Groq: formato OpenAI con la clave como Bearer y los argumentos como texto", async () => {
    servidor.guion([{ texto: "Hola." }]);
    await juntar(
      groq.generar({
        sistema: "s",
        herramientas,
        mensajes: [
          { rol: "usuario", texto: "Terminé" },
          { rol: "agente", texto: "", llamadas: [{ id: "call_1", ...LLAMADA }] },
          { rol: "herramienta", id: "call_1", nombre: "actualizar_tarea", resultado: { ok: true } },
        ],
      }),
    );
    const { cuerpo, cabeceras } = servidor.pedidos()[0];
    expect(cabeceras.authorization).toBe("Bearer clave-q");
    expect(cuerpo).toMatchObject({ model: "openai/gpt-oss-120b", stream: true });
    expect(cuerpo.messages[2].tool_calls[0]).toEqual({
      id: "call_1", type: "function", function: { name: "actualizar_tarea", arguments: JSON.stringify(LLAMADA.argumentos) },
    });
    expect(cuerpo.messages[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: '{"ok":true}' });
    expect(cuerpo.tools[0].function.parameters.type).toBe("object");
  });

  it("Ollama: manda el token del túnel y, con la computadora apagada, falla rápido", async () => {
    servidor.guion([{ texto: "Hola." }]);
    await juntar(ollama.generar({ sistema: "s", mensajes: [{ rol: "usuario", texto: "Hola" }] }));
    expect(servidor.pedidos()[0].cabeceras.authorization).toBe("Bearer secreto-tunel");
    expect(servidor.pedidos()[0].cuerpo).toMatchObject({ model: "qwen3:8b", stream: true });

    // Nadie escucha en ese puerto: es lo que pasa con la computadora apagada.
    const apagada = crearOllama({ baseUrl: "http://127.0.0.1:9", modelo: "qwen3:8b", primerByteMs: 1500 });
    const inicio = Date.now();
    const error = await juntar(apagada.generar({ sistema: "s", mensajes: [{ rol: "usuario", texto: "Hola" }] })).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorProveedor);
    expect(error.clase).toBe("sin_respuesta");
    expect(Date.now() - inicio).toBeLessThan(3000);
  });
});
