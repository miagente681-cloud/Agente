/**
 * Recorrida de la fase 2 en un navegador real, contra el Supabase de mentira.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=clave-falsa npm run build
 *   node tests/recorrida/recorrer.cjs [carpeta-de-capturas]
 *
 * Levanta `next start` en el puerto 3100, hace el camino completo y deja capturas.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright");
const { crearServidor, cookieDeSesion } = require("./supabase-falso.cjs");
const { crearModelos } = require("./modelos-falsos.cjs");

const BASE = "http://localhost:3100";
const FALSO = "http://127.0.0.1:54321";
const MODELOS = "http://127.0.0.1:54322";
const capturas = process.argv[2] ?? path.join(__dirname, "capturas");
const hechos = [];
const ok = (texto) => (hechos.push(texto), console.log("  ✓", texto));
const afirmar = (condicion, texto) => {
  if (!condicion) throw new Error("FALLÓ: " + texto);
  ok(texto);
};
const estado = async () => (await fetch(`${FALSO}/__estado`)).json();
const sembrar = (tabla, fila) => fetch(`${FALSO}/__sembrar`, { method: "POST", body: JSON.stringify({ tabla, fila }) });
const guion = (pasos) => fetch(`${MODELOS}/__guion`, { method: "POST", body: JSON.stringify(pasos) });
const pedidosAlModelo = async () => (await fetch(`${MODELOS}/__pedidos`)).json();
const corto = (id) => id.slice(0, 8);
const fechaMvd = (dias = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(Date.now() + dias * 86_400_000);

/** Variables que agregan las fases siguientes. */
const ENTORNO_EXTRA = {};

async function esperarServidor() {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(BASE + "/ingresar");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("next start no levantó");
}

