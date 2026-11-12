import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { etiquetaFecha, fechaValida } from "@/lib/datos/fechas";
import type { Proyecto, Tarea } from "@/lib/datos/tipos";
import { buscarPorId, corto, type Instantanea, type Memoria } from "./datos";
import type { DefHerramienta } from "./tipos";

/**
 * Las herramientas del Agente, definidas una sola vez. De acá sale el esquema
 * que se le manda a cada proveedor y la validación de lo que el modelo pide.
 *
 * Reglas que valen para todas:
 *  - Cada cambio se anota en change_log con el valor anterior, para deshacerlo.
 *  - Nada se borra: se archiva.
 */

export type Cambio = {
  id: string;
  table_name: string;
  row_id: string;
  operation: "crear" | "actualizar" | "archivar";
  summary: string;
};

export type Contexto = {
  sb: SupabaseClient;
  sesionId: string;
  hoy: string;
  datos: Instantanea;
  /** Cambios hechos en este turno (los va llenando cada herramienta). */
  cambios: Cambio[];
  /** El usuario pidió terminar la sesión: se cierra cuando el Agente termina de despedirse. */
  terminar?: boolean;
  mensajeId?: string | null;
};

/** Error que se le devuelve al modelo para que corrija (no cuenta como falla del proveedor). */
class ErrorHerramienta extends Error {}
const fallar = (mensaje: string): never => {
  throw new ErrorHerramienta(mensaje);
};

// --- Piezas de esquema -------------------------------------------------------

const id = (que: string) => z.string().min(6).max(40).describe(`Id de ${que}, tal como aparece entre corchetes`);
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usá el formato AAAA-MM-DD")
  .refine((f) => fechaValida(...(f.split("-").map(Number) as [number, number, number])) !== null, "Esa fecha no existe");
/** Para quitar una fecha el modelo manda "ninguna": es más simple que un null. */
const fechaOpcional = z.union([fecha, z.literal("ninguna")]).describe("AAAA-MM-DD, o «ninguna» para quitarla");
const prioridad = z.number().int().min(1).max(4).describe("1 urgente, 2 alta, 3 media, 4 baja");
const texto = (max: number) => z.string().trim().min(1).max(max);

export async function registrar(
  ctx: Contexto,
  c: Omit<Cambio, "id"> & { old_values?: unknown; new_values?: unknown },
): Promise<void> {
  const { data } = await ctx.sb
    .from("change_log")
    .insert({ ...c, session_id: ctx.sesionId, message_id: ctx.mensajeId ?? null })
    .select("id")
    .single();
  ctx.cambios.push({
    id: (data as { id: string } | null)?.id ?? "",
    table_name: c.table_name,
    row_id: c.row_id,
    operation: c.operation,
    summary: c.summary,
  });
}

async function escribir<T>(pedido: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await pedido;
  if (error || !data) fallar("No se pudo guardar en la base. Avisale al usuario y seguí.");
  return data as T;
}

const tareaDe = (ctx: Contexto, x: string): Tarea =>
  buscarPorId(ctx.datos.tareas, x) ?? fallar(`No hay ninguna tarea con id «${x}». Usá buscar_tareas.`);
const proyectoDe = (ctx: Contexto, x: string): Proyecto =>
  buscarPorId(ctx.datos.proyectos, x) ?? fallar(`No hay ningún proyecto con id «${x}».`);

const NOMBRE_ESTADO: Record<string, string> = {
  pendiente: "pendiente", en_curso: "en curso", bloqueada: "bloqueada", hecha: "hecha",
  activo: "activo", pausado: "pausado", completado: "completado", archivado: "archivado",
};

const vistaTarea = (t: Tarea) => ({
  id: corto(t.id),
  titulo: t.title,
  estado: t.status,
  ...(t.due_date ? { vence: t.due_date, fecha_puesta_por: t.due_set_by } : {}),
  prioridad: t.priority,
  ...(t.blocked_reason ? { motivo_bloqueo: t.blocked_reason } : {}),
  ...(t.effort_minutes ? { esfuerzo_minutos: t.effort_minutes } : {}),
});

