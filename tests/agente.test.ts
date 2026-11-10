import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cerrarSesion } from "@/lib/agente/cierre";
import { armarSistema } from "@/lib/agente/contexto";
import { corto, leerInstantanea, type Sesion } from "@/lib/agente/datos";
import { deshacerCambio } from "@/lib/agente/deshacer";
import { definiciones, ejecutarHerramienta, guardarMemoria, type Contexto } from "@/lib/agente/herramientas";
import { correrTurno, resumirSiHaceFalta, type EventoTurno } from "@/lib/agente/runner";
import { juntar, levantarSupabase, proveedorFalso, type ServidorSupabase } from "./apoyo/falsos";

let servidor: ServidorSupabase;
let sb: SupabaseClient;
const AHORA = new Date("2026-11-10T15:00:00Z"); // martes 10, mediodía en Montevideo

beforeAll(async () => {
  ({ servidor, sb } = await levantarSupabase());
});
afterAll(() => servidor.close());

/** Un proyecto con tres tareas y una sesión de chat abierta. */
function sembrar(sesion: Partial<Sesion> = {}) {
  servidor.reiniciar();
  const proyecto = servidor.sembrar("projects", { name: "Reformar el baño", goal: "Baño listo antes de las fiestas" });
  const azulejos = servidor.sembrar("tasks", { project_id: proyecto.id, title: "Elegir azulejos", due_date: "2026-11-05", sort_order: 1 });
  const plomero = servidor.sembrar("tasks", { project_id: proyecto.id, title: "Pedir presupuesto al plomero", status: "en_curso", sort_order: 2 });
  const griferia = servidor.sembrar("tasks", { project_id: proyecto.id, title: "Comprar grifería", sort_order: 3 });
  const s = servidor.sembrar("sessions", { kind: "chat", channel: "texto", ...sesion }) as unknown as Sesion;
  return { proyecto, azulejos, plomero, griferia, sesion: s };
}
const tabla = (nombre: string) => servidor.estado()[nombre];
const deTipo = <T extends EventoTurno["tipo"]>(eventos: EventoTurno[], tipo: T) =>
  eventos.filter((e): e is Extract<EventoTurno, { tipo: T }> => e.tipo === tipo);