async function main() {
  const falso = crearServidor().listen(54321, "127.0.0.1");
  const modelos = crearModelos().listen(54322, "127.0.0.1");
  const next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", "3100"], {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: FALSO,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "clave-falsa",
      // Proveedores de mentira: mismas variables que en producción, apuntando a otro lado.
      GEMINI_API_KEY: "falsa",
      GEMINI_BASE_URL: MODELOS,
      GROQ_API_KEY: "falsa",
      GROQ_BASE_URL: `${MODELOS}/groq`,
      ...ENTORNO_EXTRA,
    },
    stdio: "ignore",
  });
  const navegador = await chromium.launch();
  try {
    await esperarServidor();
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
    await contexto.addCookies([{ ...cookieDeSesion(), url: BASE }]);
    const pagina = await contexto.newPage();
    const errores = [];
    pagina.on("pageerror", (e) => errores.push(String(e)));
    pagina.on("console", (m) => m.type() === "error" && errores.push(m.text()));
    const captura = (nombre, p = pagina) => p.screenshot({ path: path.join(capturas, nombre + ".png"), fullPage: true });

    console.log("Proyectos");
    await pagina.goto(BASE + "/proyectos");
    await pagina.getByText("Todavía no hay proyectos").waitFor();
    ok("estado vacío de proyectos");
    await pagina.getByRole("button", { name: "Áreas" }).click();
    await pagina.getByLabel("Nueva área").fill("Casa");
    await pagina.getByRole("button", { name: "Agregar" }).click();
    await pagina.getByLabel("Nombre del área").waitFor();
    await pagina.getByRole("button", { name: "Cerrar" }).click();
    afirmar((await estado()).areas.length === 1, "área creada en la base");

    await pagina.getByRole("button", { name: "Nuevo" }).click();
    await pagina.getByLabel("Nombre", { exact: true }).fill("Reformar el baño");
    await pagina.getByLabel("Objetivo", { exact: true }).fill("Baño terminado y funcionando antes de las fiestas");
    await pagina.getByLabel("Área", { exact: true }).selectOption({ label: "Casa" });
    await pagina.getByRole("button", { name: "Crear proyecto" }).click();
    await pagina.waitForURL(/\/proyectos\/[0-9a-f-]{36}$/);
    await pagina.getByLabel("Nombre del proyecto").waitFor();
    ok("proyecto creado y abre su ficha");

    console.log("Ficha de proyecto");
    const alta = pagina.getByLabel("Nueva tarea", { exact: true });
    await alta.fill("Elegir azulejos mañana p1");
    await pagina.getByText("Vence mañana · Prioridad P1").waitFor();
    await alta.press("Enter");
    await alta.fill("Pedir presupuesto al plomero");
    await alta.press("Enter");
    await alta.fill("Comprar grifería");
    await alta.press("Enter");
    await pagina.getByRole("button", { name: "Elegir azulejos" }).waitFor();
    let e = await estado();
    const azulejos = e.tasks.find((t) => t.title === "Elegir azulejos");
    afirmar(azulejos?.due_date === fechaMvd(1) && azulejos.priority === 1 && azulejos.due_set_by === "usuario",
      "alta en una línea: lee «mañana» y «p1»");
    afirmar(e.tasks.length === 3, "tres tareas en la base");

    await pagina.getByRole("button", { name: "Elegir azulejos" }).click();
    const sub = pagina.getByLabel("Nueva subtarea");
    await sub.fill("Medir las paredes");
    await sub.press("Enter");
    await sub.fill("Ir a la barraca");
    await sub.press("Enter");
    await pagina.getByRole("dialog").getByRole("checkbox", { name: /Medir las paredes/ }).click();
    await pagina.getByText("Subtareas · 1/2").waitFor();
    await pagina.getByLabel("Notas").fill("Blancos de 30x60, mate.");
    await pagina.getByRole("dialog").getByLabel("Estado", { exact: true }).selectOption("bloqueada");
    await pagina.getByLabel("¿Qué la traba?").fill("Falta definir el color con Ana");
    await pagina.getByLabel("¿Qué la traba?").blur();
    await captura("01-detalle-tarea");
    await pagina.getByRole("button", { name: "Cerrar" }).click();
    e = await estado();
    const t1 = e.tasks.find((t) => t.title === "Elegir azulejos");
    afirmar(e.tasks.filter((t) => t.parent_id === t1.id).length === 2, "subtareas creadas bajo la tarea");
    afirmar(e.tasks.find((t) => t.title === "Medir las paredes").completed_at, "subtarea marcada como hecha");
    afirmar(t1.status === "bloqueada" && t1.blocked_reason === "Falta definir el color con Ana" && t1.description === "Blancos de 30x60, mate.",
      "estado, motivo de bloqueo y notas guardados");

    await pagina.getByLabel("Nueva entrada de bitácora").fill("Decidimos no mover la bañera.");
    await pagina.getByLabel("Tipo de entrada").selectOption("decision");
    await pagina.getByRole("button", { name: "Anotar" }).click();
    await pagina.getByText("Decidimos no mover la bañera.").waitFor();
    afirmar((await estado()).project_log[0]?.kind === "decision", "entrada de bitácora guardada");
    await pagina.getByLabel("Descripción y contexto").fill("Presupuesto máximo: 80.000.");
    await pagina.getByLabel("Descripción y contexto").blur();
    await captura("02-ficha-proyecto");
    await pagina.reload();
    await pagina.getByText("Decidimos no mover la bañera.").waitFor();
    afirmar((await pagina.getByLabel("Descripción y contexto").inputValue()) === "Presupuesto máximo: 80.000.",
      "la ficha conserva los cambios al recargar");

    console.log("Hoy");
    const proyectoId = (await estado()).projects[0].id;
    await sembrar("tasks", { id: "aaaaaaaa-0000-4000-8000-000000000001", project_id: proyectoId, parent_id: null, title: "Pagar la seña", due_date: fechaMvd(-2), sort_order: 1 });
    await sembrar("tasks", { id: "aaaaaaaa-0000-4000-8000-000000000002", project_id: proyectoId, parent_id: null, title: "Retirar materiales", due_date: fechaMvd(0), sort_order: 2 });
    await pagina.goto(BASE + "/hoy");
    await pagina.getByRole("heading", { name: /Vencidas/ }).waitFor();
    await pagina.getByText("Venció hace", { exact: false }).or(pagina.getByText(/Venció/)).first().waitFor();
    ok("lo vencido aparece arriba, marcado");
    const altaHoy = pagina.getByLabel("Nueva tarea", { exact: true });
    await altaHoy.fill("Llamar al electricista");
    await altaHoy.press("Enter");
    await pagina.getByRole("button", { name: "Llamar al electricista" }).waitFor();
    afirmar((await estado()).tasks.find((t) => t.title === "Llamar al electricista").due_date === fechaMvd(0),
      "una tarea cargada en Hoy queda con fecha de hoy");
    await pagina.getByRole("checkbox", { name: /Marcar «Retirar materiales» como hecha/ }).click();
    await pagina.getByRole("heading", { name: /Hechas hoy/ }).waitFor();
    afirmar((await estado()).tasks.find((t) => t.title === "Retirar materiales").status === "hecha", "marcar como hecha desde la lista");
    await captura("03-hoy");
    await pagina.getByRole("tab", { name: "Esta semana" }).click();
    await captura("04-semana");
    ok("vista de la semana");

    console.log("Tablero");
    await pagina.goto(BASE + "/tablero");
    const tarjeta = pagina.getByRole("button", { name: /Pedir presupuesto al plomero/ });
    await tarjeta.waitFor();
    const destino = pagina.getByRole("region", { name: "En curso" }).getByRole("list");
    const a = await tarjeta.boundingBox();
    const b = await destino.boundingBox();
    await pagina.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await pagina.mouse.down();
    await pagina.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 5, { steps: 4 });
    await pagina.mouse.move(b.x + b.width / 2, b.y + 40, { steps: 12 });
    await pagina.mouse.up();
    await pagina.getByRole("region", { name: "En curso" }).getByText("Pedir presupuesto al plomero").waitFor();
    afirmar((await estado()).tasks.find((t) => t.title === "Pedir presupuesto al plomero").status === "en_curso",
      "arrastrar una tarjeta a otra columna cambia el estado");

    // Reordenar dentro de Pendiente: la última sube al primer lugar.
    const pendientes = pagina.getByRole("region", { name: "Pendiente" });
    const titulos = async () => (await pendientes.getByRole("listitem").allInnerTexts()).map((x) => x.split("\n")[0]);
    const antes = await titulos();
    const ultima = pendientes.getByRole("listitem").last();
    const primera = pendientes.getByRole("listitem").first();
    const u = await ultima.boundingBox();
    const p = await primera.boundingBox();
    await pagina.mouse.move(u.x + u.width / 2, u.y + u.height / 2);
    await pagina.mouse.down();
    await pagina.mouse.move(u.x + u.width / 2, u.y + u.height / 2 - 15, { steps: 4 });
    await pagina.mouse.move(p.x + p.width / 2, p.y + 4, { steps: 12 });
    await pagina.mouse.up();
    await pagina.waitForTimeout(400);
    const despues = await titulos();
    afirmar(antes.length >= 2 && despues[0] === antes[antes.length - 1], `reordenar dentro de la columna (${antes.join(" | ")} → ${despues.join(" | ")})`);
    await pagina.reload();
    await pendientes.getByRole("listitem").first().waitFor();
    afirmar((await titulos())[0] === despues[0], "el orden nuevo sobrevive a recargar");

    // Con teclado: Espacio levanta, flecha derecha cambia de columna, Espacio suelta.
    const conTeclado = pagina.getByRole("button", { name: /Pagar la seña/ });
    await conTeclado.focus();
    await pagina.keyboard.press("Space");
    await pagina.waitForTimeout(150);
    await pagina.keyboard.press("ArrowRight");
    await pagina.waitForTimeout(150);
    await pagina.keyboard.press("Space");
    await pagina.waitForTimeout(400);
    const tecla = (await estado()).tasks.find((t) => t.title === "Pagar la seña").status;
    afirmar(tecla !== "pendiente", `mover una tarjeta con el teclado (quedó «${tecla}»)`);
    await captura("05-tablero");

    console.log("Calendario");
    await pagina.goto(BASE + "/calendario");
    await pagina.getByRole("button", { name: /tarea/ }).first().waitFor();
    await captura("06-calendario");
    const manana = fechaMvd(1);
    const pasado = fechaMvd(3);
    if (manana.slice(0, 7) === pasado.slice(0, 7) && manana.slice(0, 7) === fechaMvd(0).slice(0, 7)) {
      const ficha = pagina.locator("span[role=presentation]", { hasText: "Elegir azulejos" });
      const celdas = pagina.locator("div.grid.grid-cols-7 > div");
      const todas = await celdas.count();
      // La celda de destino se busca por su etiqueta accesible (día del mes).
      let destinoCelda = null;
      for (let i = 0; i < todas; i++) {
        const etiqueta = await celdas.nth(i).getByRole("button").first().getAttribute("aria-label");
        if (etiqueta && new RegExp(` ${Number(pasado.slice(8))} de `).test(etiqueta) && (await celdas.nth(i).locator("span").first().getAttribute("class")).includes("text-texto-2")) {
          destinoCelda = celdas.nth(i);
          break;
        }
      }
      const f = await ficha.boundingBox();
      const c = await destinoCelda.boundingBox();
      await pagina.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
      await pagina.mouse.down();
      await pagina.mouse.move(f.x + f.width / 2 + 10, f.y + f.height / 2 + 10, { steps: 4 });
      await pagina.mouse.move(c.x + c.width / 2, c.y + c.height - 12, { steps: 12 });
      await pagina.mouse.up();
      await pagina.waitForTimeout(400);
      afirmar((await estado()).tasks.find((t) => t.title === "Elegir azulejos").due_date === pasado,
        "arrastrar una tarea a otro día cambia la fecha límite");
    } else {
      console.log("  – arrastre entre días omitido (fin de mes)");
    }
    await pagina.getByLabel("Nueva tarea", { exact: true }).fill("Barrer el patio");
    await pagina.getByLabel("Nueva tarea", { exact: true }).press("Enter");
    await pagina.getByRole("button", { name: "Barrer el patio" }).waitFor();
    ok("alta de tarea en el día elegido");

    console.log("Filtro, archivar y borrar");
    await pagina.goto(BASE + "/proyectos");
    await pagina.getByRole("button", { name: "Nuevo" }).click();
    await pagina.getByLabel("Nombre", { exact: true }).fill("Correr 10 km");
    await pagina.getByRole("button", { name: "Crear proyecto" }).click();
    await pagina.waitForURL(/\/proyectos\/[0-9a-f-]{36}$/);
    await pagina.getByLabel("Nueva tarea", { exact: true }).fill("Salir a trotar hoy");
    await pagina.getByLabel("Nueva tarea", { exact: true }).press("Enter");
    await pagina.getByRole("button", { name: "Salir a trotar" }).waitFor();
    await pagina.goto(BASE + "/hoy");
    await pagina.getByRole("button", { name: "Salir a trotar" }).waitFor();
    await pagina.getByLabel("Filtrar por proyecto").selectOption({ label: "Reformar el baño" });
    await pagina.getByRole("button", { name: "Salir a trotar" }).waitFor({ state: "detached" });
    ok("el filtro por proyecto esconde lo de otros proyectos");
    await pagina.goto(BASE + "/tablero");
    await pagina.getByRole("button", { name: /Comprar grifería/ }).waitFor();
    afirmar((await pagina.getByRole("button", { name: /Salir a trotar/ }).count()) === 0, "el filtro se recuerda entre vistas");
    await pagina.getByRole("button", { name: "Quitar" }).click();
    await pagina.getByRole("button", { name: /Salir a trotar/ }).click();
    await pagina.getByRole("button", { name: "Archivar" }).click();
    await pagina.getByText("Tarea archivada.").waitFor();
    afirmar((await estado()).tasks.find((t) => t.title === "Salir a trotar").archived_at, "archivar no borra: marca archived_at");
    await pagina.getByRole("button", { name: "Deshacer" }).click();
    await pagina.getByRole("button", { name: /Salir a trotar/ }).waitFor();
    afirmar(!(await estado()).tasks.find((t) => t.title === "Salir a trotar").archived_at, "deshacer el archivado");
    await pagina.getByRole("button", { name: /Salir a trotar/ }).click();
    await pagina.getByRole("button", { name: "Borrar", exact: true }).click();
    await pagina.getByRole("button", { name: "Sí, borrar" }).click();
    await pagina.waitForTimeout(300);
    afirmar(!(await estado()).tasks.some((t) => t.title === "Salir a trotar"), "borrar para siempre pide confirmación y borra");

    console.log("Agente por chat");
    e = await estado();
    const griferia = e.tasks.find((t) => t.title === "Comprar grifería");
    const electricista = e.tasks.find((t) => t.title === "Llamar al electricista");
    await guion([
      { proveedor: "gemini", llamadas: [
        { nombre: "actualizar_tarea", argumentos: { tarea_id: corto(griferia.id), estado: "hecha" } },
        { nombre: "actualizar_tarea", argumentos: { tarea_id: corto(electricista.id), estado: "bloqueada", motivo_bloqueo: "Espera una respuesta" } },
      ] },
      { proveedor: "gemini", texto: "Listo: grifería hecha y lo del electricista queda trabado hasta que te contesten. ¿Cuándo le volvés a escribir?" },
    ]);
    await pagina.goto(BASE + "/chat");
    const mensaje = pagina.getByLabel("Mensaje para el Agente");
    await mensaje.fill("Terminé de comprar la grifería y lo del electricista está trabado porque espero una respuesta");
    await mensaje.press("Enter");
    await pagina.getByText("¿Cuándo le volvés a escribir?").waitFor();
    await pagina.getByText("«Comprar grifería»: hecha").waitFor();
    await pagina.getByText("«Llamar al electricista»: bloqueada, trabada por: Espera una respuesta").waitFor();
    e = await estado();
    afirmar(e.tasks.find((t) => t.id === griferia.id).status === "hecha" && e.tasks.find((t) => t.id === electricista.id).blocked_reason === "Espera una respuesta",
      "«terminé X y Z está trabado»: el Agente actualiza las dos tareas");
    afirmar(e.change_log.length === 2 && e.change_log[0].old_values.status === "pendiente", "cada cambio queda registrado con el valor anterior");
    const enviado = (await pedidosAlModelo())[0];
    afirmar(enviado.cuerpo.systemInstruction.parts[0].text.includes(`[${corto(griferia.id)}] Comprar grifería`) && !JSON.stringify(enviado.cuerpo).includes(griferia.id),
      "el modelo recibe el resumen del panel con ids cortos");
    await captura("12-chat");
    await pagina.getByRole("button", { name: "Deshacer" }).first().click();
    await pagina.getByText("Deshecho").waitFor();
    afirmar((await estado()).tasks.find((t) => t.id === griferia.id).status === "pendiente", "Deshacer devuelve la tarea a como estaba");

    await guion([{ proveedor: "gemini", estado: 429 }, { proveedor: "groq", texto: "Sigo yo. ¿Qué más quedó pendiente?" }]);
    await mensaje.fill("¿Y ahora qué hago?");
    await mensaje.press("Enter");
    await pagina.getByText("Sigo yo. ¿Qué más quedó pendiente?").waitFor();
    await pagina.getByText("Gemini llegó a su límite; sigue el siguiente.").waitFor();
    ok("si Gemini devuelve 429, responde Groq sin cortar la conversación");
    await pagina.goto(BASE + "/tablero");
    await pagina.getByRole("region", { name: "Bloqueada" }).getByText("Llamar al electricista").waitFor();
    ok("los cambios del Agente se ven en el Tablero");

    await guion([{ siSistema: "archiva una sesión", texto: JSON.stringify({
      resumen: "Dejaste trabado lo del electricista y quedaste en volver a escribirle el jueves.",
      compromisos: [{ texto: "Escribirle al electricista", fecha: fechaMvd(2) }],
      memorias: [{ categoria: "obstaculo_recurrente", contenido: "Se le traban las tareas que dependen de la respuesta de otra persona.", memoria_id: null }],
      bitacora: [{ proyecto_id: corto(proyectoId), texto: "El electricista todavía no contestó." }],
    }) }]);
    await pagina.goto(BASE + "/chat");
    await pagina.getByText("Sigo yo. ¿Qué más quedó pendiente?").waitFor();
    ok("al volver al chat sigue la misma conversación");
    await pagina.getByRole("button", { name: "Terminar" }).click();
    await pagina.waitForURL(/\/sesiones\/[0-9a-f-]{36}$/);
    await pagina.getByText("Dejaste trabado lo del electricista").waitFor();
    await pagina.getByText("Escribirle al electricista").waitFor();
    await pagina.getByText("Deshecho").waitFor();
    await captura("13-resumen-sesion");
    e = await estado();
    afirmar(e.sessions[0].status === "completada" && e.sessions[0].providers_used.join() === "gemini,groq", "la sesión se cierra y guarda qué proveedores respondieron");
    afirmar(e.memories.length === 1 && e.project_log.some((x) => x.kind === "resumen_llamada"), "al cerrar quedan la memoria nueva y el resumen en la bitácora del proyecto");

    await pagina.goto(BASE + "/configuracion");
    await pagina.getByText("Cerebro del Agente").waitFor();
    await pagina.getByRole("button", { name: "Subir Groq" }).click();
    await pagina.waitForTimeout(300);
    afirmar((await estado()).profiles[0].agent_config.orden_proveedores[0] === "groq", "el orden de proveedores se guarda en el perfil");
    await pagina.getByRole("button", { name: "Bajar Groq" }).click();
    await pagina.goto(BASE + "/configurar");
    await pagina.getByText("Gemini (cerebro principal del Agente)").waitFor();
    afirmar((await pagina.getByText("Pendiente", { exact: true }).count()) > 0 && (await pagina.getByText("Configurada", { exact: true }).count()) >= 3,
      "/configurar lista cada integración como configurada o pendiente");
    afirmar(!(await pagina.content()).includes("clave-falsa"), "/configurar no muestra ningún valor");

    console.log("Celular (390 px)");
    const movil = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await movil.addCookies([{ ...cookieDeSesion(), url: BASE }]);
    const pm = await movil.newPage();
    pm.on("pageerror", (x) => errores.push("móvil: " + String(x)));
    for (const [ruta, nombre] of [["/hoy", "07-movil-hoy"], ["/tablero", "08-movil-tablero"], ["/calendario", "09-movil-calendario"], ["/proyectos", "10-movil-proyectos"]]) {
      await pm.goto(BASE + ruta);
      await pm.waitForLoadState("networkidle");
      const desborde = await pm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      afirmar(desborde <= 0, `${ruta} no se desborda de costado en el celular`);
      await pm.screenshot({ path: path.join(capturas, nombre + ".png") });
    }
    await pm.goto(BASE + "/proyectos/" + proyectoId);
    await pm.getByRole("button", { name: "Comprar grifería" }).click();
    await pm.getByLabel("Título").waitFor();
    await pm.screenshot({ path: path.join(capturas, "11-movil-detalle.png") });
    ok("el detalle de tarea abre en el celular");

    const reales = errores.filter((x) => !/favicon|sw\.js|Failed to load resource/.test(x));
    afirmar(reales.length === 0, "sin errores de JavaScript en la consola" + (reales.length ? ": " + reales.join(" | ") : ""));
    console.log(`\n${hechos.length} comprobaciones pasaron. Capturas en ${capturas}`);
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
