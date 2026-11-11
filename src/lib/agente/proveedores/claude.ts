import Anthropic from "@anthropic-ai/sdk";
import type { Uso } from "../tipos";
import { ErrorProveedor, usoDe, type ClaseError, type MensajeLLM, type PedidoLLM, type ProveedorLLM, type Trozo } from "../tipos";
import type { UsoTokens } from "../claude/precios";

/**
 * Claude con el SDK oficial de Anthropic (API de Messages, herramientas y
 * streaming). El modelo depende del uso: Haiku para el chat y el fondo,
 * Sonnet para llamadas y entrevista (configurable).
 *
 * Caché de prompts. El pedido se arma de lo más estable a lo menos estable:
 *   herramientas → instrucciones (punto de caché 1) → memorias y estado (punto 2)
 *   → conversación (punto 3, en el último bloque).
 * La API pone las herramientas primero; por eso el primer punto, puesto en las
 * instrucciones, guarda también las definiciones de herramientas. En una
 * llamada cada turno lee del caché todo lo anterior.
 */

type Ttl = "5m" | "1h";
const PRIMER_BYTE_MS = 25_000;
/** Lo que necesita la conversación. Haiku sin razonamiento extendido; Sonnet razona antes de responder. */
const SALIDA_MAXIMA: Record<string, number> = { "claude-haiku-5-5": 4096 };
const SALIDA_POR_DEFECTO = 16_000;

export type ConfigAdaptadorClaude = {
  cliente: Anthropic;
  modelos: Record<Uso, string>;
  /** Se llama con lo que costó cada pedido. Puede devolver un aviso para la persona. */
  alUsar?: (r: { modelo: string; uso: Uso; tokens: UsoTokens }) => Promise<string | null>;
  /** Se llama cuando la clave no sirve o no hay crédito: así no se reintenta en cada mensaje. */
  alProblema?: (tipo: "clave" | "credito") => Promise<void>;
};

/** Duración del caché: en voz los turnos van seguidos; el chat escrito está espaciado. Las tareas de fondo son un solo pedido. */
export function ttlDe(pedido: Pick<PedidoLLM, "uso" | "liviano" | "voz">): Ttl | null {
  if (usoDe(pedido) === "fondo") return null;
  return pedido.voz ? "5m" : "1h";
}

/** Los ids de herramienta de otros proveedores pueden traer caracteres que Anthropic no acepta. */
const idSeguro = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "llamada";

/** Traduce la conversación neutra al formato de Anthropic. Exportada para las pruebas. */
export function aMensajesClaude(mensajes: MensajeLLM[], ttl: Ttl | null): Anthropic.MessageParam[] {
  const salida: Anthropic.MessageParam[] = [];
  let resultados: Anthropic.ToolResultBlockParam[] = [];
  const cerrarResultados = () => {
    if (!resultados.length) return;
    // Todos los resultados de una ronda de herramientas van en un solo mensaje.
    salida.push({ role: "user", content: resultados });
    resultados = [];
  };
  for (const m of mensajes) {
    if (m.rol === "herramienta") {
      resultados.push({ type: "tool_result", tool_use_id: idSeguro(m.id), content: JSON.stringify(m.resultado) });
      continue;
    }
    cerrarResultados();
    if (m.rol === "usuario") {
      if (m.texto.trim()) salida.push({ role: "user", content: [{ type: "text", text: m.texto }] });
      continue;
    }
    const bloques: Anthropic.ContentBlockParam[] = [];
    // Los bloques de razonamiento del turno en curso vuelven tal cual, antes de las llamadas.
    const previos = m.llamadas?.[0]?.extraTurno?.claude as Anthropic.ContentBlockParam[] | undefined;
    if (previos?.length) bloques.push(...previos);
    if (m.texto.trim()) bloques.push({ type: "text", text: m.texto });
    for (const l of m.llamadas ?? []) {
      bloques.push({ type: "tool_use", id: idSeguro(l.id), name: l.nombre, input: (l.argumentos ?? {}) as Record<string, unknown> });
    }
    if (bloques.length) salida.push({ role: "assistant", content: bloques });
  }
  cerrarResultados();

  // Punto de caché en el último bloque: el turno siguiente lee hasta acá.
  const ultimo = salida.at(-1);
  if (ttl && ultimo && Array.isArray(ultimo.content) && ultimo.content.length) {
    const bloque = ultimo.content[ultimo.content.length - 1] as Anthropic.ContentBlockParam & {
      cache_control?: Anthropic.CacheControlEphemeral;
    };
    if (bloque.type === "text" || bloque.type === "tool_result") bloque.cache_control = { type: "ephemeral", ttl };
  }
  return salida;
}