describe("un turno del Agente", () => {
  beforeEach(() => void 0);

  it("«terminé X y Z está trabado»: actualiza las dos tareas, lo registra y se puede deshacer", async () => {
    const { azulejos, plomero, sesion } = sembrar();
    const gemini = proveedorFalso("gemini", [
      {
        llamadas: [
          { nombre: "actualizar_tarea", argumentos: { tarea_id: corto(azulejos.id), estado: "hecha" } },
          {
            nombre: "actualizar_tarea",
            argumentos: { tarea_id: corto(plomero.id), estado: "bloqueada", motivo_bloqueo: "Espera la respuesta del plomero" },
          },
        ],
      },
      { texto: "Listo: azulejos hecha y el presupuesto queda trabado hasta que conteste el plomero." },
    ]);
    const eventos = await juntar(
      correrTurno({
        sb, sesion, proveedores: [gemini], ahora: AHORA,
        entrada: { texto: "Terminé de elegir los azulejos y lo del plomero está trabado porque espero su respuesta" },
      }),
    );

    const tareas = tabla("tasks");
    expect(tareas.find((t) => t.id === azulejos.id)).toMatchObject({ status: "hecha" });
    expect(tareas.find((t) => t.id === azulejos.id)?.completed_at).toBeTruthy();
    expect(tareas.find((t) => t.id === plomero.id)).toMatchObject({
      status: "bloqueada", blocked_reason: "Espera la respuesta del plomero",
    });

    const cambios = deTipo(eventos, "cambio").map((e) => e.cambio);
    expect(cambios).toHaveLength(2);
    expect(cambios[0].summary).toBe("«Elegir azulejos»: hecha");
    const registro = tabla("change_log");
    expect(registro).toHaveLength(2);
    expect(registro[0]).toMatchObject({ session_id: sesion.id, operation: "actualizar", old_values: { status: "pendiente" } });
    expect(registro[0].message_id).toBeTruthy();
    expect(deTipo(eventos, "fin")[0]).toMatchObject({ proveedor: "gemini" });

    // La transcripción guarda todo, incluidas las herramientas usadas.
    const roles = tabla("messages").map((m) => m.role);
    expect(roles).toEqual(["usuario", "agente", "herramienta", "herramienta", "agente"]);
    expect(tabla("messages")[1]).toMatchObject({ provider: "gemini", model: "gemini-prueba" });
    expect(tabla("messages")[1].tool_calls).toHaveLength(2);
    // El segundo pedido al modelo lleva los resultados de las herramientas.
    expect(gemini.pedidos[1].mensajes.filter((m) => m.rol === "herramienta")).toHaveLength(2);

    // Deshacer cada cambio por separado.
    expect(await deshacerCambio(sb, cambios[0].id)).toEqual({ ok: true });
    expect(tabla("tasks").find((t) => t.id === azulejos.id)).toMatchObject({ status: "pendiente", completed_at: null });
    expect(tabla("tasks").find((t) => t.id === plomero.id)?.status).toBe("bloqueada");
    expect(await deshacerCambio(sb, cambios[1].id)).toEqual({ ok: true });
    expect(tabla("tasks").find((t) => t.id === plomero.id)).toMatchObject({ status: "en_curso", blocked_reason: null });
    expect(tabla("change_log").every((c) => c.undone_at)).toBe(true);
  });

  it("si el principal devuelve un error de límite, sigue el de respaldo sin cortar", async () => {
    const { sesion } = sembrar();
    const gemini = proveedorFalso("gemini", [{ falla: "limite" }]);
    const groq = proveedorFalso("groq", [{ texto: "Acá estoy. ¿Qué pasó con los azulejos?" }]);
    const eventos = await juntar(
      correrTurno({ sb, sesion, proveedores: [gemini, groq], ahora: AHORA, entrada: { texto: "Hola" } }),
    );
    expect(deTipo(eventos, "cambio_proveedor")).toEqual([{ tipo: "cambio_proveedor", de: "gemini", motivo: "limite" }]);
    expect(deTipo(eventos, "error")).toEqual([]);
    expect(deTipo(eventos, "fin")[0]).toMatchObject({ proveedor: "groq", texto: "Acá estoy. ¿Qué pasó con los azulejos?" });
    expect(tabla("messages").at(-1)).toMatchObject({ role: "agente", provider: "groq" });
    expect(tabla("sessions")[0].providers_used).toEqual(["groq"]);
    // El respaldo recibió el mismo historial.
    expect(groq.pedidos[0].mensajes).toEqual([{ rol: "usuario", texto: "Hola" }]);

    // En el turno siguiente el que llegó al límite queda en pausa: no se le vuelve a pedir.
    const groq2 = proveedorFalso("groq", [{ texto: "Sigo yo." }]);
    const gemini2 = proveedorFalso("gemini", [{ texto: "No debería responder" }]);
    await juntar(correrTurno({ sb, sesion, proveedores: [gemini2, groq2], ahora: AHORA, entrada: { texto: "¿Seguís?" } }));
    expect(gemini2.pedidos).toHaveLength(0);
  });

  it("argumentos inválidos: reintenta una vez y después pasa al siguiente, sin aplicar nada a medias", async () => {
    const { azulejos, griferia, sesion } = sembrar();
    const mala = { nombre: "actualizar_tarea", argumentos: { tarea_id: corto(azulejos.id), estado: "terminadísima" } };
    const buena = { nombre: "actualizar_tarea", argumentos: { tarea_id: corto(griferia.id), estado: "hecha" } };
    const local = proveedorFalso("ollama", [{ llamadas: [buena, mala] }, { llamadas: [mala] }]);
    const groq = proveedorFalso("groq", [{ llamadas: [buena] }, { texto: "Hecho." }]);
    const eventos = await juntar(
      correrTurno({ sb, sesion, proveedores: [local, groq], ahora: AHORA, entrada: { texto: "Compré la grifería" } }),
    );
    expect(local.pedidos).toHaveLength(2);
    // En el reintento el modelo vio el error de validación.
    expect(JSON.stringify(local.pedidos[1].mensajes)).toContain("Argumentos inválidos");
    expect(deTipo(eventos, "cambio_proveedor")).toEqual([{ tipo: "cambio_proveedor", de: "ollama", motivo: "invalido" }]);
    // El respaldo arranca del historial limpio, sin los intentos fallidos.
    expect(groq.pedidos[0].mensajes).toEqual([{ rol: "usuario", texto: "Compré la grifería" }]);
    // La llamada válida que venía junto a la inválida NO se aplicó dos veces.
    expect(tabla("change_log")).toHaveLength(1);
    expect(tabla("tasks").find((t) => t.id === griferia.id)?.status).toBe("hecha");
    expect(tabla("tasks").find((t) => t.id === azulejos.id)?.status).toBe("pendiente");
    expect(tabla("sessions")[0].providers_used).toEqual(["groq"]);
  });

  it("si un proveedor se corta a mitad de la respuesta, se descarta lo parcial", async () => {
    const { sesion } = sembrar();
    const a = proveedorFalso("ollama", [{ texto: "Bueno, mirá", fallaDespues: "sin_respuesta" }]);
    const b = proveedorFalso("groq", [{ texto: "Respuesta completa." }]);
    const eventos = await juntar(correrTurno({ sb, sesion, proveedores: [a, b], ahora: AHORA, entrada: { texto: "Hola" } }));
    const tipos = eventos.map((e) => e.tipo);
    expect(tipos.indexOf("reiniciar")).toBeGreaterThan(tipos.indexOf("texto"));
    expect(deTipo(eventos, "fin")[0].texto).toBe("Respuesta completa.");
    expect(tabla("messages").filter((m) => m.role === "agente")).toHaveLength(1);
  });

  it("si todos fallan lo dice con claridad y no rompe nada", async () => {
    const { sesion } = sembrar();
    const eventos = await juntar(
      correrTurno({
        sb, sesion, ahora: AHORA, entrada: { texto: "Hola" },
        proveedores: [proveedorFalso("gemini-x", [{ falla: "limite" }]), proveedorFalso("groq-x", [{ falla: "sin_respuesta" }])],
      }),
    );
    expect(deTipo(eventos, "error")[0].mensaje).toMatch(/no puedo responder/i);
    expect(eventos.at(-1)).toMatchObject({ tipo: "fin", proveedor: null });
    // El mensaje de la persona quedó guardado para cuando vuelva el servicio.
    expect(tabla("messages").map((m) => m.role)).toEqual(["usuario"]);
  });

  it("sin ningún proveedor configurado avisa que falta configurar", async () => {
    const { sesion } = sembrar();
    const eventos = await juntar(correrTurno({ sb, sesion, proveedores: [], ahora: AHORA, entrada: { texto: "Hola" } }));
    expect(deTipo(eventos, "error")[0].mensaje).toMatch(/falta la clave/i);
  });

  it("en una llamada el Agente abre la conversación y recibe el guion de voz", async () => {
    const { sesion } = sembrar({ kind: "llamada_programada", channel: "voz", status: "notificada", focus: "Repaso breve del día", target_minutes: 5 });
    const p = proveedorFalso("gemini-v", [{ texto: "Hola. La vez pasada quedaste en elegir los azulejos. ¿Qué pasó?" }]);
    await juntar(correrTurno({ sb, sesion, proveedores: [p], ahora: AHORA, voz: true, entrada: { inicio: true } }));
    expect(p.pedidos[0].sistema).toContain("LLAMADA PROGRAMADA");
    expect(p.pedidos[0].sistema).toContain("Repaso breve del día");
    expect(p.pedidos[0].sistema).toContain("una a tres oraciones");
    expect(p.pedidos[0].mensajes[0].rol).toBe("usuario");
    expect(tabla("sessions")[0]).toMatchObject({ status: "en_curso" });
    expect(tabla("sessions")[0].started_at).toBeTruthy();
    expect(tabla("messages").map((m) => m.role)).toEqual(["sistema", "agente"]);
  });
});

