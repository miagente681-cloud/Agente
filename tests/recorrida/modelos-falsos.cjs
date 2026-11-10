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

function crearModelos() {
  let guion = [];
  let pedidos = [];

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
      if (url.pathname === "/__guion") return (guion = JSON.parse(crudo)), json(200, {});
      if (url.pathname === "/__agregar") return guion.push(...JSON.parse(crudo)), json(200, {});
      if (url.pathname === "/__pedidos") return json(200, pedidos);
      if (url.pathname === "/__reiniciar") return (guion = []), (pedidos = []), json(200, {});
      if (url.pathname === "/sts/v1.0/issueToken") {
        res.writeHead(req.headers["ocp-apim-subscription-key"] ? 200 : 401);
        return res.end("token-de-mentira");
      }

      const cuerpo = crudo ? JSON.parse(crudo) : {};
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
  servidor.reiniciar = () => ((guion = []), (pedidos = []));
  return servidor;
}

module.exports = { crearModelos };
