/**
 * Proveedores de mentira que hablan los protocolos reales por HTTP: Gemini,
 * Groq (formato OpenAI), Ollama y el emisor de tokens de Azure Speech. Sirven
 * para probar los adaptadores de verdad y para la recorrida en navegador, sin
 * claves y sin gastar cupo.
 *
 * Cada pedido consume el primer paso del guion que le corresponda:
 *   { proveedor?: "gemini"|"groq"|"ollama", siSistema?: "texto que debe estar en el prompt",
 *     estado?: 429, texto?: "…", llamadas?: [{ nombre, argumentos }], cortar?: true }
 * Sin guion, responde un texto fijo.
 */
const http = require("node:http");
const { createHash } = require("node:crypto");

/**
 * Caché de prompts de mentira, con las reglas de la API real: se escribe solo
 * en los puntos marcados con cache_control, se busca hacia atrás hasta 20
 * bloques, y no se guarda un prefijo de menos de 512 tokens. Los tokens se
 * estiman en 4 caracteres cada uno.
 */
function crearCacheClaude() {
  const guardados = new Set();
  const MINIMO = 512;
  const sinMarca = (bloque) => {
    if (!bloque || typeof bloque !== "object") return bloque;
    const { cache_control: _, ...resto } = bloque;
    return resto;
  };
  return function calcular(cuerpo) {
    // Orden en que la API arma el pedido: herramientas, sistema, mensajes.
    const bloques = [];
    for (const t of cuerpo.tools ?? []) bloques.push(t);
    const sistema = typeof cuerpo.system === "string" ? [{ type: "text", text: cuerpo.system }] : (cuerpo.system ?? []);
    for (const b of sistema) bloques.push(b);
    for (const m of cuerpo.messages ?? []) {
      const contenido = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
      contenido.forEach((b, i) => bloques.push({ ...b, __rol: i === 0 ? m.role : undefined }));
    }
    let hash = cuerpo.model;
    let tokens = 0;
    const posiciones = bloques.map((b) => {
      tokens += Math.ceil(JSON.stringify(sinMarca(b)).length / 4);
      hash = createHash("sha1").update(hash + JSON.stringify(sinMarca(b))).digest("hex");
      return { hash, tokens, marca: b.cache_control ?? null };
    });
    const total = tokens;
    const puntos = posiciones.map((p, i) => ({ ...p, i })).filter((p) => p.marca);
    let leido = 0;
    for (const p of puntos) {
      for (let j = p.i; j >= 0 && j > p.i - 20; j--) {
        if (guardados.has(posiciones[j].hash)) {
          leido = Math.max(leido, posiciones[j].tokens);
          break;
        }
      }
    }
    let escrito5m = 0;
    let escrito1h = 0;
    let hasta = leido;
    for (const p of puntos) {
      if (p.tokens < MINIMO || p.tokens <= hasta) continue;
      guardados.add(p.hash);
      const nuevos = p.tokens - hasta;
      if (p.marca.ttl === "1h") escrito1h += nuevos;
      else escrito5m += nuevos;
      hasta = p.tokens;
    }
    return {
      input_tokens: total - Math.max(leido, hasta),
      cache_read_input_tokens: leido,
      cache_creation_input_tokens: escrito5m + escrito1h,
      cache_creation: { ephemeral_5m_input_tokens: escrito5m, ephemeral_1h_input_tokens: escrito1h },
    };
  };
}

