/**
 * Capturas de la app para los videos. Usa la app compilada contra el Supabase
 * de mentira (el mismo build que la recorrida) con datos de ejemplo.
 *
 *   node promo/capturar.cjs            → promo/capturas (video promocional)
 *   node promo/capturar.cjs guzman     → promo/capturas-guzman (video en joda)
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { crearServidor, cookieDeSesion } = require("../tests/recorrida/supabase-falso.cjs");

const MODO = process.argv[2] ?? "";
const BASE = "http://localhost:3102";
const FALSO = "http://127.0.0.1:54321";
const SALIDA = path.join(__dirname, MODO ? `capturas-${MODO}` : "capturas");
const dia = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(Date.now() + n * 86_400_000);
const hace = (min) => new Date(Date.now() - min * 60_000).toISOString();

/** Datos del video promocional: una persona ordenada con tres proyectos. */
function datosPromo(s) {
  const casa = s("areas", { name: "Casa", color: "#6ea8fe", icon: "🏠", sort_order: 1 });
  const salud = s("areas", { name: "Salud", color: "#4cc38a", icon: "🏃", sort_order: 2 });
  const trabajo = s("areas", { name: "Trabajo", color: "#e0a84a", icon: "💼", sort_order: 3 });
  const bano = s("projects", { name: "Reformar el baño", area_id: casa.id, goal: "Baño terminado antes de las fiestas", sort_order: 1, due_date: dia(24) });
  const correr = s("projects", { name: "Correr 10 km", area_id: salud.id, goal: "Correr 10 km sin parar antes de marzo", sort_order: 2 });
  const sitio = s("projects", { name: "Lanzar mi sitio", area_id: trabajo.id, goal: "Sitio publicado y recibiendo consultas", sort_order: 3 });
  let n = 0;
  const t = (proyecto, title, extra = {}) => s("tasks", { project_id: proyecto.id, title, sort_order: ++n, ...extra });
  t(bano, "Pagar la seña del plomero", { due_date: dia(-2), priority: 1 });
  const azulejos = t(bano, "Elegir azulejos", { due_date: dia(0), due_set_by: "agente" });
  t(correr, "Salir a correr 5 km", { due_date: dia(0), due_set_by: "usuario" });
  t(sitio, "Escribir la página de inicio", { due_date: dia(0), status: "en_curso" });
  t(bano, "Pedir presupuesto de pintura", { status: "en_curso" });
  t(sitio, "Elegir el dominio", { due_date: dia(2), due_set_by: "agente" });
  t(correr, "Comprar zapatillas", { due_date: dia(3) });
  const electricista = t(bano, "Coordinar con el electricista", { status: "bloqueada", blocked_reason: "Espera su respuesta" });
  t(sitio, "Sacar las fotos", { status: "hecha", completed_at: hace(60) });
  t(correr, "Armar el plan de 8 semanas", { status: "hecha", completed_at: hace(200) });
  return {
    memorias: [
      ["objetivo", "Quiere correr 10 km sin parar antes de marzo."],
      ["rutina", "Rinde mejor de 7 a 10 de la mañana."],
      ["obstaculo_recurrente", "Posterga las llamadas por teléfono."],
      ["solucion_que_funciono", "Le funciona dividir lo grande en pasos de 15 minutos."],
    ],
    dijo: "Terminé de elegir los azulejos y lo del electricista sigue trabado porque espero su respuesta",
    respondio: "Listo: azulejos hecha. Lo del electricista hace una semana que no se mueve. Te lo dejo para el jueves: ¿le escribís vos o lo llamás?",
    cambios: [[azulejos, "actualizar", "«Elegir azulejos»: hecha"], [electricista, "actualizar", "«Coordinar con el electricista»: fecha límite → jueves"]],
    foco: "Repaso breve del día",
  };
}