describe("herramientas", () => {
  async function contexto(): Promise<Contexto & ReturnType<typeof sembrar>> {
    const base = sembrar();
    const datos = await leerInstantanea(sb, base.sesion.id);
    return { ...base, sb, sesionId: base.sesion.id, hoy: "2026-11-10", datos, cambios: [] };
  }

  it("se definen una sola vez, con un esquema que aceptan todos los proveedores", () => {
    const defs = definiciones();
    expect(defs.map((d) => d.nombre)).toEqual(
      expect.arrayContaining(["ver_proyecto", "crear_tarea", "actualizar_tarea", "archivar_tarea", "anotar_bitacora", "guardar_memoria", "reprogramar_llamada"]),
    );
    for (const d of defs) {
      expect(d.parametros.type).toBe("object");
      expect(d.parametros).not.toHaveProperty("$schema");
      expect(d.parametros).not.toHaveProperty("additionalProperties");
    }
    // Compactas: todas juntas tienen que entrar holgadas en el cupo de un turno.
    expect(JSON.stringify(defs).length).toBeLessThan(7000);
  });

  it("crear una tarea marca que la fecha la puso el Agente, y deshacerlo la archiva", async () => {
    const ctx = await contexto();
    const r = await ejecutarHerramienta(ctx, "crear_tarea", {
      proyecto_id: corto(ctx.proyecto.id), titulo: "Medir las paredes", fecha_limite: "2026-11-12",
    });
    expect(r.clase).toBe("ok");
    const tarea = tabla("tasks").find((t) => t.title === "Medir las paredes");
    expect(tarea).toMatchObject({ due_date: "2026-11-12", due_set_by: "agente", project_id: ctx.proyecto.id });
    expect(ctx.cambios[0].summary).toBe("Nueva tarea en Reformar el baño: «Medir las paredes» (para jue 12)");
    await deshacerCambio(sb, ctx.cambios[0].id);
    expect(tabla("tasks").find((t) => t.id === tarea?.id)?.archived_at).toBeTruthy();
  });

  it("nunca borra: archivar deja la fila y se puede deshacer", async () => {
    const ctx = await contexto();
    const sub = servidor.sembrar("tasks", { project_id: ctx.proyecto.id, parent_id: ctx.griferia.id, title: "Comparar precios" });
    ctx.datos = await leerInstantanea(sb);
    await ejecutarHerramienta(ctx, "archivar_tarea", { tarea_id: corto(ctx.griferia.id) });
    expect(tabla("tasks")).toHaveLength(4);
    expect(tabla("tasks").find((t) => t.id === ctx.griferia.id)?.archived_at).toBeTruthy();
    expect(tabla("tasks").find((t) => t.id === sub.id)?.archived_at).toBeTruthy();
    await deshacerCambio(sb, ctx.cambios[0].id);
    expect(tabla("tasks").find((t) => t.id === ctx.griferia.id)?.archived_at).toBeNull();
    expect(tabla("tasks").find((t) => t.id === sub.id)?.archived_at).toBeNull();
  });

  it("quitar una fecha y cambiar varias cosas a la vez", async () => {
    const ctx = await contexto();
    await ejecutarHerramienta(ctx, "actualizar_tarea", {
      tarea_id: corto(ctx.azulejos.id), fecha_limite: "ninguna", prioridad: 1,
    });
    expect(tabla("tasks").find((t) => t.id === ctx.azulejos.id)).toMatchObject({ due_date: null, due_set_by: null, priority: 1 });
    expect(tabla("change_log")[0].old_values).toMatchObject({ due_date: "2026-11-05", priority: 2 });
  });

  it("un id que no existe o argumentos mal formados vuelven como error, sin tocar nada", async () => {
    const ctx = await contexto();
    const noExiste = await ejecutarHerramienta(ctx, "actualizar_tarea", { tarea_id: "abcdef12", estado: "hecha" });
    expect(noExiste).toMatchObject({ clase: "error" });
    expect((noExiste.resultado as { error: string }).error).toContain("buscar_tareas");
    const fechaMala = await ejecutarHerramienta(ctx, "crear_tarea", { proyecto_id: corto(ctx.proyecto.id), titulo: "X", fecha_limite: "2026-02-31" });
    expect(fechaMala.clase).toBe("invalida");
    expect((await ejecutarHerramienta(ctx, "borrar_todo", {})).clase).toBe("invalida");
    expect(tabla("change_log")).toHaveLength(0);
  });

  it("crea áreas y proyectos, anota en la bitácora y consulta el detalle", async () => {
    const ctx = await contexto();
    const area = (await ejecutarHerramienta(ctx, "crear_area", { nombre: "Salud" })).resultado as { id: string };
    expect((await ejecutarHerramienta(ctx, "crear_area", { nombre: "salud" })).resultado).toMatchObject({ nota: "Ya existía." });
    await ejecutarHerramienta(ctx, "crear_proyecto", { nombre: "Correr 10 km", area_id: area.id, objetivo: "Correr 10 km sin parar" });
    expect(tabla("projects").find((p) => p.name === "Correr 10 km")).toMatchObject({ area_id: tabla("areas")[0].id });
    await ejecutarHerramienta(ctx, "anotar_bitacora", { proyecto_id: corto(ctx.proyecto.id), tipo: "decision", contenido: "No se mueve la bañera." });
    expect(tabla("project_log")[0]).toMatchObject({ author: "agente", kind: "decision", session_id: ctx.sesion.id });
    const detalle = (await ejecutarHerramienta(ctx, "ver_proyecto", { proyecto_id: corto(ctx.proyecto.id) })).resultado as {
      tareas: unknown[]; bitacora: { texto: string }[];
    };
    expect(detalle.tareas).toHaveLength(3);
    expect(detalle.bitacora[0].texto).toBe("No se mueve la bañera.");
    const encontradas = (await ejecutarHerramienta(ctx, "buscar_tareas", { texto: "griferia" })).resultado as { titulo: string }[];
    expect(encontradas[0].titulo).toBe("Comprar grifería");
    // Deshacer un proyecto creado lo archiva; deshacer la nota la quita.
    for (const c of ctx.cambios) await deshacerCambio(sb, c.id);
    expect(tabla("projects").find((p) => p.name === "Correr 10 km")?.status).toBe("archivado");
    expect(tabla("project_log")).toHaveLength(0);
  });

  it("memorias: no duplica y no pisa lo que editó la persona", async () => {
    const ctx = await contexto();
    await guardarMemoria(ctx, { categoria: "rutina", contenido: "Rinde mejor a la mañana." });
    await guardarMemoria(ctx, { categoria: "rutina", contenido: "rinde mejor a la mañana" });
    expect(tabla("memories")).toHaveLength(1);
    const id = tabla("memories")[0].id;

    // Corregir una memoria propia del Agente la actualiza en el lugar.
    await guardarMemoria(ctx, { categoria: "rutina", contenido: "Rinde mejor de 7 a 10 de la mañana.", memoria_id: corto(id) });
    expect(tabla("memories")).toHaveLength(1);
    expect(tabla("memories")[0].content).toBe("Rinde mejor de 7 a 10 de la mañana.");

    // Si la editó la persona, queda como está y lo nuevo va aparte.
    tabla("memories")[0].edited_by_user = true;
    ctx.datos = await leerInstantanea(sb);
    await guardarMemoria(ctx, { categoria: "rutina", contenido: "Rinde mejor de noche.", memoria_id: corto(id) });
    expect(tabla("memories").find((m) => m.id === id)?.content).toBe("Rinde mejor de 7 a 10 de la mañana.");
    expect(tabla("memories")).toHaveLength(2);
  });

  it("reprograma una llamada pendiente a una hora local", async () => {
    const ctx = await contexto();
    const llamada = servidor.sembrar("sessions", { kind: "llamada_programada", channel: "voz", status: "notificada", scheduled_at: "2026-11-10T21:00:00Z", notified_at: "2026-11-10T21:00:00Z" });
    ctx.datos = await leerInstantanea(sb, ctx.sesion.id);
    const r = await ejecutarHerramienta(ctx, "reprogramar_llamada", { llamada_id: corto(llamada.id), fecha: "2099-01-15", hora: "09:30" });
    expect(r.clase).toBe("ok");
    // 09:30 en Montevideo (UTC-3) son las 12:30 UTC.
    expect(tabla("sessions").find((s) => s.id === llamada.id)).toMatchObject({
      scheduled_at: "2099-01-15T12:30:00.000Z", status: "programada", notified_at: null,
    });
    expect((await ejecutarHerramienta(ctx, "reprogramar_llamada", { llamada_id: corto(llamada.id), fecha: "2020-01-01", hora: "09:30" })).clase).toBe("error");
  });
});