function crearModelos() {
  let guion = [];
  let pedidos = [];
  let cacheClaude = crearCacheClaude();

  function siguiente(proveedor, sistema) {
    const i = guion.findIndex(
      (p) => (!p.proveedor || p.proveedor === proveedor) && (!p.siSistema || sistema.includes(p.siSistema)),
    );
    return i === -1 ? { texto: `Respuesta de ${proveedor}.` } : guion.splice(i, 1)[0];
  }

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let crudo = "";
    req.on("data", (c) => (crudo += c));
    req.on("end", () => {
      const json = (estado, cuerpo) => {
        res.writeHead(estado, { "Content-Type": "application/json" });
        res.end(JSON.stringify(cuerpo));
      };
      /** API de Messages de Anthropic, con streaming y caché. */
      function claude(cuerpo) {
        // Los SDK actuales mandan la clave como «Authorization: Bearer»; los anteriores, como x-api-key.
        if (!req.headers["x-api-key"] && !/^Bearer .+/.test(req.headers.authorization ?? "")) return json(401, { type: "error", error: { type: "authentication_error", message: "Falta la clave" } });
        const sistema = (cuerpo.system ?? []).map((b) => b.text).join("\n\n");
        pedidos.push({ proveedor: "claude", ruta: url.pathname, cabeceras: req.headers, cuerpo });
        const paso = siguiente("claude", sistema);
        if (paso.estado) {
          const tipos = { 400: "invalid_request_error", 401: "authentication_error", 402: "billing_error", 403: "permission_error", 429: "rate_limit_error", 529: "overloaded_error" };
          return json(paso.estado, { type: "error", error: { type: tipos[paso.estado] ?? "api_error", message: paso.mensaje ?? "Error de prueba" } });
        }
        const uso = cacheClaude(cuerpo);
        const texto = paso.texto ?? "";
        const llamadas = (paso.llamadas ?? []).map((l, i) => ({ type: "tool_use", id: `toolu_${pedidos.length}_${i}`, name: l.nombre, input: l.argumentos }));
        const salida = Math.max(1, Math.ceil(texto.length / 4) + llamadas.length * 20);
        const stop = paso.refusal ? "refusal" : llamadas.length ? "tool_use" : "end_turn";
        const contenido = [...(texto ? [{ type: "text", text: texto }] : []), ...llamadas];
        const mensaje = { id: `msg_${pedidos.length}`, type: "message", role: "assistant", model: cuerpo.model, stop_reason: null, stop_sequence: null, content: [], usage: { ...uso, output_tokens: 1 } };
        if (!cuerpo.stream) {
          return json(200, { ...mensaje, content: contenido, stop_reason: stop, usage: { ...uso, output_tokens: salida } });
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const ev = (tipo, dato) => res.write(`event: ${tipo}\ndata: ${JSON.stringify({ type: tipo, ...dato })}\n\n`);
        ev("message_start", { message: mensaje });
        let i = 0;
        if (texto) {
          const mitad = Math.ceil(texto.length / 2);
          ev("content_block_start", { index: i, content_block: { type: "text", text: "" } });
          for (const p of [texto.slice(0, mitad), texto.slice(mitad)].filter(Boolean)) ev("content_block_delta", { index: i, delta: { type: "text_delta", text: p } });
          if (paso.cortar) return res.destroy();
          ev("content_block_stop", { index: i });
          i++;
        }
        for (const l of llamadas) {
          const args = JSON.stringify(l.input);
          ev("content_block_start", { index: i, content_block: { type: "tool_use", id: l.id, name: l.name, input: {} } });
          ev("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: args.slice(0, 5) } });
          ev("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: args.slice(5) } });
          ev("content_block_stop", { index: i });
          i++;
        }
        ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: salida } });
        ev("message_stop", {});
        res.end();
      }

      if (url.pathname === "/__guion") return (guion = JSON.parse(crudo)), json(200, {});
      if (url.pathname === "/__agregar") return guion.push(...JSON.parse(crudo)), json(200, {});
      if (url.pathname === "/__pedidos") return json(200, pedidos);
      if (url.pathname === "/__reiniciar") return (guion = []), (pedidos = []), (cacheClaude = crearCacheClaude()), json(200, {});
      if (url.pathname === "/sts/v1.0/issueToken") {
        res.writeHead(req.headers["ocp-apim-subscription-key"] ? 200 : 401);
        return res.end("token-de-mentira");
      }

      const cuerpo = crudo ? JSON.parse(crudo) : {};
      if (url.pathname === "/v1/messages") return claude(cuerpo);
      const proveedor = url.pathname.includes(":streamGenerateContent") ? "gemini" : url.pathname === "/api/chat" ? "ollama" : "groq";
      const sistema =
        proveedor === "gemini"
          ? (cuerpo.systemInstruction?.parts?.[0]?.text ?? "")
          : (cuerpo.messages?.find((m) => m.role === "system")?.content ?? "");
      pedidos.push({ proveedor, ruta: url.pathname, cabeceras: req.headers, cuerpo });
      const paso = siguiente(proveedor, sistema);
      if (paso.estado) return json(paso.estado, { error: { code: paso.estado, message: "Límite de prueba" } });

      const texto = paso.texto ?? "";
      const llamadas = paso.llamadas ?? [];
      // El texto sale en dos pedazos para ejercitar el streaming.
      const mitad = Math.ceil(texto.length / 2);
      const pedazos = texto ? [texto.slice(0, mitad), texto.slice(mitad)].filter(Boolean) : [];

      if (proveedor === "ollama") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        for (const p of pedazos) res.write(JSON.stringify({ message: { role: "assistant", content: p }, done: false }) + "\n");
        if (paso.cortar) return res.destroy();
        if (llamadas.length) {
          res.write(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: llamadas.map((l) => ({ function: { name: l.nombre, arguments: l.argumentos } })) }, done: false }) + "\n");
        }
        return res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true, prompt_eval_count: 11, eval_count: 7 }) + "\n");
      }

      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const evento = (dato) => res.write(`data: ${JSON.stringify(dato)}\n\n`);
      if (proveedor === "gemini") {
        for (const p of pedazos) evento({ candidates: [{ content: { role: "model", parts: [{ text: p }] } }] });
        if (paso.cortar) return res.destroy();
        if (llamadas.length) {
          evento({
            candidates: [{
              content: {
                role: "model",
                parts: llamadas.map((l, i) => ({
                  functionCall: { id: `fc_${pedidos.length}_${i}`, name: l.nombre, args: l.argumentos },
                  // Como Gemini 3: la firma viene solo en la primera llamada.
                  ...(i === 0 ? { thoughtSignature: "firma-de-prueba" } : {}),
                })),
              },
            }],
          });
        }
        evento({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 } });
        return res.end();
      }
      // Formato OpenAI (Groq).
      for (const p of pedazos) evento({ choices: [{ delta: { content: p } }] });
      if (paso.cortar) return res.destroy();
      llamadas.forEach((l, i) => {
        const args = JSON.stringify(l.argumentos);
        // Los argumentos llegan partidos, como en la API real.
        evento({ choices: [{ delta: { tool_calls: [{ index: i, id: `call_${pedidos.length}_${i}`, function: { name: l.nombre, arguments: args.slice(0, 5) } }] } }] });
        evento({ choices: [{ delta: { tool_calls: [{ index: i, function: { arguments: args.slice(5) } }] } }] });
      });
      evento({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7 } });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  servidor.guion = (pasos) => (guion = [...pasos]);
  servidor.pedidos = () => pedidos;
  // Sin devolver nada: vitest toma una función devuelta por beforeEach como limpieza y la llama.
  servidor.reiniciar = () => {
    guion = [];
    pedidos = [];
    cacheClaude = crearCacheClaude();
  };
  return servidor;
}

module.exports = { crearModelos };