/** Datos del video para Guzmán: todo vencido, nada hecho. */
function datosGuzman(s) {
  s.perfil({ name: "Guzmán" });
  const vida = s("areas", { name: "La vida misma", color: "#e0a84a", icon: "🫠", sort_order: 1 });
  const postergar = s("projects", { name: "Dejar de postergar", area_id: vida.id, goal: "Hacer una sola cosa el día que dijo", sort_order: 1 });
  const keke = s("projects", { name: "Operación Keke", area_id: vida.id, goal: "Conseguir más keke", sort_order: 2 });
  const gym = s("projects", { name: "Gimnasio (ahora sí)", area_id: vida.id, goal: "Ir una vez. Una.", sort_order: 3 });
  let n = 0;
  const t = (proyecto, title, extra = {}) => s("tasks", { project_id: proyecto.id, title, sort_order: ++n, ...extra });
  const lunes = t(postergar, "Empezar el lunes", { due_date: dia(-47), priority: 1 });
  t(gym, "Anotarse al gimnasio", { due_date: dia(-120) });
  t(keke, "Contestarle el mensaje", { due_date: dia(-9), priority: 1 });
  t(postergar, "Dejar de ser tan gil", { due_date: dia(0), due_set_by: "agente", priority: 1 });
  const encarar = t(keke, "Encarar", { due_date: dia(0), due_set_by: "agente", priority: 1 });
  t(postergar, "Un capítulo más y arranco", { status: "en_curso" });
  t(keke, "Pensar qué decirle (día 14)", { status: "en_curso" });
  t(keke, "Invitarla a salir", { status: "bloqueada", blocked_reason: "Le da cosa" });
  const excusas = t(postergar, "Buscar una excusa nueva", { due_date: dia(1) });
  return {
    memorias: [
      ["objetivo", "Conseguir más keke."],
      ["rutina", "Dice «mañana arranco» desde 2019."],
      ["obstaculo_recurrente", "Posterga hasta lo que le gusta."],
      ["solucion_que_funciono", "Solo se mueve si hay asado de por medio."],
    ],
    dijo: "Mañana arranco, posta",
    respondio: "Guzmán, eso me dijiste el lunes. Y el lunes anterior. Te lo dejo para hoy: ¿encarás vos o le escribo yo?",
    cambios: [[lunes, "actualizar", "«Empezar el lunes»: fecha límite → hoy"], [encarar, "actualizar", "«Encarar»: prioridad P1"], [excusas, "archivar", "Archivada: «Buscar una excusa nueva»"]],
    foco: "Guzmán, atendé. Sé que tenés el celular en la mano.",
  };
}

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const falso = crearServidor();
  falso.listen(54321, "127.0.0.1");
  const s = (tabla, fila) => falso.sembrar(tabla, fila);
  s.perfil = (cambios) => Object.assign(falso.estado().profiles[0], cambios);

  const datos = MODO === "guzman" ? datosGuzman(s) : datosPromo(s);
  for (const [category, content] of datos.memorias) s("memories", { category, content });
  const chat = s("sessions", { kind: "chat", channel: "texto", status: "en_curso", started_at: hace(3) });
  s("messages", { session_id: chat.id, role: "usuario", content: datos.dijo, created_at: hace(3) });
  const respuesta = s("messages", { session_id: chat.id, role: "agente", provider: "gemini", created_at: hace(2), content: datos.respondio });
  for (const [fila, operation, summary] of datos.cambios) {
    s("change_log", { session_id: chat.id, message_id: respuesta.id, table_name: "tasks", row_id: fila.id, operation, summary, old_values: {}, created_at: hace(2) });
  }

  const next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", "3102"], {
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: FALSO, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "clave-falsa", GEMINI_API_KEY: "x", GEMINI_BASE_URL: "http://127.0.0.1:9" },
    stdio: "ignore",
  });
  const navegador = await chromium.launch();
  try {
    for (let i = 0; i < 60; i++) {
      try { await fetch(BASE + "/ingresar"); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    // Celular de 390 px, a triple densidad para que se vea nítido en el video.
    const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "es-UY" });
    await contexto.addCookies([{ ...cookieDeSesion(), url: BASE }]);
    const pagina = await contexto.newPage();
    const captura = async (ruta, nombre, antes) => {
      await pagina.goto(BASE + ruta);
      await pagina.waitForLoadState("networkidle");
      await antes?.();
      await pagina.waitForTimeout(500);
      await pagina.screenshot({ path: path.join(SALIDA, nombre + ".png") });
      console.log("  ✓", nombre);
    };
    await captura("/hoy", "hoy", () => pagina.getByRole("heading", { name: /Vencidas/ }).waitFor());
    await captura("/tablero", "tablero", () => pagina.getByRole("region", { name: "Pendiente" }).waitFor());
    // El tablero corrido hasta el final: se ven «Bloqueada» y «Hecha».
    await captura("/tablero", "tablero-fin", async () => {
      await pagina.getByRole("region", { name: "Hecha" }).waitFor({ state: "attached" });
      await pagina.evaluate(() => {
        const fila = document.querySelector("section[aria-label='Hecha']").parentElement;
        fila.style.scrollSnapType = "none";
        fila.scrollLeft = fila.scrollWidth;
      });
    });
    await captura("/chat", "chat", () => pagina.getByText("Deshacer").first().waitFor());
    await captura("/memoria", "memoria", () => pagina.getByRole("heading", { name: /Objetivos/ }).waitFor());
    const llamada = falso.sembrar("sessions", { kind: "llamada_programada", channel: "voz", status: "notificada", scheduled_at: hace(0), notified_at: hace(0), focus: datos.foco });
    await captura(`/llamada/${llamada.id}`, "llamada", () => pagina.getByRole("button", { name: "Atender" }).waitFor());
  } finally {
    await navegador.close();
    next.kill();
    falso.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