// --- Definiciones --------------------------------------------------------------

type Herramienta<E extends z.ZodType> = {
  descripcion: string;
  esquema: E;
  ejecutar: (ctx: Contexto, args: z.infer<E>) => Promise<unknown>;
};
const definir = <E extends z.ZodType>(h: Herramienta<E>) => h;

export const HERRAMIENTAS = {
  ver_proyecto: definir({
    descripcion: "Detalle de un proyecto: objetivo, todas sus tareas y lo último de la bitácora.",
    esquema: z.object({ proyecto_id: id("proyecto") }),
    async ejecutar(ctx, a) {
      const p = proyectoDe(ctx, a.proyecto_id);
      const { data: bitacora } = await ctx.sb
        .from("project_log")
        .select("kind,author,content,created_at")
        .eq("project_id", p.id)
        .order("created_at", { ascending: false })
        .limit(5);
      const tareas = ctx.datos.tareas.filter((t) => t.project_id === p.id);
      return {
        id: corto(p.id),
        nombre: p.name,
        objetivo: p.goal,
        descripcion: p.description,
        estado: p.status,
        vence: p.due_date,
        tareas: tareas
          .filter((t) => t.status !== "hecha")
          .map((t) => ({ ...vistaTarea(t), ...(t.parent_id ? { subtarea_de: corto(t.parent_id) } : {}) })),
        hechas: tareas.filter((t) => t.status === "hecha").length,
        bitacora: ((bitacora ?? []) as { kind: string; content: string; created_at: string }[]).map((e) => ({
          tipo: e.kind,
          fecha: e.created_at.slice(0, 10),
          texto: e.content.slice(0, 300),
        })),
      };
    },
  }),

  ver_tarea: definir({
    descripcion: "Detalle de una tarea, con su descripción y sus subtareas.",
    esquema: z.object({ tarea_id: id("tarea") }),
    async ejecutar(ctx, a) {
      const t = tareaDe(ctx, a.tarea_id);
      return {
        ...vistaTarea(t),
        descripcion: t.description,
        proyecto: ctx.datos.proyectos.find((p) => p.id === t.project_id)?.name,
        en_este_estado_desde: t.status_changed_at.slice(0, 10),
        subtareas: ctx.datos.tareas.filter((h) => h.parent_id === t.id).map(vistaTarea),
      };
    },
  }),

  buscar_tareas: definir({
    descripcion: "Busca tareas por palabras del título (incluye las hechas). Usala si no encontrás la tarea en el resumen.",
    esquema: z.object({ texto: texto(80) }),
    async ejecutar(ctx, a) {
      const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const palabras = norm(a.texto).split(/\s+/).filter((p) => p.length > 2);
      const resultado = ctx.datos.tareas
        .map((t) => ({ t, n: palabras.filter((p) => norm(t.title).includes(p)).length }))
        .filter((x) => x.n > 0)
        .sort((x, y) => y.n - x.n)
        .slice(0, 8)
        .map(({ t }) => ({
          ...vistaTarea(t),
          proyecto: ctx.datos.proyectos.find((p) => p.id === t.project_id)?.name,
        }));
      return resultado.length ? resultado : "No hay tareas que coincidan.";
    },
  }),

  crear_tarea: definir({
    descripcion: "Crea una tarea en un proyecto, o una subtarea si pasás tarea_padre_id.",
    esquema: z.object({
      proyecto_id: id("proyecto"),
      titulo: texto(300),
      descripcion: texto(2000).optional(),
      fecha_limite: fecha.optional(),
      prioridad: prioridad.optional(),
      esfuerzo_minutos: z.number().int().min(1).max(100000).optional(),
      tarea_padre_id: id("la tarea de la que es subtarea").optional(),
    }),
    async ejecutar(ctx, a) {
      const p = proyectoDe(ctx, a.proyecto_id);
      const madre = a.tarea_padre_id ? tareaDe(ctx, a.tarea_padre_id) : null;
      if (madre?.parent_id) fallar("Las subtareas no pueden tener subtareas.");
      const fila = {
        project_id: madre?.project_id ?? p.id,
        parent_id: madre?.id ?? null,
        title: a.titulo,
        description: a.descripcion ?? null,
        due_date: a.fecha_limite ?? null,
        due_set_by: a.fecha_limite ? "agente" : null,
        priority: a.prioridad ?? 2,
        effort_minutes: a.esfuerzo_minutos ?? null,
        sort_order: Date.now() / 1000,
      };
      const t = await escribir<Tarea>(ctx.sb.from("tasks").insert(fila).select().single());
      ctx.datos.tareas.push(t);
      await registrar(ctx, {
        table_name: "tasks",
        row_id: t.id,
        operation: "crear",
        summary:
          (madre ? `Nueva subtarea de «${madre.title}»: «${t.title}»` : `Nueva tarea en ${p.name}: «${t.title}»`) +
          (t.due_date ? ` (para ${etiquetaFecha(t.due_date, ctx.hoy).toLowerCase()})` : ""),
        new_values: fila,
      });
      return { ok: true, id: corto(t.id) };
    },
  }),

  actualizar_tarea: definir({
    descripcion:
      "Cambia una tarea: estado, fecha límite, prioridad, motivo de bloqueo, título, descripción o esfuerzo. Mandá solo lo que cambia.",
    esquema: z.object({
      tarea_id: id("tarea"),
      estado: z.enum(["pendiente", "en_curso", "bloqueada", "hecha"]).optional(),
      fecha_limite: fechaOpcional.optional(),
      prioridad: prioridad.optional(),
      motivo_bloqueo: texto(300).optional().describe("Qué la traba. Solo con estado bloqueada."),
      titulo: texto(300).optional(),
      descripcion: texto(2000).optional(),
      esfuerzo_minutos: z.number().int().min(1).max(100000).optional(),
    }),
    async ejecutar(ctx, a) {
      const t = tareaDe(ctx, a.tarea_id);
      const cambios: Partial<Tarea> = {};
      const partes: string[] = [];
      if (a.estado && a.estado !== t.status) {
        cambios.status = a.estado;
        partes.push(NOMBRE_ESTADO[a.estado]);
      }
      if (a.motivo_bloqueo && (a.estado ?? t.status) === "bloqueada" && a.motivo_bloqueo !== t.blocked_reason) {
        cambios.blocked_reason = a.motivo_bloqueo;
        partes.push(`trabada por: ${a.motivo_bloqueo}`);
      }
      if (a.fecha_limite !== undefined) {
        const nueva = a.fecha_limite === "ninguna" ? null : a.fecha_limite;
        if (nueva !== t.due_date) {
          cambios.due_date = nueva;
          cambios.due_set_by = nueva ? "agente" : null;
          partes.push(nueva ? `fecha límite → ${etiquetaFecha(nueva, ctx.hoy).toLowerCase()}` : "sin fecha límite");
        }
      }
      if (a.prioridad && a.prioridad !== t.priority) {
        cambios.priority = a.prioridad;
        partes.push(`prioridad P${a.prioridad}`);
      }
      if (a.titulo && a.titulo !== t.title) {
        cambios.title = a.titulo;
        partes.push(`ahora se llama «${a.titulo}»`);
      }
      if (a.descripcion && a.descripcion !== t.description) {
        cambios.description = a.descripcion;
        partes.push("descripción actualizada");
      }
      if (a.esfuerzo_minutos && a.esfuerzo_minutos !== t.effort_minutes) {
        cambios.effort_minutes = a.esfuerzo_minutos;
        partes.push(`esfuerzo ${a.esfuerzo_minutos} min`);
      }
      if (!partes.length) return { ok: true, nota: "Ya estaba así; no cambió nada." };

      // Se guarda lo anterior de todo lo que el disparador también toca.
      const antes = Object.fromEntries(
        [...Object.keys(cambios), "status", "blocked_reason", "completed_at"].map((k) => [k, t[k as keyof Tarea]]),
      );
      const nueva = await escribir<Tarea>(ctx.sb.from("tasks").update(cambios).eq("id", t.id).select().single());
      Object.assign(t, nueva);
      await registrar(ctx, {
        table_name: "tasks",
        row_id: t.id,
        operation: "actualizar",
        summary: `«${t.title}»: ${partes.join(", ")}`,
        old_values: antes,
        new_values: cambios,
      });
      return { ok: true };
    },
  }),

  archivar_tarea: definir({
    descripcion: "Archiva una tarea que se descarta (no se borra; el usuario puede recuperarla).",
    esquema: z.object({ tarea_id: id("tarea") }),
    async ejecutar(ctx, a) {
      const t = tareaDe(ctx, a.tarea_id);
      const cuando = new Date().toISOString();
      await escribir(
        ctx.sb.from("tasks").update({ archived_at: cuando }).or(`id.eq.${t.id},parent_id.eq.${t.id}`).select("id"),
      );
      ctx.datos.tareas = ctx.datos.tareas.filter((x) => x.id !== t.id && x.parent_id !== t.id);
      await registrar(ctx, {
        table_name: "tasks",
        row_id: t.id,
        operation: "archivar",
        summary: `Archivada: «${t.title}»`,
        old_values: { archived_at: null },
        new_values: { archived_at: cuando },
      });
      return { ok: true };
    },
  }),

  crear_proyecto: definir({
    descripcion: "Crea un proyecto nuevo.",
    esquema: z.object({
      nombre: texto(120),
      objetivo: texto(500).optional().describe("Cómo se sabe que está terminado"),
      area_id: id("área").optional(),
      fecha_limite: fecha.optional(),
      prioridad: prioridad.optional(),
    }),
    async ejecutar(ctx, a) {
      const area = a.area_id
        ? (buscarPorId(ctx.datos.areas, a.area_id) ?? fallar(`No hay ningún área con id «${a.area_id}».`))
        : null;
      const fila = {
        name: a.nombre,
        goal: a.objetivo ?? null,
        area_id: area?.id ?? null,
        due_date: a.fecha_limite ?? null,
        priority: a.prioridad ?? 2,
        sort_order: Date.now() / 1000,
      };
      const p = await escribir<Proyecto>(ctx.sb.from("projects").insert(fila).select().single());
      ctx.datos.proyectos.push(p);
      await registrar(ctx, {
        table_name: "projects",
        row_id: p.id,
        operation: "crear",
        summary: `Nuevo proyecto: «${p.name}»${area ? ` (${area.name})` : ""}`,
        new_values: fila,
      });
      return { ok: true, id: corto(p.id) };
    },
  }),

  actualizar_proyecto: definir({
    descripcion: "Cambia un proyecto: nombre, objetivo, estado, prioridad, fecha límite o área. Mandá solo lo que cambia.",
    esquema: z.object({
      proyecto_id: id("proyecto"),
      nombre: texto(120).optional(),
      objetivo: texto(500).optional(),
      estado: z.enum(["activo", "pausado", "completado", "archivado"]).optional(),
      prioridad: prioridad.optional(),
      fecha_limite: fechaOpcional.optional(),
      area_id: id("área").optional(),
    }),
    async ejecutar(ctx, a) {
      const p = proyectoDe(ctx, a.proyecto_id);
      const cambios: Partial<Proyecto> = {};
      const partes: string[] = [];
      if (a.nombre && a.nombre !== p.name) {
        cambios.name = a.nombre;
        partes.push(`ahora se llama «${a.nombre}»`);
      }
      if (a.objetivo && a.objetivo !== p.goal) {
        cambios.goal = a.objetivo;
        partes.push("objetivo actualizado");
      }
      if (a.estado && a.estado !== p.status) {
        cambios.status = a.estado;
        partes.push(NOMBRE_ESTADO[a.estado]);
      }
      if (a.prioridad && a.prioridad !== p.priority) {
        cambios.priority = a.prioridad;
        partes.push(`prioridad P${a.prioridad}`);
      }
      if (a.fecha_limite !== undefined) {
        const nueva = a.fecha_limite === "ninguna" ? null : a.fecha_limite;
        if (nueva !== p.due_date) {
          cambios.due_date = nueva;
          partes.push(nueva ? `fecha límite → ${etiquetaFecha(nueva, ctx.hoy).toLowerCase()}` : "sin fecha límite");
        }
      }
      if (a.area_id) {
        const area = buscarPorId(ctx.datos.areas, a.area_id) ?? fallar(`No hay ningún área con id «${a.area_id}».`);
        if (area.id !== p.area_id) {
          cambios.area_id = area.id;
          partes.push(`área ${area.name}`);
        }
      }
      if (!partes.length) return { ok: true, nota: "Ya estaba así; no cambió nada." };
      const antes = Object.fromEntries(Object.keys(cambios).map((k) => [k, p[k as keyof Proyecto]]));
      await escribir(ctx.sb.from("projects").update(cambios).eq("id", p.id).select("id").single());
      Object.assign(p, cambios);
      await registrar(ctx, {
        table_name: "projects",
        row_id: p.id,
        operation: cambios.status === "archivado" ? "archivar" : "actualizar",
        summary: `Proyecto «${p.name}»: ${partes.join(", ")}`,
        old_values: antes,
        new_values: cambios,
      });
      return { ok: true };
    },
  }),

  crear_area: definir({
    descripcion: "Crea un área de vida (trabajo, salud, finanzas, estudio, hogar…).",
    esquema: z.object({ nombre: texto(60) }),
    async ejecutar(ctx, a) {
      const existente = ctx.datos.areas.find((x) => x.name.toLowerCase() === a.nombre.toLowerCase());
      if (existente) return { ok: true, id: corto(existente.id), nota: "Ya existía." };
      const COLORES = ["#6ea8fe", "#4cc38a", "#e0a84a", "#d98ad0", "#ff8f6b", "#5fc7c7", "#a99cf5", "#8b8b94"];
      const fila = {
        name: a.nombre,
        color: COLORES[ctx.datos.areas.length % COLORES.length],
        sort_order: Date.now() / 1000,
      };
      const area = await escribir<Instantanea["areas"][number]>(ctx.sb.from("areas").insert(fila).select().single());
      ctx.datos.areas.push(area);
      await registrar(ctx, {
        table_name: "areas",
        row_id: area.id,
        operation: "crear",
        summary: `Nueva área: ${area.name}`,
        new_values: fila,
      });
      return { ok: true, id: corto(area.id) };
    },
  }),

  anotar_bitacora: definir({
    descripcion: "Deja una entrada en la bitácora de un proyecto: un avance, una decisión o una nota.",
    esquema: z.object({
      proyecto_id: id("proyecto"),
      tipo: z.enum(["nota", "avance", "decision"]),
      contenido: texto(2000),
    }),
    async ejecutar(ctx, a) {
      const p = proyectoDe(ctx, a.proyecto_id);
      const fila = { project_id: p.id, kind: a.tipo, author: "agente", session_id: ctx.sesionId, content: a.contenido };
      const e = await escribir<{ id: string }>(ctx.sb.from("project_log").insert(fila).select("id").single());
      await registrar(ctx, {
        table_name: "project_log",
        row_id: e.id,
        operation: "crear",
        summary: `Bitácora de ${p.name}: ${a.contenido.slice(0, 80)}`,
        new_values: fila,
      });
      return { ok: true };
    },
  }),

  guardar_memoria: definir({
    descripcion:
      "Guarda algo duradero del usuario (cómo trabaja, qué lo frena, qué le sirvió). Para corregir una, pasá memoria_id.",
    esquema: z.object({
      categoria: z.enum([
        "rutina", "preferencia", "objetivo", "obstaculo_recurrente", "solucion_que_funciono", "contexto_personal",
      ]),
      contenido: texto(500),
      memoria_id: id("memoria").optional(),
    }),
    async ejecutar(ctx, a) {
      return guardarMemoria(ctx, a);
    },
  }),

  terminar_sesion: definir({
    descripcion:
      "Cierra la sesión si el usuario lo pide. Después, despedite en una frase.",
    esquema: z.object({}),
    async ejecutar(ctx) {
      ctx.terminar = true;
      return { ok: true, nota: "Se cierra al terminar esta respuesta. Despedite en una frase." };
    },
  }),

  reprogramar_llamada: definir({
    descripcion: "Mueve una llamada programada a otro día y hora (hora local del usuario).",
    esquema: z.object({
      llamada_id: id("llamada"),
      fecha: fecha,
      hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usá HH:MM en 24 horas"),
    }),
    async ejecutar(ctx, a) {
      const { instanteLocal } = await import("@/lib/programacion/horarios");
      const s = buscarPorId(ctx.datos.proximas, a.llamada_id) ?? fallar(`No hay ninguna llamada pendiente con id «${a.llamada_id}».`);
      const cuando = instanteLocal(a.fecha, a.hora, ctx.datos.perfil.timezone);
      if (cuando.getTime() < Date.now()) fallar("Ese horario ya pasó.");
      const antes = { scheduled_at: s.scheduled_at, status: s.status, notified_at: s.notified_at };
      const cambios = { scheduled_at: cuando.toISOString(), status: "programada", notified_at: null };
      await escribir(ctx.sb.from("sessions").update(cambios).eq("id", s.id).select("id").single());
      Object.assign(s, cambios);
      await registrar(ctx, {
        table_name: "sessions",
        row_id: s.id,
        operation: "actualizar",
        summary: `Llamada movida al ${etiquetaFecha(a.fecha, ctx.hoy).toLowerCase()} a las ${a.hora}`,
        old_values: antes,
        new_values: cambios,
      });
      return { ok: true };
    },
  }),

  actualizar_rutina: definir({
    descripcion: "Cambia una rutina de llamadas: días (0 domingo … 6 sábado), hora local o si está activa.",
    esquema: z.object({
      rutina_id: id("rutina"),
      dias: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
      hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
      activa: z.boolean().optional(),
    }),
    async ejecutar(ctx, a) {
      const r = buscarPorId(ctx.datos.rutinas, a.rutina_id) ?? fallar(`No hay ninguna rutina con id «${a.rutina_id}».`);
      const cambios: Record<string, unknown> = {};
      const partes: string[] = [];
      const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
      if (a.dias) {
        cambios.weekdays = [...new Set(a.dias)].sort();
        partes.push(`días ${a.dias.map((d) => DIAS[d]).join(", ")}`);
      }
      if (a.hora && a.hora !== r.local_time.slice(0, 5)) {
        cambios.local_time = a.hora;
        partes.push(`a las ${a.hora}`);
      }
      if (a.activa !== undefined && a.activa !== r.active) {
        cambios.active = a.activa;
        partes.push(a.activa ? "activada" : "pausada");
      }
      if (!partes.length) return { ok: true, nota: "Ya estaba así." };
      const antes = Object.fromEntries(Object.keys(cambios).map((k) => [k, r[k as keyof typeof r]]));
      await escribir(ctx.sb.from("call_routines").update(cambios).eq("id", r.id).select("id").single());
      Object.assign(r, cambios);
      await registrar(ctx, {
        table_name: "call_routines",
        row_id: r.id,
        operation: "actualizar",
        summary: `Rutina «${r.name}»: ${partes.join(", ")}`,
        old_values: antes,
        new_values: cambios,
      });
      return { ok: true, nota: "Vale para las llamadas que todavía no se programaron." };
    },
  }),
} as const;

