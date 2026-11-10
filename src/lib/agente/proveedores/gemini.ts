import { ErrorProveedor, type MensajeLLM, type PedidoLLM, type ProveedorLLM, type Trozo } from "../tipos";
import { eventosSSE, pedir } from "./comun";

type Parte = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: unknown };
  functionResponse?: { id?: string; name: string; response: unknown };
};

/**
 * Gemini por REST, sin SDK. Dos detalles propios de los modelos 3.x:
 * cada llamada a herramienta trae un `id` que hay que repetir en la respuesta,
 * y una `thoughtSignature` (al lado del functionCall, no adentro) que hay que
 * devolver tal cual en el historial o el pedido siguiente falla con 400.
 */
export function crearGemini(config: {
  clave: string;
  modeloChat: string;
  modeloFondo: string;
  baseUrl?: string;
}): ProveedorLLM {
  const base = (config.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/$/, "");

  function contenidos(mensajes: MensajeLLM[]) {
    const salida: { role: "user" | "model"; parts: Parte[] }[] = [];
    const agregar = (role: "user" | "model", partes: Parte[]) => {
      const ultimo = salida[salida.length - 1];
      // Gemini espera turnos alternados: lo consecutivo del mismo rol se junta.
      if (ultimo?.role === role) ultimo.parts.push(...partes);
      else salida.push({ role, parts: partes });
    };
    for (const m of mensajes) {
      if (m.rol === "usuario") agregar("user", [{ text: m.texto }]);
      else if (m.rol === "agente") {
        const partes: Parte[] = m.texto ? [{ text: m.texto }] : [];
        for (const l of m.llamadas ?? []) {
          const firma = l.extra?.thoughtSignature;
          partes.push({
            functionCall: { id: l.id, name: l.nombre, args: l.argumentos ?? {} },
            ...(typeof firma === "string" ? { thoughtSignature: firma } : {}),
          });
        }
        if (partes.length) agregar("model", partes);
      } else {
        agregar("user", [
          { functionResponse: { id: m.id, name: m.nombre, response: { resultado: m.resultado } } },
        ]);
      }
    }
    return salida;
  }

  return {
    id: "gemini",
    modelo: (liviano) => (liviano ? config.modeloFondo : config.modeloChat),
    async *generar(pedido: PedidoLLM): AsyncGenerator<Trozo> {
      const modelo = pedido.liviano ? config.modeloFondo : config.modeloChat;
      const respuesta = await pedir(
        "gemini",
        `${base}/v1beta/models/${encodeURIComponent(modelo)}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": config.clave },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: pedido.sistema }] },
            contents: contenidos(pedido.mensajes),
            ...(pedido.herramientas?.length
              ? {
                  tools: [
                    {
                      functionDeclarations: pedido.herramientas.map((h) => ({
                        name: h.nombre,
                        description: h.descripcion,
                        parametersJsonSchema: h.parametros,
                      })),
                    },
                  ],
                }
              : {}),
          }),
        },
        { primerByteMs: 25_000, totalMs: 90_000, senal: pedido.senal },
      );

      let n = 0;
      let huboAlgo = false;
      for await (const evento of eventosSSE("gemini", respuesta)) {
        const e = evento as {
          candidates?: { content?: { parts?: Parte[] }; finishReason?: string }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          error?: { code?: number; message?: string };
        };
        if (e.error) {
          throw new ErrorProveedor("gemini", e.error.code === 429 ? "limite" : "otro", e.error.message ?? "Error");
        }
        for (const parte of e.candidates?.[0]?.content?.parts ?? []) {
          if (parte.functionCall) {
            huboAlgo = true;
            yield {
              tipo: "llamada",
              llamada: {
                id: parte.functionCall.id ?? `gemini-${Date.now()}-${n++}`,
                nombre: parte.functionCall.name,
                argumentos: parte.functionCall.args ?? {},
                ...(parte.thoughtSignature ? { extra: { thoughtSignature: parte.thoughtSignature } } : {}),
              },
            };
          } else if (parte.text && !parte.thought) {
            huboAlgo = true;
            yield { tipo: "texto", texto: parte.text };
          }
        }
        if (e.usageMetadata?.candidatesTokenCount !== undefined) {
          yield {
            tipo: "uso",
            entrada: e.usageMetadata.promptTokenCount ?? 0,
            salida: e.usageMetadata.candidatesTokenCount ?? 0,
          };
        }
      }
      if (!huboAlgo) throw new ErrorProveedor("gemini", "invalido", "Gemini devolvió una respuesta vacía");
    },
  };
}
