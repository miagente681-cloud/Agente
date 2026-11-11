/**
 * Recorrida del Agente con Claude, contra un Claude de mentira que habla el
 * protocolo de Anthropic (con caché simulado). Después del mismo build que
 * recorrer.cjs:
 *
 *   node tests/recorrida/claude.cjs [carpeta-de-capturas]
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright");
const { crearServidor, cookieDeSesion } = require("./supabase-falso.cjs");
const { crearModelos } = require("./modelos-falsos.cjs");

const BASE = "http://localhost:3103";
const FALSO = "http://127.0.0.1:54321";
const MODELOS = "http://127.0.0.1:54322";
const capturas = process.argv[2] ?? path.join(__dirname, "capturas");
let hechos = 0;
const afirmar = (condicion, texto) => {
  if (!condicion) throw new Error("FALLÓ: " + texto);
  hechos++;
  console.log("  ✓", texto);
};
const estado = async () => (await fetch(`${FALSO}/__estado`)).json();
const editar = (tabla, id, cambios) => fetch(`${FALSO}/__editar`, { method: "POST", body: JSON.stringify({ tabla, id, cambios }) });
const guion = (pasos) => fetch(`${MODELOS}/__guion`, { method: "POST", body: JSON.stringify(pasos) });
const pedidosClaude = async () => (await (await fetch(`${MODELOS}/__pedidos`)).json()).filter((p) => p.proveedor === "claude");

async function main() {
  const falso = crearServidor().listen(54321, "127.0.0.1");
  const modelos = crearModelos().listen(54322, "127.0.0.1");
  const next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", "3103"], {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: FALSO,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "clave-falsa",
      ANTHROPIC_API_KEY: "clave-de-mentira",
      // Claude necesita la clave de servicio (el gasto lo escribe solo el servidor) y un correo permitido.
      SUPABASE_SERVICE_ROLE_KEY: "servicio-falsa",
      CLAUDE_USUARIOS_PERMITIDOS: "prueba@ejemplo.com",
      ANTHROPIC_BASE_URL: MODELOS,
      GEMINI_API_KEY: "falsa",
      GEMINI_BASE_URL: MODELOS,
    },
    stdio: "ignore",
  });
  const navegador = await chromium.launch();
  try {
    for (let i = 0; i < 60; i++) {
      try { await fetch(BASE + "/ingresar"); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    await contexto.addCookies([{ ...cookieDeSesion(), url: BASE }]);
    const pagina = await contexto.newPage();
    const errores = [];
    pagina.on("pageerror", (e) => errores.push(String(e)));
    const proyecto = await (await fetch(`${FALSO}/__sembrar`, { method: "POST", body: JSON.stringify({ tabla: "projects", fila: { name: "Reformar el baño" } }) })).json();
    const tarea = await (await fetch(`${FALSO}/__sembrar`, { method: "POST", body: JSON.stringify({ tabla: "tasks", fila: { project_id: proyecto.id, title: "Elegir azulejos" } }) })).json();

    console.log("Claude con la clave cargada");
    await pagina.goto(BASE + "/configurar");
    const fila = pagina.locator("li", { hasText: "Claude (cerebro principal" });
    afirmar((await fila.getByText("Configurada", { exact: true }).count()) === 1 && !(await pagina.content()).includes("clave-de-mentira"),
      "/configurar muestra Claude como configurada, sin mostrar la clave");

    await pagina.goto(BASE + "/configuracion");
    await pagina.getByRole("button", { name: "Probar conexión" }).click();
    await pagina.getByText(/Anda: respondió Claude Haiku 5.5 en \d+ ms/).waitFor();
    afirmar(true, "«Probar conexión» hace un pedido mínimo y dice que anda");

    await guion([
      { proveedor: "claude", llamadas: [{ nombre: "actualizar_tarea", argumentos: { tarea_id: tarea.id.slice(0, 8), estado: "hecha" } }] },
      { proveedor: "claude", texto: "Listo, azulejos hecha. ¿Qué sigue?" },
      { proveedor: "claude", texto: "Dale, lo vemos el jueves." },
    ]);
    await pagina.goto(BASE + "/chat");
    const mensaje = pagina.getByLabel("Mensaje para el Agente");
    await mensaje.fill("Terminé de elegir los azulejos");
    await mensaje.press("Enter");
    await pagina.getByText("Listo, azulejos hecha. ¿Qué sigue?").waitFor();
    await pagina.getByText("«Elegir azulejos»: hecha").waitFor();
    await pagina.getByText("Claude Haiku 5.5", { exact: true }).first().waitFor();
    afirmar((await estado()).tasks[0].status === "hecha", "el chat responde con Claude Haiku 5.5 y aplica el cambio");
    await mensaje.fill("El plomero, pero el jueves");
    await mensaje.press("Enter");
    await pagina.getByText("Dale, lo vemos el jueves.").waitFor();
    let e = await estado();
    const usos = e.llm_usage;
    afirmar(usos.length === 4 && usos.every((u) => u.model === "claude-haiku-5-5" && u.uso !== "llamada"),
      `cada pedido a Claude queda registrado (${usos.length}: la prueba de conexión y tres del chat)`);
    afirmar(usos[2].cache_read_tokens > 0 && usos[3].cache_read_tokens > usos[2].cache_read_tokens && usos[1].cache_write_1h_tokens > 0,
      `el caché se escribe en el primer pedido y se lee en los siguientes (lecturas: ${usos.map((u) => u.cache_read_tokens).join(", ")})`);
    const pedidos = await pedidosClaude();
    afirmar(JSON.stringify(pedidos.at(-1).cuerpo.system).includes("cache_control") && pedidos.at(-1).cuerpo.model === "claude-haiku-5-5",
      "los pedidos llevan los puntos de caché y el modelo de chat");
    await pagina.screenshot({ path: path.join(capturas, "24-claude-chat.png") });

    await pagina.getByRole("button", { name: "Terminar" }).click();
    await pagina.waitForURL(/\/sesiones\/[0-9a-f-]{36}$/);
    await pagina.getByText(/Claude: US\$ [\d,]+ en \d+ pedidos \(estimado\)/).waitFor();
    await pagina.getByText("Transcripción").click();
    await pagina.getByText("Agente · Claude Haiku 5.5").first().waitFor();
    afirmar(true, "el detalle de la sesión muestra el costo estimado y qué modelo respondió cada mensaje");

    await pagina.goto(BASE + "/configuracion");
    await pagina.getByText("Gasto de este mes").waitFor();
    await pagina.getByText("Por modelo").waitFor();
    await pagina.getByText("Es una estimación").waitFor();
    afirmar((await pagina.getByText("Claude Haiku 5.5").count()) >= 1, "Configuración muestra el gasto del mes con desglose por uso y por modelo");
    await pagina.getByLabel("Llamadas programadas").selectOption("claude-opus-5-5");
    await pagina.waitForTimeout(300);
    afirmar((await estado()).profiles[0].agent_config.claude_modelos.llamada === "claude-opus-5-5", "el modelo de cada uso se cambia desde una lista cerrada");
    await pagina.getByLabel("Llamadas programadas").selectOption("claude-sonnet-5-5");
    await pagina.screenshot({ path: path.join(capturas, "25-claude-config.png"), fullPage: true });

    console.log("Presupuesto");
    // Tope apenas por encima de lo gastado: el próximo pedido cruza el 80 %.
    e = await estado();
    const gastado = e.llm_usage.reduce((t, u) => t + Number(u.cost_usd), 0);
    await editar("profiles", null, { agent_config: { ...e.profiles[0].agent_config, claude_tope_usd: gastado * 1.15 } });
    await guion([{ proveedor: "claude", texto: "Acá estoy." }]);
    await pagina.goto(BASE + "/chat");
    await mensaje.fill("Hola de nuevo");
    await mensaje.press("Enter");
    await pagina.getByText(/Ya usaste el 80 % del presupuesto de Claude de este mes/).waitFor();
    afirmar((await estado()).profiles[0].agent_config.claude_aviso_80, "al pasar el 80 % avisa en la app (y por push si hay claves)");
    await mensaje.fill("¿Seguís?");
    await guion([{ proveedor: "claude", texto: "Sigo." }]);
    await mensaje.press("Enter");
    await pagina.getByText("Sigo.").waitFor();
    afirmar((await pagina.getByText(/Ya usaste el 80 %/).count()) === 1, "el aviso del 80 % sale una sola vez");

    // Llega al tope (gastado = 110 % del tope): esta sesión sigue con Claude
    // (hasta un 20 % por encima); la próxima pasa al gratuito y lo dice una vez.
    e = await estado();
    const gastadoAhora = e.llm_usage.reduce((t, u) => t + Number(u.cost_usd), 0);
    await editar("profiles", null, { agent_config: { ...e.profiles[0].agent_config, claude_tope_usd: gastadoAhora / 1.1 } });
    await guion([{ proveedor: "claude", texto: "Termino esta con Claude." }]);
    await mensaje.fill("Una más");
    await mensaje.press("Enter");
    await pagina.getByText("Termino esta con Claude.").waitFor();
    afirmar(true, "si se llega al tope en medio de una sesión, esa sesión se termina con Claude (hasta un 20 % por encima)");
    await pagina.getByRole("button", { name: "Terminar" }).click();
    await pagina.waitForURL(/\/sesiones\//);
    const antes = (await pedidosClaude()).length;
    await guion([{ proveedor: "gemini", texto: "Te escucho desde Gemini." }, { proveedor: "gemini", texto: "Sigo con Gemini." }]);
    await pagina.goto(BASE + "/chat");
    await mensaje.fill("Hola");
    await mensaje.press("Enter");
    await pagina.getByText("Te escucho desde Gemini.").waitFor();
    await pagina.getByText(/Este mes ya usé todo el presupuesto de Claude; sigo con el modelo gratuito\./).waitFor();
    await mensaje.fill("Dale");
    await mensaje.press("Enter");
    await pagina.getByText("Sigo con Gemini.").waitFor();
    afirmar((await pagina.getByText(/ya usé todo el presupuesto/).count()) === 1 && (await pedidosClaude()).length === antes,
      "al llegar al tope la sesión siguiente usa el gratuito, lo dice una sola vez y no le pide nada a Claude");

    console.log("Clave inválida");
    e = await estado();
    await editar("profiles", null, { agent_config: { ...e.profiles[0].agent_config, claude_tope_usd: 10 } });
    await pagina.getByRole("button", { name: "Terminar" }).click();
    await pagina.waitForURL(/\/sesiones\//);
    await guion([{ proveedor: "claude", estado: 401 }]);
    await pagina.goto(BASE + "/configuracion");
    await pagina.getByRole("button", { name: "Probar conexión" }).click();
    await pagina.getByText(/La clave no es válida o fue revocada/).waitFor();
    await pagina.reload();
    await pagina.getByText(/La clave de Claude no es válida/).waitFor();
    afirmar((await estado()).profiles[0].agent_config.claude_problema?.tipo === "clave", "una clave inválida deja un aviso claro en Configuración");
    const conProblema = (await pedidosClaude()).length;
    await guion([{ proveedor: "gemini", texto: "Respondo yo mientras." }]);
    await pagina.goto(BASE + "/chat");
    await mensaje.fill("Hola");
    await mensaje.press("Enter");
    await pagina.getByText("Respondo yo mientras.").waitFor();
    afirmar((await pedidosClaude()).length === conProblema, "con la clave marcada como inválida no se le reintenta a Claude en cada mensaje");

    afirmar(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
    console.log(`\n${hechos} comprobaciones pasaron.`);
  } finally {
    await navegador.close();
    next.kill();
    falso.close();
    modelos.close();
  }
}

main().catch((error) => {
  console.error("\n" + (error.stack ?? error));
  process.exit(1);
});
