import { ErrorProveedor, type MensajeLLM, type PedidoLLM, type ProveedorLLM, type Trozo } from "../tipos";
import { comoObjeto, eventosSSE, pedir } from "./comun";

/** Adaptador para APIs con el formato de OpenAI (Groq). */
export function crearCompatibleOpenAI(config: {
  id: string;
  clave: string;
  modelo: string;
  baseUrl: string;
  primerByteMs?: number;
}): ProveedorLLM {
  const base = config.baseUrl.replace(/\/$/, "");

  function mensajes(sistema: string, lista: MensajeLLM[]) {
    const salida: Record<string, unknown>[] = [{ role: "system", content: sistema }];
    for (const m of lista) {
      if (m.rol === "usuario") salida.push({ role: "user", content: m.texto });
      else if (m.rol === "agente") {
        salida.push({
          role: "assistant",
          content: m.texto || null,
          ...(m.llamadas?.length
            ? {
                tool_calls: m.llamadas.map((l) => ({
                  id: l.id,
                  type: "function",
                  function: { name: l.nombre, arguments: JSON.stringify(l.argumentos ?? {}) },
                })),
              }
            : {}),
        });
      } else {
        salida.push({ role: "tool", tool_call_id: m.id, content: JSON.stringify(m.resultado) });
      }
    }
    return salida;
  }

  return {
    id: config.id,
    modelo: () => config.modelo,
    async *generar(pedido: PedidoLLM): AsyncGenerator<Trozo> {
      const respuesta = await pedir(
        config.id,
        `${base}/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.clave}` },
          body: JSON.stringify({
            model: config.modelo,
            stream: true,
            stream_options: { include_usage: true },
            messages: mensajes(pedido.sistema, pedido.mensajes),
            ...(pedido.herramientas?.length
              ? {
                  tools: pedido.herramientas.map((h) => ({
                    type: "function",
                    function: { name: h.nombre, description: h.descripcion, parameters: h.parametros },
                  })),
                }
              : {}),
          }),
        },
        { primerByteMs: config.primerByteMs ?? 25_000, totalMs: 90_000, senal: pedido.senal },
      );

      // Las llamadas a herramientas llegan en pedazos, por índice.
      const parciales = new Map<number, { id: string; nombre: string; args: string }>();
      let huboAlgo = false;
      for await (const evento of eventosSSE(config.id, respuesta)) {
        const e = evento as {
          choices?: {
            delta?: {
              content?: string | null;
              tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
            };
          }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          error?: { message?: string; code?: string };
        };
        if (e.error) {
          const limite = /rate|limit/i.test(`${e.error.code} ${e.error.message}`);
          throw new ErrorProveedor(config.id, limite ? "limite" : "otro", e.error.message ?? "Error");
        }
        const delta = e.choices?.[0]?.delta;
        if (delta?.content) {
          huboAlgo = true;
          yield { tipo: "texto", texto: delta.content };
        }
        for (const t of delta?.tool_calls ?? []) {
          const i = t.index ?? 0;
          const actual = parciales.get(i) ?? { id: "", nombre: "", args: "" };
          if (t.id) actual.id = t.id;
          if (t.function?.name) actual.nombre = t.function.name;
          if (t.function?.arguments) actual.args += t.function.arguments;
          parciales.set(i, actual);
        }
        if (e.usage) {
          yield { tipo: "uso", entrada: e.usage.prompt_tokens ?? 0, salida: e.usage.completion_tokens ?? 0 };
        }
      }
      let n = 0;
      for (const p of parciales.values()) {
        if (!p.nombre) continue;
        huboAlgo = true;
        yield {
          tipo: "llamada",
          llamada: { id: p.id || `${config.id}-${Date.now()}-${n++}`, nombre: p.nombre, argumentos: comoObjeto(p.args) },
        };
      }
      if (!huboAlgo) throw new ErrorProveedor(config.id, "invalido", "Respuesta vacía");
    },
  };
}