export type NombreHerramienta = keyof typeof HERRAMIENTAS;

/** Guarda o actualiza una memoria sin duplicar y sin pisar lo que editó el usuario. */
export async function guardarMemoria(
  ctx: Contexto,
  a: { categoria: string; contenido: string; memoria_id?: string },
): Promise<unknown> {
  const norm = (s: string) => s.normalize("NFD").replace(/[^\p{L}\p{N} ]/gu, "").toLowerCase().trim();
  const igual = ctx.datos.memorias.find((m) => norm(m.content) === norm(a.contenido));
  if (igual) return { ok: true, id: corto(igual.id), nota: "Ya lo tenía guardado." };

  const existente = a.memoria_id ? buscarPorId(ctx.datos.memorias, a.memoria_id) : null;
  if (existente && !existente.edited_by_user) {
    const antes = { content: existente.content, category: existente.category };
    const cambios = { content: a.contenido, category: a.categoria };
    await escribir(ctx.sb.from("memories").update(cambios).eq("id", existente.id).select("id").single());
    Object.assign(existente, cambios);
    await registrar(ctx, {
      table_name: "memories",
      row_id: existente.id,
      operation: "actualizar",
      summary: `Lo que sé de vos, actualizado: ${a.contenido.slice(0, 90)}`,
      old_values: antes,
      new_values: cambios,
    });
    return { ok: true, id: corto(existente.id) };
  }
  // Si la editó el usuario no se pisa: lo nuevo queda como una memoria aparte.
  const fila = { category: a.categoria, content: a.contenido, source_session_id: ctx.sesionId };
  const m = await escribir<Memoria>(ctx.sb.from("memories").insert(fila).select().single());
  ctx.datos.memorias.unshift(m);
  await registrar(ctx, {
    table_name: "memories",
    row_id: m.id,
    operation: "crear",
    summary: `Lo que sé de vos: ${a.contenido.slice(0, 90)}`,
    new_values: fila,
  });
  return { ok: true, id: corto(m.id) };
}

