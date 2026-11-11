/**
 * Recorrida con la app SIN ninguna clave opcional (solo Supabase): nada tiene
 * que romperse, y cada función tiene que decir con claridad qué falta configurar.
 *
 *   node tests/recorrida/sin-claves.cjs   (después del mismo build que recorrer.cjs)
 */
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { crearServidor, cookieDeSesion } = require("./supabase-falso.cjs");

const BASE = "http://localhost:3101";
const FALSO = "http://127.0.0.1:54321";
let hechos = 0;
const afirmar = (condicion, texto) => {
  if (!condicion) throw new Error("FALLÓ: " + texto);
  hechos++;
  console.log("  ✓", texto);
};

async function main() {
  const falso = crearServidor().listen(54321, "127.0.0.1");
  // Se parte de un entorno limpio: ninguna variable de integración.
  const limpio = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(GEMINI|GROQ|OLLAMA|AZURE|VAPID|NEXT_PUBLIC_VAPID|CRON|SUPABASE_SERVICE)/.test(k)),
  );
  const next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", "3101"], {
    // La cuenta de prueba administra el despliegue (ve el detalle de /configurar).
    env: { ...limpio, NEXT_PUBLIC_SUPABASE_URL: FALSO, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "clave-falsa", CLAUDE_USUARIOS_PERMITIDOS: "prueba@ejemplo.com" },
    stdio: "ignore",
  });
  const navegador = await chromium.launch();
  try {
    for (let i = 0; i < 60; i++) {
      try {
        await fetch(BASE + "/ingresar");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 860 } });
    await contexto.addCookies([{ ...cookieDeSesion(), url: BASE }]);
    const pagina = await contexto.newPage();
    const errores = [];
    pagina.on("pageerror", (e) => errores.push(String(e)));
    const pedir = (ruta, init) => pagina.evaluate(async ([r, i]) => {
      const x = await fetch(r, i);
      return { estado: x.status, cuerpo: await x.text() };
    }, [ruta, init ?? { method: "POST" }]);

    console.log("Sin claves opcionales");
    await pagina.goto(BASE + "/configurar");
    await pagina.getByText("Estado de las integraciones").waitFor();
    afirmar((await pagina.getByText("Pendiente", { exact: true }).count()) === 5 && (await pagina.getByText("Pendiente (opcional)").count()) === 3,
      "/configurar muestra como pendientes Gemini, Groq, servicio, push y cron; Claude, Ollama y Azure como opcionales");

    await pagina.goto(BASE + "/chat");
    await pagina.getByText("Falta configurar el cerebro del Agente.").waitFor();
    await pagina.getByLabel("Mensaje para el Agente").fill("Hola");
    await pagina.getByLabel("Mensaje para el Agente").press("Enter");
    await pagina.getByText(/Falta configurar la clave de servicio/).waitFor();
    afirmar(true, "el chat avisa que falta la clave de servicio en lugar de fallar (sin ella no se puede limitar el uso)");

    const token = await pedir("/api/voice/token");
    afirmar(token.estado === 200 && JSON.parse(token.cuerpo).motivo === "sin_configurar", "sin Azure, el servidor responde que la voz usa el navegador");
    const uso = await pedir("/api/voice/uso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segundos: 5 }) });
    afirmar(uso.estado === 200, "reportar uso de voz sin clave de servicio no rompe");
    const push = await pedir("/api/push/probar");
    afirmar(JSON.parse(push.cuerpo).motivo === "sin_configurar", "la notificación de prueba dice que falta configurar");
    const cron = await fetch(BASE + "/api/cron/tick", { method: "POST", headers: { Authorization: "Bearer loquesea" } });
    afirmar(cron.status === 503, "el programador sin secreto responde 503 y no hace nada");

    const proyecto = await (await fetch(`${FALSO}/__sembrar`, { method: "POST", body: JSON.stringify({ tabla: "projects", fila: { name: "Prueba" } }) })).json();
    const llamada = await (await fetch(`${FALSO}/__sembrar`, { method: "POST", body: JSON.stringify({ tabla: "sessions", fila: { kind: "llamada_programada", channel: "voz", status: "notificada", scheduled_at: new Date().toISOString() } }) })).json();
    await pagina.goto(`${BASE}/llamada/${llamada.id}`);
    await pagina.getByRole("button", { name: "Atender" }).waitFor();
    afirmar(true, "la pantalla de llamada abre sin Azure");

    for (const ruta of ["/hoy", "/tablero", "/calendario", "/proyectos", `/proyectos/${proyecto.id}`, "/memoria", "/sesiones", "/bienvenida", "/configuracion"]) {
      const r = await pagina.goto(BASE + ruta);
      await pagina.waitForLoadState("networkidle");
      if (r.status() >= 400) throw new Error(`${ruta} respondió ${r.status()}`);
    }
    await pagina.getByText("Azure Speech no está configurado").waitFor();
    await pagina.getByText("Falta configurar el programador").waitFor();
    afirmar(true, "todas las pantallas cargan; Configuración explica qué falta para voz y llamadas");
    const borrado = await pedir("/api/cuenta/borrar");
    afirmar(JSON.parse(borrado.cuerpo).cuenta === false && (await (await fetch(`${FALSO}/__estado`)).json()).projects.length === 0,
      "borrar mis datos funciona también sin la clave de servicio (borra las filas)");
    afirmar(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
    console.log(`\n${hechos} comprobaciones pasaron.`);
  } finally {
    await navegador.close();
    next.kill();
    falso.close();
  }
}

main().catch((error) => {
  console.error("\n" + (error.stack ?? error));
  process.exit(1);
});