describe("contexto que recibe el modelo", () => {
  it("es compacto, pone lo vencido primero y usa ids cortos", async () => {
    const { proyecto, azulejos, sesion } = sembrar();
    for (let i = 0; i < 120; i++) servidor.sembrar("tasks", { project_id: proyecto.id, title: `Tarea de relleno número ${i}`, sort_order: 10 + i });
    servidor.sembrar("memories", { category: "obstaculo_recurrente", content: "Posterga las llamadas por teléfono." });
    servidor.sembrar("sessions", { kind: "chat", channel: "texto", status: "completada", summary: "Quedaste en elegir los azulejos.", commitments: [{ texto: "Elegir azulejos", fecha: "2026-11-05" }], ended_at: "2026-11-08T15:00:00Z" });
    const datos = await leerInstantanea(sb, sesion.id);
    const sistema = armarSistema({ datos, sesion, voz: false, ahora: AHORA });

    expect(sistema).toContain("martes 10 de noviembre de 2026, 12:00");
    expect(sistema).toContain(`[${corto(azulejos.id)}] Elegir azulejos (Reformar el baño) · VENCIDA hace 5 d`);
    expect(sistema).not.toContain(azulejos.id); // nunca el UUID entero
    expect(sistema).toContain("Posterga las llamadas por teléfono.");
    expect(sistema).toContain("Quedaste en elegir los azulejos.");
    expect(sistema).toContain("Compromisos: Elegir azulejos");
    expect(sistema).toContain("y 83 más");
    // Lo vencido va antes que el relleno.
    expect(sistema.indexOf("Elegir azulejos (")).toBeLessThan(sistema.indexOf("Tarea de relleno"));
    // Unos 4 caracteres por token: tiene que entrar en ~3.000 tokens junto con las herramientas.
    expect(sistema.length + JSON.stringify(definiciones()).length).toBeLessThan(12_000);
  });

  it("avisa cuando se falta seguido a una misma rutina", async () => {
    const { sesion } = sembrar();
    const rutina = servidor.sembrar("call_routines", { name: "Repaso matutino", weekdays: [1, 2, 3, 4, 5], local_time: "07:00:00" });
    for (const dia of ["08", "09"]) {
      servidor.sembrar("sessions", { kind: "llamada_programada", channel: "voz", status: "perdida", routine_id: rutina.id, scheduled_at: `2026-11-${dia}T10:00:00Z` });
    }
    const sistema = armarSistema({ datos: await leerInstantanea(sb, sesion.id), sesion, voz: true, ahora: AHORA });
    expect(sistema).toContain("Faltó 2 veces seguidas a la rutina");
    expect(sistema).toContain("Repaso matutino");
  });
});