/** Las herramientas en el formato neutro que cada adaptador traduce al suyo. */
export function definiciones(nombres?: NombreHerramienta[]): DefHerramienta[] {
  return (Object.keys(HERRAMIENTAS) as NombreHerramienta[])
    .filter((n) => !nombres || nombres.includes(n))
    .map((nombre) => {
      const esquema = z.toJSONSchema(HERRAMIENTAS[nombre].esquema) as Record<string, unknown>;
      // Se quita lo que algunos proveedores rechazan y no aporta.
      delete esquema.$schema;
      delete esquema.additionalProperties;
      return { nombre, descripcion: HERRAMIENTAS[nombre].descripcion, parametros: esquema };
    });
}

export type ResultadoHerramienta =
  | { clase: "ok"; resultado: unknown }
  | { clase: "invalida"; resultado: { error: string } } // argumentos mal formados
  | { clase: "error"; resultado: { error: string } }; // bien formados, pero no se pudo

/** Revisa nombre y argumentos sin ejecutar nada. Devuelve el problema, o null si está bien. */
export function validarLlamada(nombre: string, argumentos: unknown): string | null {
  const h = HERRAMIENTAS[nombre as NombreHerramienta] as Herramienta<z.ZodType> | undefined;
  if (!h) return `No existe la herramienta «${nombre}».`;
  const leido = h.esquema.safeParse(argumentos);
  if (leido.success) return null;
  const detalle = leido.error.issues
    .slice(0, 4)
    .map((i) => `${i.path.join(".") || "argumentos"}: ${i.message}`)
    .join("; ");
  return `Argumentos inválidos (${detalle}). Corregilos y probá de nuevo.`;
}

export async function ejecutarHerramienta(
  ctx: Contexto,
  nombre: string,
  argumentos: unknown,
): Promise<ResultadoHerramienta> {
  const problema = validarLlamada(nombre, argumentos);
  if (problema) return { clase: "invalida", resultado: { error: problema } };
  const h = HERRAMIENTAS[nombre as NombreHerramienta] as Herramienta<z.ZodType>;
  const leido = { data: h.esquema.parse(argumentos) };
  try {
    return { clase: "ok", resultado: await h.ejecutar(ctx, leido.data) };
  } catch (error) {
    if (error instanceof ErrorHerramienta) return { clase: "error", resultado: { error: error.message } };
    return { clase: "error", resultado: { error: "Falló la herramienta. Avisale al usuario y seguí." } };
  }
}
