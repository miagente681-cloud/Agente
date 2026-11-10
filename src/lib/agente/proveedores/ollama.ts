import { ErrorProveedor, type MensajeLLM, type PedidoLLM, type ProveedorLLM, type Trozo } from "../tipos";
import { comoObjeto, lineas, pedir } from "./comun";

/**
 * Modelo local con Ollama, por su API nativa (/api/chat): con herramientas es
 * más confiable que su capa compatible con OpenAI. Vive en la computadora del
 * usuario, detrás de un túnel con autenticación, así que puede estar apagada:
 * si no contesta en pocos segundos se pasa al siguiente proveedor.
 */
export function crearOllama(config: {
  baseUrl: string;
  modelo: string;
  token?: string;
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
          content: m.texto,
          ...(m.llamadas?.length
            ? { tool_calls: m.llamadas.map((l) => ({ function: { name: l.nombre, arguments: l.argumentos ?? {} } })) }
            : {}),
        });
      } else {
        salida.push({ role: "tool", tool_name: m.nombre, content: JSON.stringify(m.resultado) });
      }
    }
    return salida;
  }

  return {
    id: "ollama",
    modelo: () => config.modelo,
    async *generar(pedido: PedidoLLM): AsyncGenerator<Trozo> {
      const respuesta = await pedir(
        "ollama",
        `${base}/api/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
          },
          body: JSON.stringify({
            model: config.modelo,
            stream: true,
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
        // Cargar el modelo en memoria puede tardar: el reloj corto es solo para conectar.
        { primerByteMs: config.primerByteMs ?? 6_000, totalMs: 120_000, senal: pedido.senal },
      );

      let n = 0;
      let huboAlgo = false;
      for await (const linea of lineas("ollama", respuesta)) {
        let e: {
          message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
          error?: string;
        };
        try {
          e = JSON.parse(linea);
        } catch {
          throw new ErrorProveedor("ollama", "invalido", "Respuesta mal formada");
        }
        if (e.error) throw new ErrorProveedor("ollama", "otro", e.error);
        if (e.message?.content) {
          huboAlgo = true;
          yield { tipo: "texto", texto: e.message.content };
        }
        for (const t of e.message?.tool_calls ?? []) {
          if (!t.function?.name) continue;
          huboAlgo = true;
          yield {
            tipo: "llamada",
            llamada: {
              id: `ollama-${Date.now()}-${n++}`,
              nombre: t.function.name,
              argumentos: comoObjeto(t.function.arguments),
            },
          };
        }
        if (e.done) yield { tipo: "uso", entrada: e.prompt_eval_count ?? 0, salida: e.eval_count ?? 0 };
      }
      if (!huboAlgo) throw new ErrorProveedor("ollama", "invalido", "Respuesta vacía");
    },
  };
}
