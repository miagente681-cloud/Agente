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
const editar = (tabla, id, cambios) => fetch(`${FALSO}/__editar`, { method: "POST", body: JSON.stringify({ tabla, id, cambios }) });
const corto = (id) => id.slice(0, 8);
// El prompt de sistema de un pedido, sea cual sea el proveedor que lo recibió
// (después de un 429, Gemini queda en pausa un par de minutos y responde Groq).
const sistemaDe = (pedido) =>
  pedido.cuerpo.systemInstruction?.parts[0].text ?? pedido.cuerpo.messages.find((m) => m.role === "system").content;
const fechaMvd = (dias = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(Date.now() + dias * 86_400_000);

/** Variables que agregan las fases siguientes. */
const ENTORNO_EXTRA = {
  // Azure de mentira: solo el emisor de tokens. Con la clave de servicio para el contador.
  AZURE_SPEECH_KEY: "falsa",
  AZURE_SPEECH_REGION: "brazilsouth",
  AZURE_SPEECH_TOKEN_URL: MODELOS,
  SUPABASE_SERVICE_ROLE_KEY: "servicio-falsa",
  CRON_SECRET: "secreto-de-prueba",
  CLAUDE_USUARIOS_PERMITIDOS: "prueba@ejemplo.com",
};
const tick = (secreto) =>
  fetch(`${BASE}/api/cron/tick`, { method: "POST", headers: secreto ? { Authorization: `Bearer ${secreto}` } : {} });

/**
 * Proveedor de voz de mentira que se inyecta en la página: anota lo que el
 * Agente "dice" y deja simular lo que dice la persona y el volumen del micrófono.
 */
function instalarVozDePrueba() {
  const v = {
    id: "prueba", dicho: [], escuchando: false, callado: 0, volumen: 0, alTexto: null, soltar: null,
    async escuchar(al) { v.alTexto = al; v.escuchando = true; },
    async pausar() { v.escuchando = false; },
    hablar(texto) {
      v.dicho.push(texto);
      // Cada frase "suena" medio segundo, salvo que la callen.
      return new Promise((listo) => {
        const reloj = setTimeout(() => { v.soltar = null; listo(); }, v.lento ? 60000 : 500);
        v.soltar = () => { clearTimeout(reloj); v.soltar = null; listo(); };
      });
    },
    callar() { v.callado++; v.soltar?.(); },
    cerrar() { v.escuchando = false; v.soltar?.(); },
    segundosNuevos() { return 12; },
    nivel() { return v.volumen; },
    decir(texto) { v.alTexto?.(texto, true); },
  };
  window.__vozDePrueba = v;
}

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
    afirmar((await estado()).profiles[0].agent_config.orden_proveedores.join() === "claude,groq,gemini,ollama", "el orden de proveedores se guarda en el perfil");
    await pagina.getByRole("button", { name: "Bajar Groq" }).click();
    await pagina.goto(BASE + "/configurar");
    await pagina.getByText("Gemini (cerebro gratuito)").waitFor();
    afirmar((await pagina.getByText("Pendiente", { exact: true }).count()) > 0 && (await pagina.getByText("Configurada", { exact: true }).count()) >= 3,
      "/configurar lista cada integración como configurada o pendiente");
    afirmar(!(await pagina.content()).includes("clave-falsa"), "/configurar no muestra ningún valor");

    console.log("Memoria y entrevista inicial");
    await editar("profiles", null, { onboarding_done: false });
    await guion([
      { texto: "Hola, soy tu Agente. Para empezar: ¿cuáles son las áreas de tu vida que querés ordenar?" },
      { llamadas: [
        { nombre: "crear_area", argumentos: { nombre: "Salud" } },
        { nombre: "crear_proyecto", argumentos: { nombre: "Correr 10 km", objetivo: "Correr 10 km sin parar antes de marzo" } },
        { nombre: "guardar_memoria", argumentos: { categoria: "rutina", contenido: "Rinde mejor a la mañana temprano." } },
      ] },
      { texto: "Te armé el área Salud y el proyecto de correr. ¿Qué suele frenarte?" },
    ]);
    await pagina.goto(BASE + "/bienvenida");
    await pagina.getByRole("heading", { name: "La entrevista inicial" }).waitFor();
    await captura("14-bienvenida");
    await pagina.getByRole("link", { name: "Hacerla por escrito" }).click();
    await pagina.getByText("¿cuáles son las áreas de tu vida").waitFor();
    ok("en la entrevista inicial el Agente abre la conversación");
    afirmar(sistemaDe((await pedidosAlModelo()).at(-1)).includes("ENTREVISTA INICIAL"), "el modelo recibe el guion de la entrevista");
    await pagina.getByLabel("Mensaje para el Agente").fill("Salud: quiero correr 10 km. Rindo mejor a la mañana.");
    await pagina.getByLabel("Mensaje para el Agente").press("Enter");
    await pagina.getByText("¿Qué suele frenarte?").waitFor();
    await pagina.getByText("Nuevo proyecto: «Correr 10 km»").waitFor();
    e = await estado();
    afirmar(e.areas.some((a) => a.name === "Salud") && e.projects.some((p) => p.name === "Correr 10 km") && e.memories.some((m) => m.content.includes("mañana temprano")),
      "la entrevista deja áreas, proyectos y memorias cargadas");
    await guion([{ siSistema: "archiva una sesión", texto: JSON.stringify({
      resumen: "Armamos el área Salud y el proyecto de correr 10 km.",
      compromisos: [{ texto: "Salir a correr el sábado", fecha: null }],
      memorias: [{ categoria: "objetivo", contenido: "Quiere correr 10 km sin parar.", memoria_id: null }],
      bitacora: [],
    }) }]);
    await pagina.getByRole("button", { name: "Terminar" }).click();
    await pagina.waitForURL(/\/sesiones\/[0-9a-f-]{36}$/);
    await pagina.getByText("Armamos el área Salud").waitFor();
    e = await estado();
    afirmar(e.profiles[0].onboarding_done === true && e.sessions.some((x) => x.kind === "onboarding" && x.status === "completada"),
      "al terminar la entrevista el perfil queda marcado como hecho");

    await pagina.goto(BASE + "/memoria");
    await pagina.getByText("Rinde mejor a la mañana temprano.").waitFor();
    await pagina.getByText("Quiere correr 10 km sin parar.").waitFor();
    await pagina.getByRole("link", { name: "ver la sesión de donde salió" }).first().waitFor();
    await captura("15-memoria");
    await pagina.getByRole("button", { name: "Editar: Rinde mejor a la mañana temprano." }).click();
    await pagina.getByLabel("Texto de la memoria").fill("Rinde mejor de 7 a 10 de la mañana.");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.getByText("La escribiste o corregiste vos").waitFor();
    e = await estado();
    afirmar(e.memories.find((m) => m.content === "Rinde mejor de 7 a 10 de la mañana.")?.edited_by_user === true, "editar una memoria la marca como tuya (el Agente no la pisa)");
    const antesDeBorrar = e.memories.length;
    await pagina.getByRole("button", { name: /^Borrar: Se le traban/ }).click();
    await pagina.waitForTimeout(300);
    afirmar((await estado()).memories.length === antesDeBorrar - 1, "borrar una memoria");

    await guion([{ texto: "La vez pasada quedaste en salir a correr el sábado. ¿Saliste?" }]);
    await pagina.goto(BASE + "/chat");
    await pagina.getByLabel("Mensaje para el Agente").fill("Hola");
    await pagina.getByLabel("Mensaje para el Agente").press("Enter");
    await pagina.getByText("¿Saliste?").waitFor();
    const sistemaNuevo = sistemaDe((await pedidosAlModelo()).at(-1));
    afirmar(sistemaNuevo.includes("Rinde mejor de 7 a 10 de la mañana.") && sistemaNuevo.includes("Compromisos: Salir a correr el sábado"),
      "en la sesión siguiente el modelo recibe las memorias (ya corregidas) y los compromisos anteriores");

    console.log("Llamada de voz (proveedor de voz de mentira)");
    const token = await pagina.evaluate(() => fetch("/api/voice/token", { method: "POST" }).then((r) => r.json()));
    afirmar(token.azure === true && token.token === "token-de-mentira" && token.voz === "es-UY-MateoNeural" && !JSON.stringify(token).includes("falsa"),
      "el servidor entrega un token corto de Azure y nunca la clave");
    const llamada = await (await sembrar("sessions", { kind: "llamada_programada", channel: "voz", status: "notificada", scheduled_at: new Date().toISOString(), notified_at: new Date().toISOString(), focus: "Repaso breve del día", target_minutes: 5 })).json();
    e = await estado();
    const paraLlamada = e.tasks.find((t) => t.title === "Barrer el patio");
    await guion([
      { texto: "Hola. La vez pasada quedaste en salir a correr el sábado. ¿Saliste?" },
      { llamadas: [{ nombre: "actualizar_tarea", argumentos: { tarea_id: corto(paraLlamada.id), fecha_limite: fechaMvd(2) } }] },
      { texto: "Te dejo lo del patio para pasado mañana. Ahora contame con calma cómo viene todo lo demás, porque quiero repasar tarea por tarea y eso lleva un rato largo de conversación entre los dos." },
      { texto: "Dale, te escucho." },
    ]);
    const conVoz = await contexto.newPage();
    await conVoz.addInitScript(instalarVozDePrueba);
    conVoz.on("pageerror", (x) => errores.push("llamada: " + String(x)));
    await conVoz.goto(`${BASE}/llamada/${llamada.id}`);
    await conVoz.getByText("Tu Agente te está llamando").waitFor();
    await conVoz.getByText("Repaso breve del día").waitFor();
    await conVoz.getByRole("button", { name: "Atender" }).click();
    await conVoz.getByText("¿Saliste?").waitFor();
    await conVoz.getByText("Te escucho").waitFor();
    afirmar((await conVoz.evaluate(() => window.__vozDePrueba.dicho.join(" | "))) === "Hola. La vez pasada quedaste en salir a correr el sábado. | ¿Saliste?",
      "al atender, el Agente abre la llamada y habla por oraciones");
    afirmar(sistemaDe((await pedidosAlModelo()).at(-1)).includes("LLAMADA PROGRAMADA") && (await estado()).sessions.find((x) => x.id === llamada.id).status === "en_curso",
      "la llamada pasa a «en curso» y el modelo recibe el guion de voz con el foco");
    await captura("16-llamada", conVoz);

    await conVoz.evaluate(() => { window.__vozDePrueba.lento = true; window.__vozDePrueba.decir("Sí, salí. Lo del patio no llegué."); });
    await conVoz.getByText("«Barrer el patio»: fecha límite →").waitFor();
    await conVoz.getByText("Hablando").waitFor();
    afirmar((await estado()).tasks.find((t) => t.id === paraLlamada.id).due_set_by === "agente", "lo que digo en la llamada actualiza el panel (fecha puesta por el Agente)");
    // Hablar encima: el volumen del micrófono sube y se sostiene.
    await conVoz.evaluate(() => { window.__vozDePrueba.volumen = 0.4; });
    await conVoz.getByText("Te escucho").waitFor();
    const trasInterrumpir = await conVoz.evaluate(() => ({ callado: window.__vozDePrueba.callado, escuchando: window.__vozDePrueba.escuchando, dicho: window.__vozDePrueba.dicho.length }));
    afirmar(trasInterrumpir.callado >= 1 && trasInterrumpir.escuchando && trasInterrumpir.dicho === 3, "si hablo encima, el Agente corta y vuelve a escuchar");
    await conVoz.evaluate(() => { window.__vozDePrueba.volumen = 0; window.__vozDePrueba.lento = false; });
    await conVoz.getByRole("button", { name: "Silenciar" }).click();
    await conVoz.getByText("Micrófono silenciado").waitFor();
    await conVoz.evaluate(() => window.__vozDePrueba.decir("esto no se envía"));
    await conVoz.getByRole("button", { name: "Activar" }).click();
    await conVoz.evaluate(() => window.__vozDePrueba.decir("Listo, eso es todo."));
    await conVoz.getByText("Dale, te escucho.").waitFor();
    afirmar(!(await conVoz.getByText("esto no se envía").count()), "con el micrófono silenciado no se envía nada");

    await guion([{ siSistema: "archiva una sesión", texto: JSON.stringify({
      resumen: "Repasamos el día y quedó el patio para pasado mañana.",
      compromisos: [{ texto: "Barrer el patio", fecha: fechaMvd(2) }], memorias: [],
      bitacora: [{ proyecto_id: corto(proyectoId), texto: "Se movió lo del patio." }],
    }) }]);
    await conVoz.getByRole("button", { name: "Cortar" }).click();
    await conVoz.waitForURL(/\/sesiones\/[0-9a-f-]{36}$/);
    await conVoz.getByText("Repasamos el día y quedó el patio").waitFor();
    await conVoz.getByText("«Barrer el patio»: fecha límite →").waitFor();
    e = await estado();
    afirmar(e.sessions.find((x) => x.id === llamada.id).status === "completada" && e.project_log.some((x) => x.content === "Se movió lo del patio."),
      "al cortar veo el resumen, los cambios aplicados y la bitácora actualizada");
    afirmar(e.voice_usage[0]?.stt_seconds >= 12, "los segundos de escucha se suman al contador del mes");

    // Pasar a texto sin perder el hilo.
    const otra = await (await sembrar("sessions", { kind: "llamada_programada", channel: "voz", status: "notificada", scheduled_at: new Date().toISOString(), notified_at: new Date().toISOString() })).json();
    await guion([{ texto: "Hola de nuevo. ¿Cómo venís?" }, { texto: "Seguimos por acá entonces." }]);
    await conVoz.goto(`${BASE}/llamada/${otra.id}`);
    await conVoz.getByRole("button", { name: "Atender" }).click();
    await conVoz.getByText("¿Cómo venís?").waitFor();
    await conVoz.getByRole("button", { name: "A texto" }).click();
    await conVoz.waitForURL(/\/chat\?sesion=/);
    await conVoz.getByText("Hola de nuevo. ¿Cómo venís?").waitFor();
    await conVoz.getByLabel("Mensaje para el Agente").fill("Sigo por escrito");
    await conVoz.getByLabel("Mensaje para el Agente").press("Enter");
    await conVoz.getByText("Seguimos por acá entonces.").waitFor();
    ok("pasar la llamada a texto conserva la conversación");
    await fetch(`${FALSO}/__editar`, { method: "POST", body: JSON.stringify({ tabla: "sessions", id: otra.id, cambios: { status: "completada" } }) });

    // Chat de voz iniciado por la persona, sin micrófono: escribe y el Agente habla.
    await guion([{ texto: "Anotado. ¿Algo más?" }]);
    await conVoz.goto(BASE + "/chat");
    await conVoz.getByRole("button", { name: "Hablar" }).click();
    await conVoz.waitForURL(/\/llamada\/[0-9a-f-]{36}$/);
    // Si había una charla abierta, la sigue por voz; si no, crea un chat de voz nuevo.
    await conVoz.getByRole("button", { name: /Sin micrófono/ }).click();
    await conVoz.getByText("Escribí abajo").waitFor();
    afirmar((await conVoz.evaluate(() => window.__vozDePrueba.escuchando)) === false, "chat de voz sin micrófono: no intenta escuchar");
    const dichoAntes = await conVoz.evaluate(() => window.__vozDePrueba.dicho.length);
    await conVoz.getByLabel("Escribirle al Agente").fill("Anotame comprar pintura");
    await conVoz.getByLabel("Escribirle al Agente").press("Enter");
    await conVoz.getByText("Anotado. ¿Algo más?").waitFor();
    afirmar((await conVoz.evaluate(() => window.__vozDePrueba.dicho.length)) === dichoAntes + 1, "escribo en el chat de voz y el Agente responde hablando");
    await conVoz.getByRole("button", { name: "Usar micrófono" }).click();
    await conVoz.getByText("Te escucho").waitFor();
    afirmar(await conVoz.evaluate(() => window.__vozDePrueba.escuchando), "el micrófono se puede activar después, sin cortar");
    e = await estado();
    const deVoz = e.sessions.find((x) => x.id === conVoz.url().split("/").pop());
    afirmar(deVoz?.kind === "chat" && sistemaDe((await pedidosAlModelo()).at(-1)).includes("conversación de VOZ"), "el chat de voz lo puedo iniciar yo, y el modelo responde en formato de voz");
    await editar("sessions", deVoz.id, { status: "completada" });

    // Sin cupo de Azure el servidor deja de entregar tokens.
    await fetch(`${FALSO}/rest/v1/rpc/sumar_uso_voz`, { method: "POST", body: JSON.stringify({ p_user: "11111111-1111-1111-1111-111111111111", p_stt: 18000, p_tts: 0 }) });
    const sinCupo = await conVoz.evaluate(() => fetch("/api/voice/token", { method: "POST" }).then((r) => r.json()));
    afirmar(sinCupo.azure === false && sinCupo.motivo === "agotado", "con el cupo agotado el servidor no entrega más tokens de Azure");
    await conVoz.goto(BASE + "/configuracion");
    await conVoz.getByText("Cupo agotado").waitFor();
    ok("la configuración muestra el uso del mes y el aviso de cupo");
    await conVoz.close();

    console.log("Llamadas programadas");
    await pagina.goto(BASE + "/configuracion");
    await pagina.getByRole("button", { name: "Agregar rutina" }).click();
    await pagina.getByLabel("Nombre de la rutina").waitFor();
    await pagina.getByRole("button", { name: "Sábado" }).click();
    await pagina.getByLabel("Foco de la llamada").fill("Revisión completa de todos los proyectos");
    await pagina.getByLabel("Foco de la llamada").blur();
    await pagina.getByRole("button", { name: "Agregar franja" }).click();
    await pagina.getByLabel("Margen para atender (min)").fill("15");
    await pagina.getByLabel("Margen para atender (min)").blur();
    await pagina.waitForTimeout(400);
    e = await estado();
    afirmar(e.call_routines.length === 1 && e.call_routines[0].weekdays.includes(6) && e.call_routines[0].focus === "Revisión completa de todos los proyectos",
      "crear y editar una rutina de llamada (días, foco)");
    afirmar(e.availability_windows.length === 1 && e.profiles[0].agent_config.margen_minutos === 15, "franja de disponibilidad y margen guardados");
    await pagina.getByText("Faltan las claves de notificaciones en el servidor").waitFor();
    ok("sin claves VAPID la pantalla avisa que falta configurar, sin romperse");
    await captura("17-config-llamadas");
    await pagina.getByRole("button", { name: /Borrar la rutina/ }).click();
    await pagina.getByRole("button", { name: "Borrar esta franja" }).click();
    await pagina.getByLabel("Margen para atender (min)").fill("10");
    await pagina.getByLabel("Margen para atender (min)").blur();
    await pagina.waitForTimeout(300);

    afirmar((await tick()).status === 401 && (await tick("otro-secreto")).status === 401, "el programador rechaza pedidos sin el secreto correcto");
    // Una rutina para hoy, a esta misma hora (en la zona del perfil).
    const ahoraMvd = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Montevideo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    const diaMvd = new Date(fechaMvd(0) + "T12:00:00Z").getUTCDay();
    await sembrar("call_routines", { name: "Repaso de prueba", weekdays: [diaMvd], local_time: ahoraMvd + ":00", target_minutes: 10, focus: "Repaso breve del día" });
    const r1 = await (await tick("secreto-de-prueba")).json();
    const r2 = await (await tick("secreto-de-prueba")).json();
    afirmar(r1.ok && r1.creadas === 1 && r2.notificadas === 1 && r2.creadas === 0, `el programador crea la llamada de la rutina y la marca a su hora (${JSON.stringify(r2)})`);
    const programada = (await estado()).sessions.find((x) => x.status === "notificada");
    await pagina.goto(BASE + "/hoy");
    await pagina.getByRole("alert").getByText("Tu Agente te está llamando").waitFor();
    await captura("18-aviso-llamada");
    await pagina.getByRole("link", { name: "Atender" }).click();
    await pagina.waitForURL(new RegExp(`/llamada/${programada.id}$`));
    await pagina.getByRole("button", { name: "Atender" }).waitFor();
    ok("dentro de la app aparece el aviso de llamada en espera y lleva a la llamada");

    // La ignoro: pasan 11 minutos desde el aviso.
    await editar("sessions", programada.id, { notified_at: new Date(Date.now() - 11 * 60000).toISOString(), scheduled_at: new Date(Date.now() - 11 * 60000).toISOString() });
    const r3 = await (await tick("secreto-de-prueba")).json();
    e = await estado();
    const nueva = e.sessions.find((x) => x.rescheduled_from === programada.id);
    afirmar(r3.reprogramadas === 1 && e.sessions.find((x) => x.id === programada.id).status === "reprogramada" && nueva?.status === "programada" && new Date(nueva.scheduled_at) > new Date(),
      "si ignoro el aviso, la llamada queda reprogramada para más tarde");
    await pagina.goto(BASE + "/calendario");
    await pagina.getByText(/Llamada del Agente a las|llamada/).first().waitFor({ state: "attached" });
    await pagina.goto(BASE + "/sesiones");
    await pagina.getByText("Reprogramada").first().waitFor();
    ok("la llamada reprogramada se ve en Sesiones");
    await editar("sessions", nueva.id, { status: "completada" });

    console.log("Paleta, atajos y datos");
    await pagina.goto(BASE + "/hoy");
    await pagina.getByRole("heading", { name: "Hoy", exact: true }).waitFor();
    await pagina.keyboard.press("g");
    await pagina.keyboard.press("t");
    await pagina.waitForURL(/\/tablero$/);
    ok("atajo «g t» va al Tablero");
    await pagina.getByRole("heading", { name: "Tablero" }).waitFor();
    await pagina.keyboard.press("Control+k");
    await pagina.getByLabel("Buscar secciones, proyectos y tareas").fill("correr");
    await pagina.getByRole("listbox", { name: "Resultados" }).getByRole("option", { name: /Correr 10 km/ }).first().waitFor();
    await pagina.keyboard.press("Enter");
    await pagina.waitForURL(/\/proyectos\/[0-9a-f-]{36}$/);
    ok("la paleta (Ctrl K) busca y abre un proyecto");
    await pagina.getByLabel("Nombre del proyecto").waitFor();
    await pagina.locator("body").click({ position: { x: 5, y: 400 } });
    await pagina.keyboard.press("n");
    await pagina.getByLabel("Título de la tarea").fill("Comprar zapatillas mañana p1");
    await pagina.getByRole("listbox", { name: "Resultados" }).getByRole("option", { name: /Crear «Comprar zapatillas»/ }).waitFor();
    await pagina.keyboard.press("Enter");
    await pagina.getByText(/Tarea creada en/).waitFor();
    e = await estado();
    afirmar(e.tasks.find((t) => t.title === "Comprar zapatillas")?.due_date === fechaMvd(1), "atajo «n»: tarea nueva desde cualquier pantalla, con fecha y prioridad");
    await pagina.keyboard.press("?");
    await pagina.getByRole("dialog", { name: "Atajos de teclado" }).waitFor();
    await pagina.keyboard.press("Escape");

    await pagina.goto(BASE + "/configuracion");
    const descarga = pagina.waitForEvent("download");
    await pagina.getByRole("button", { name: "Exportar todo (JSON)" }).click();
    const exportado = JSON.parse(require("node:fs").readFileSync(await (await descarga).path(), "utf8"));
    afirmar(exportado.tasks.length === e.tasks.length && exportado.memories.length === e.memories.length && exportado.messages.length > 5 && exportado.sessions.length >= 4,
      "exportar baja todos mis datos en un archivo");

    console.log("Ingreso con contraseña");
    const nuevo = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pi = await nuevo.newPage();
    pi.on("pageerror", (x) => errores.push("ingreso: " + String(x)));
    await pi.goto(BASE + "/hoy");
    await pi.waitForURL(/\/ingresar/);
    await pi.getByLabel("Correo").fill("prueba@ejemplo.com");
    await pi.getByLabel("Contraseña").fill("todavia-no-tengo");
    await pi.getByRole("button", { name: "Entrar", exact: true }).click();
    await pi.getByText(/no coinciden. Si todavía no pusiste una contraseña, entrá con un código/).waitFor();
    afirmar(true, "sin contraseña puesta, el ingreso con contraseña explica que hay que entrar con un código");
    await pi.screenshot({ path: path.join(capturas, "26-ingreso-contrasena.png") });
    await pi.getByRole("button", { name: "Entrar con un código" }).click();
    await pi.getByText("el registro de cuentas nuevas está cerrado").waitFor();
    await pi.getByLabel("Correo").fill("alguien-nuevo@ejemplo.com");
    await pi.getByRole("button", { name: "Enviarme el acceso" }).click();
    await pi.getByText(/Ese correo no tiene una cuenta en MiAgente/).waitFor();
    afirmar(true, "con el registro cerrado, un correo sin cuenta recibe un mensaje claro y no se crea nada");
    await pi.getByLabel("Correo").fill("prueba@ejemplo.com");
    await pi.getByRole("button", { name: "Enviarme el acceso" }).click();
    await pi.getByLabel("Código del correo").fill("123456");
    await pi.getByRole("button", { name: "Entrar", exact: true }).click();
    await pi.waitForURL(/\/(hoy|bienvenida)/);
    afirmar(true, "la primera vez se entra con el código del correo");
    await pi.goto(BASE + "/configuracion");
    await pi.getByLabel("Nueva contraseña").fill("corta");
    await pi.getByText("Tiene que tener al menos 8 caracteres.").waitFor();
    await pi.getByLabel("Nueva contraseña").fill("una-contraseña-larga");
    await pi.getByLabel("Repetila").fill("otra-distinta");
    await pi.getByText("Las dos no coinciden.").waitFor();
    afirmar(await pi.getByRole("button", { name: "Guardar contraseña" }).isDisabled(), "valida el largo y que las dos coincidan antes de guardar");
    await pi.getByLabel("Repetila").fill("una-contraseña-larga");
    await pi.getByRole("button", { name: "Guardar contraseña" }).click();
    await pi.getByText("Listo. Desde ahora podés entrar con tu correo y esta contraseña.").waitFor();
    afirmar((await (await fetch(`${FALSO}/__contrasena`)).json()).tiene, "la contraseña se guarda en la cuenta desde Configuración");
    await pi.getByRole("button", { name: "Cerrar sesión" }).click();
    await pi.waitForURL(/\/ingresar/);
    await nuevo.clearCookies();
    await pi.getByLabel("Correo").fill("prueba@ejemplo.com");
    await pi.getByLabel("Contraseña").fill("una-contraseña-larga");
    await pi.getByRole("button", { name: "Entrar", exact: true }).click();
    await pi.waitForURL(/\/(hoy|bienvenida)$/);
    afirmar(true, "con correo y contraseña se entra directo, sin esperar ningún correo");
    await nuevo.close();

    console.log("Seguridad");
    const respuestaPagina = await pagina.context().request.get(BASE + "/hoy");
    const csp = respuestaPagina.headers()["content-security-policy"] ?? "";
    afirmar(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp),
      "las páginas llevan una política de contenido estricta con nonce");
    afirmar((respuestaPagina.headers()["permissions-policy"] ?? "").includes("microphone=(self)") && (respuestaPagina.headers()["permissions-policy"] ?? "").includes("camera=()"),
      "micrófono solo para el propio sitio; cámara y ubicación apagadas");
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    const html = await respuestaPagina.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    afirmar(scripts.length > 0 && scripts.every((t) => t.includes(`nonce="${nonce}"`)), "todos los scripts de la página llevan el nonce del pedido");
    const ajeno = await fetch(BASE + "/api/agent/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://otro-sitio.com", Cookie: `${cookieDeSesion().name}=${cookieDeSesion().value}` },
      body: JSON.stringify({ texto: "hola" }),
    });
    afirmar(ajeno.status === 403, "un pedido que modifica algo desde otro sitio (Origin ajeno) se rechaza");
    await fetch(`${FALSO}/__forzar_limite`, { method: "POST", body: JSON.stringify({ clave: "turno", activo: true }) });
    await pagina.goto(BASE + "/chat");
    await pagina.getByLabel("Mensaje para el Agente").fill("¿Seguís ahí?");
    await pagina.getByLabel("Mensaje para el Agente").press("Enter");
    await pagina.getByText("Vas muy rápido: esperá un minuto y probá de nuevo.").waitFor();
    await fetch(`${FALSO}/__forzar_limite`, { method: "POST", body: JSON.stringify({ clave: "turno", activo: false }) });
    afirmar(true, "al pasarse del límite de frecuencia, el chat muestra un mensaje claro (429)");

    console.log("Terminar la sesión pidiéndoselo al Agente");
    await guion([
      { llamadas: [{ nombre: "terminar_sesion", argumentos: {} }] },
      { texto: "Listo, cerramos acá. ¡Nos vemos!" },
    ]);
    await pagina.goto(BASE + "/chat");
    await pagina.getByLabel("Mensaje para el Agente").fill("Terminá la sesión, por favor");
    await pagina.getByLabel("Mensaje para el Agente").press("Enter");
    await pagina.getByText("Listo, cerramos acá. ¡Nos vemos!").waitFor();
    await pagina.waitForURL(/\/sesiones\/[0-9a-f-]{36}$/, { timeout: 15000 });
    const cerradaId = pagina.url().split("/").pop();
    afirmar((await estado()).sessions.find((x) => x.id === cerradaId)?.status === "completada",
      "al pedirle «terminá la sesión», el Agente se despide y la sesión se cierra sola, sin tocar el botón");
    // Instalación como app y notificaciones: el service worker y el manifest siguen andando con la política nueva.
    const swActivo = await pagina.evaluate(() =>
      Promise.race([navigator.serviceWorker.ready.then((r) => Boolean(r.active)), new Promise((ok) => setTimeout(() => ok(false), 10000))]),
    );
    const manifiesto = await (await fetch(BASE + "/manifest.webmanifest")).json();
    afirmar(swActivo && manifiesto.display === "standalone" && manifiesto.icons?.length > 0,
      "el service worker se registra y el manifest está bien (se puede instalar como app)");
    // (Chromium sin pantalla niega siempre el permiso de notificaciones: la suscripción real se prueba en un teléfono.)
    const pushDisponible = await pagina.evaluate(async () => "PushManager" in window && Boolean((await navigator.serviceWorker.ready).pushManager));
    afirmar(pushDisponible, "la API de notificaciones push sigue disponible para el service worker");

    console.log("Celular (390 px)");
    const movil = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await movil.addCookies([{ ...cookieDeSesion(), url: BASE }]);
    const pm = await movil.newPage();
    pm.on("pageerror", (x) => errores.push("móvil: " + String(x)));
    for (const [ruta, nombre] of [["/hoy", "07-movil-hoy"], ["/tablero", "08-movil-tablero"], ["/calendario", "09-movil-calendario"], ["/proyectos", "10-movil-proyectos"], ["/chat", "19-movil-chat"], ["/configuracion", "20-movil-configuracion"], ["/memoria", "21-movil-memoria"], ["/sesiones", "22-movil-sesiones"], ["/bienvenida", "23-movil-bienvenida"]]) {
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

    console.log("Borrar todos mis datos");
    await pagina.goto(BASE + "/configuracion");
    await pagina.getByRole("button", { name: "Borrar todos mis datos" }).click();
    afirmar(await pagina.getByRole("button", { name: "Borrar todo", exact: true }).isDisabled(), "borrar todo pide escribir una palabra para confirmar");
    await pagina.getByLabel("Escribí BORRAR para confirmar").fill("BORRAR");
    await pagina.getByRole("button", { name: "Borrar todo", exact: true }).click();
    await pagina.waitForURL(/\/ingresar/);
    e = await estado();
    afirmar(["tasks", "projects", "sessions", "messages", "memories", "change_log", "profiles"].every((t) => e[t].length === 0), "borrar todo no deja nada mío en la base");

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