/** Arma el pedido completo. Exportada para las pruebas (orden del contexto y puntos de caché). */
export function armarPedidoClaude(modelo: string, pedido: PedidoLLM): Anthropic.MessageCreateParamsStreaming {
  const ttl = ttlDe(pedido);
  const partes = (pedido.sistemaPartes?.length ? pedido.sistemaPartes : [pedido.sistema]).filter((t) => t.trim());
  const system: Anthropic.TextBlockParam[] = partes.map((text) => ({
    type: "text",
    text,
    ...(ttl ? { cache_control: { type: "ephemeral" as const, ttl } } : {}),
  }));
  const esHaiku = modelo.startsWith("claude-haiku");
  return {
    model: modelo,
    max_tokens: SALIDA_MAXIMA[modelo] ?? SALIDA_POR_DEFECTO,
    stream: true,
    system,
    messages: aMensajesClaude(pedido.mensajes, ttl),
    ...(pedido.herramientas?.length
      ? {
          tools: pedido.herramientas.map((h) => ({
            name: h.nombre,
            description: h.descripcion,
            input_schema: h.parametros as Anthropic.Tool.InputSchema,
          })),
        }
      : {}),
    // Haiku: rápido y barato, sin razonamiento extendido (así tampoco quedan
    // bloques de razonamiento atados a la conversación). Sonnet y Opus razonan
    // con esfuerzo medio: es donde más importa que el coach piense.
    ...(esHaiku
      ? { thinking: { type: "disabled" as const }, output_config: { effort: "low" as const } }
      : { thinking: { type: "adaptive" as const }, output_config: { effort: "medium" as const } }),
  };
}

function clasificar(error: unknown): ClaseError {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "clave";
  if (error instanceof Anthropic.RateLimitError) return "limite";
  if (error instanceof Anthropic.APIConnectionError) return "sin_respuesta"; // incluye el tiempo agotado
  if (error instanceof Anthropic.APIError) {
    const tipo = (error as { type?: string }).type;
    if (error.status === 402 || tipo === "billing_error") return "credito";
    // Saldo agotado o límite de gasto puesto en la consola: llegan como 400.
    if (error.status === 400 && /credit balance|usage limits/i.test(error.message)) return "credito";
    if (error.status === 529 || tipo === "overloaded_error" || (error.status ?? 0) >= 500) return "sin_respuesta";
  }
  return "otro";
}

export function crearClaude(config: ConfigAdaptadorClaude): ProveedorLLM {
  return {
    id: "claude",
    modelo: (uso) => config.modelos[uso ?? "chat"],
    async *generar(pedido: PedidoLLM): AsyncGenerator<Trozo> {
      const uso = usoDe(pedido);
      const modelo = config.modelos[uso];
      const control = new AbortController();
      const alAbortar = () => control.abort();
      pedido.senal?.addEventListener("abort", alAbortar, { once: true });
      // Si no llega nada a tiempo, se pasa al siguiente proveedor.
      let reloj: ReturnType<typeof setTimeout> | null = setTimeout(() => control.abort(), PRIMER_BYTE_MS);

      let mensaje: Anthropic.Message;
      try {
        const flujo = config.cliente.messages.stream(armarPedidoClaude(modelo, pedido), { signal: control.signal });
        for await (const evento of flujo) {
          if (reloj) {
            clearTimeout(reloj);
            reloj = null;
          }
          if (evento.type === "content_block_delta" && evento.delta.type === "text_delta") {
            yield { tipo: "texto", texto: evento.delta.text };
          }
        }
        mensaje = await flujo.finalMessage();
      } catch (error) {
        if (pedido.senal?.aborted) throw error;
        const clase = control.signal.aborted ? "sin_respuesta" : clasificar(error);
        if (clase === "clave" || clase === "credito") await config.alProblema?.(clase).catch(() => null);
        const detalle = error instanceof Error ? error.message.slice(0, 200) : "";
        throw new ErrorProveedor("claude", clase, `Claude (${modelo}) falló: ${detalle}`);
      } finally {
        if (reloj) clearTimeout(reloj);
        pedido.senal?.removeEventListener("abort", alAbortar);
      }

      const u = mensaje.usage;
      const tokens: UsoTokens = {
        entrada: u.input_tokens ?? 0,
        salida: u.output_tokens ?? 0,
        cache5m: u.cache_creation?.ephemeral_5m_input_tokens ?? (u.cache_creation ? 0 : (u.cache_creation_input_tokens ?? 0)),
        cache1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
        lectura: u.cache_read_input_tokens ?? 0,
      };
      const aviso = await config.alUsar?.({ modelo, uso, tokens }).catch(() => null);
      yield { tipo: "uso", entrada: tokens.entrada + tokens.cache5m + tokens.cache1h + tokens.lectura, salida: tokens.salida };
      if (aviso) yield { tipo: "aviso", mensaje: aviso };

      if (mensaje.stop_reason === "refusal") {
        throw new ErrorProveedor("claude", "invalido", "Claude declinó responder");
      }
      const llamadas = mensaje.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (mensaje.stop_reason === "max_tokens" && llamadas.length) {
        throw new ErrorProveedor("claude", "invalido", "La respuesta se cortó en medio de una llamada a herramienta");
      }
      // Los bloques de razonamiento vuelven sin cambios en el mismo turno; no se guardan.
      const razonamiento = mensaje.content.filter((b) => b.type === "thinking" || b.type === "redacted_thinking");
      let primera = true;
      for (const b of llamadas) {
        yield {
          tipo: "llamada",
          llamada: {
            id: b.id,
            nombre: b.name,
            argumentos: b.input,
            ...(primera && razonamiento.length ? { extraTurno: { claude: razonamiento } } : {}),
          },
        };
        primera = false;
      }
      const hayTexto = mensaje.content.some((b) => b.type === "text" && b.text.trim());
      if (!hayTexto && !llamadas.length) throw new ErrorProveedor("claude", "invalido", "Respuesta vacía");
    },
  };
}