describe("al terminar una sesión", () => {
  const SALIDA = (proyectoId: string) =>
    "```json\n" +
    JSON.stringify({
      resumen: "Cerraste los azulejos y quedaste en llamar al plomero el jueves.",
      compromisos: [{ texto: "Llamar al plomero", fecha: "2026-11-12" }, { texto: "Medir el baño", fecha: "pronto" }],
      memorias: [{ categoria: "obstaculo_recurrente", contenido: "Posterga las llamadas por teléfono.", memoria_id: null }],
      bitacora: [{ proyecto_id: corto(proyectoId), texto: "Azulejos elegidos; falta el presupuesto del plomero." }, { proyecto_id: "noexiste", texto: "x" }],
    }) +
    "\n```";

  it("guarda resumen, compromisos, memorias nuevas y la bitácora del proyecto tratado", async () => {
    const { proyecto, sesion } = sembrar({ kind: "onboarding" });
    servidor.estado().profiles[0].onboarding_done = false;
    servidor.sembrar("messages", { session_id: sesion.id, role: "usuario", content: "Elegí los azulejos. Me cuesta llamar al plomero." });
    servidor.sembrar("messages", { session_id: sesion.id, role: "agente", content: "¿Lo llamás el jueves?" });
    const liviano = proveedorFalso("gemini-c", [{ texto: SALIDA(proyecto.id) }]);

    const r = await cerrarSesion({ sb, sesionId: sesion.id, proveedores: [liviano], ahora: AHORA });
    expect(r).toEqual({ ok: true, resumen: "Cerraste los azulejos y quedaste en llamar al plomero el jueves." });
    expect(liviano.pedidos[0].liviano).toBe(true);
    expect(tabla("sessions")[0]).toMatchObject({
      status: "completada",
      commitments: [{ texto: "Llamar al plomero", fecha: "2026-11-12" }, { texto: "Medir el baño", fecha: null }],
    });
    expect(tabla("sessions")[0].ended_at).toBeTruthy();
    expect(tabla("memories")[0]).toMatchObject({ category: "obstaculo_recurrente", source_session_id: sesion.id });
    expect(tabla("project_log")).toHaveLength(1);
    expect(tabla("project_log")[0]).toMatchObject({ kind: "resumen_llamada", author: "agente", project_id: proyecto.id, session_id: sesion.id });
    expect(tabla("profiles")[0].onboarding_done).toBe(true);

    // Cerrar dos veces no duplica nada.
    await cerrarSesion({ sb, sesionId: sesion.id, proveedores: [liviano], ahora: AHORA });
    expect(tabla("memories")).toHaveLength(1);
    expect(tabla("project_log")).toHaveLength(1);
  });

  it("si el modelo no está o responde cualquier cosa, la sesión se cierra igual", async () => {
    const { sesion } = sembrar();
    servidor.sembrar("messages", { session_id: sesion.id, role: "usuario", content: "Hola" });
    const roto = proveedorFalso("gemini-r", [{ texto: "No puedo darte JSON, perdón." }]);
    expect(await cerrarSesion({ sb, sesionId: sesion.id, proveedores: [roto], ahora: AHORA })).toEqual({ ok: true, resumen: null });
    expect(tabla("sessions")[0]).toMatchObject({ status: "completada", summary: null });
    // Después se puede volver a intentar y esta vez sí queda el resumen.
    const bien = proveedorFalso("gemini-b", [{ texto: '{"resumen": "Saludaste."}' }]);
    expect((await cerrarSesion({ sb, sesionId: sesion.id, proveedores: [bien], ahora: AHORA })).resumen).toBe("Saludaste.");
  });

  it("una sesión larga se resume para no reenviar todo en cada turno", async () => {
    const { sesion } = sembrar();
    for (let i = 0; i < 30; i++) {
      servidor.sembrar("messages", {
        session_id: sesion.id, role: i % 2 ? "agente" : "usuario", content: `Mensaje ${i}`,
        created_at: new Date(AHORA.getTime() + i * 1000).toISOString(),
      });
    }
    const liviano = proveedorFalso("gemini-h", [{ texto: "Hablaron del baño y quedó pendiente el plomero." }]);
    await resumirSiHaceFalta(sb, sesion, [liviano]);
    const guardada = tabla("sessions")[0];
    expect(guardada.history_summary).toBe("Hablaron del baño y quedó pendiente el plomero.");
    expect(guardada.history_summary_until).toBe(new Date(AHORA.getTime() + 21_000).toISOString());

    // El turno siguiente manda el resumen y solo los mensajes posteriores.
    const p = proveedorFalso("gemini-t", [{ texto: "Sigamos." }]);
    await juntar(correrTurno({ sb, sesion: guardada as unknown as Sesion, proveedores: [p], entrada: { texto: "¿En qué estábamos?" } }));
    expect(p.pedidos[0].sistema).toContain("Hablaron del baño y quedó pendiente el plomero.");
    expect(p.pedidos[0].mensajes).toHaveLength(9);
    expect(p.pedidos[0].mensajes[0]).toEqual({ rol: "usuario", texto: "Mensaje 22" });
  });
});
