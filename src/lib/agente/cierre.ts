import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fechaValida } from "@/lib/datos/fechas";
import { partesEnZona } from "@/lib/programacion/horarios";
import { buscarPorId, corto, leerInstantanea, type Sesion } from "./datos";
import { guardarMemoria, registrar, type Contexto } from "./herramientas";
import { completar } from "./runner";
import type { ProveedorLLM } from "./tipos";

/**
 * Lo que pasa al terminar una sesión: un proceso aparte (con el modelo
 * liviano) lee la transcripción y deja el resumen, los compromisos, lo que
 * aprendió de la persona y una entrada en la bitácora de cada proyecto tratado.
 * Si el modelo no está disponible la sesión se cierra igual, sin resumen, y
 * se puede generar después.
 */

const esFecha = (f: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(f) && fechaValida(...(f.split("-").map(Number) as [number, number, number])) !== null;

const Salida = z.object({
  resumen: z.string().trim().min(1).max(1500),
  compromisos: z
    .array(z.object({ texto: z.string().trim().min(1).max(300), fecha: z.string().nullish() }))
    .max(12)
    .default([]),
  memorias: z
    .array(
      z.object({
        categoria: z.enum([
          "rutina", "preferencia", "objetivo", "obstaculo_recurrente", "solucion_que_funciono", "contexto_personal",
        ]),
        contenido: z.string().trim().min(1).max(500),
        memoria_id: z.string().nullish(),
      }),
    )
    .max(8)
    .default([]),
  bitacora: z
    .array(z.object({ proyecto_id: z.string(), texto: z.string().trim().min(1).max(800) }))
    .max(8)
    .default([]),
});

const INSTRUCCIONES = `Sos el proceso que archiva una sesión entre una persona y su asistente de proyectos. Leé la transcripción y respondé SOLO con un objeto JSON, sin texto antes ni después, con esta forma:
{
  "resumen": "qué se trató y en qué quedó, en 2 a 5 oraciones, en segunda persona (\\"quedaste en…\\")",
  "compromisos": [{"texto": "lo que la persona se comprometió a hacer", "fecha": "AAAA-MM-DD o null"}],
  "memorias": [{"categoria": "rutina|preferencia|objetivo|obstaculo_recurrente|solucion_que_funciono|contexto_personal", "contenido": "una frase", "memoria_id": "id de la memoria que actualiza, o null"}],
  "bitacora": [{"proyecto_id": "id del proyecto", "texto": "qué se avanzó o decidió sobre ese proyecto en esta sesión"}]
}
Reglas para las memorias: solo cosas duraderas sobre la persona (qué la frena, a qué hora rinde, qué soluciones le funcionaron o no, cómo le gusta trabajar). Nada de tareas puntuales ni del estado de un proyecto. Si una memoria existente dice lo mismo, no la repitas; si la nueva información la corrige o la completa, usá su memoria_id. Si no aprendiste nada nuevo, dejá la lista vacía.
Bitácora: solo proyectos de los que se habló de verdad. Usá los ids tal como figuran.`;

function extraerJSON(texto: string): unknown {
  const desde = texto.indexOf("{");
  const hasta = texto.lastIndexOf("}");
  if (desde === -1 || hasta <= desde) return null;
  try {
    return JSON.parse(texto.slice(desde, hasta + 1));
  } catch {
    return null;
  }
}

export async function cerrarSesion(p: {
  sb: SupabaseClient;
  sesionId: string;
  proveedores: ProveedorLLM[];
  ahora?: Date;
}): Promise<{ ok: boolean; resumen: string | null }> {
  const { sb } = p;
  const ahora = p.ahora ?? new Date();
  const { data } = await sb.from("sessions").select("*").eq("id", p.sesionId).maybeSingle();
  const sesion = data as Sesion | null;
  if (!sesion) return { ok: false, resumen: null };
  if (sesion.status === "completada" && sesion.summary) return { ok: true, resumen: sesion.summary };

  const cierre: Record<string, unknown> = {
    status: "completada",
    ended_at: sesion.ended_at ?? ahora.toISOString(),
  };

  const { data: filas } = await sb
    .from("messages")
    .select("role,content,created_at")
    .eq("session_id", sesion.id)
    .in("role", ["usuario", "agente"])
    .order("created_at")
    .limit(400);
  const mensajes = ((filas ?? []) as { role: string; content: string | null }[]).filter((m) => m.content);

  // Sin nada dicho por la persona no hay qué resumir ni qué aprender.
  if (!mensajes.some((m) => m.role === "usuario")) {
    await sb.from("sessions").update(cierre).eq("id", sesion.id);
    return { ok: true, resumen: null };
  }

  const datos = await leerInstantanea(sb, sesion.id);
  const { data: cambios } = await sb
    .from("change_log")
    .select("summary")
    .eq("session_id", sesion.id)
    .is("undone_at", null)
    .order("created_at")
    .limit(60);

  const transcripcion = mensajes
    .map((m) => `${m.role === "usuario" ? "Persona" : "Asistente"}: ${m.content}`)
    .join("\n")
    .slice(-14_000);
  const entrada = [
    `Fecha de hoy: ${partesEnZona(ahora, datos.perfil.timezone).fecha}`,
    "Proyectos: " + (datos.proyectos.map((x) => `[${corto(x.id)}] ${x.name}`).join(", ") || "ninguno"),
    "Memorias que ya existen:\n" +
      (datos.memorias.map((m) => `[${corto(m.id)}] (${m.category}) ${m.content}`).join("\n") || "ninguna"),
    "Cambios aplicados durante la sesión:\n" +
      (((cambios ?? []) as { summary: string }[]).map((c) => `- ${c.summary}`).join("\n") || "ninguno"),
    (sesion.history_summary ? `Resumen de la primera parte:\n${sesion.history_summary}\n\n` : "") +
      `Transcripción:\n${transcripcion}`,
  ].join("\n\n");

  const respuesta = await completar(p.proveedores, {
    liviano: true,
    sistema: INSTRUCCIONES,
    mensajes: [{ rol: "usuario", texto: entrada }],
  });
  const leido = Salida.safeParse(respuesta ? extraerJSON(respuesta) : null);

  if (!leido.success) {
    // Se cierra igual. El resumen queda pendiente y se puede pedir de nuevo.
    await sb.from("sessions").update(cierre).eq("id", sesion.id);
    if (sesion.kind === "onboarding") await sb.from("profiles").update({ onboarding_done: true }).eq("user_id", datos.perfil.user_id);
    return { ok: true, resumen: null };
  }

  const ctx: Contexto = {
    sb,
    sesionId: sesion.id,
    hoy: partesEnZona(ahora, datos.perfil.timezone).fecha,
    datos,
    cambios: [],
  };
  for (const m of leido.data.memorias) {
    await guardarMemoria(ctx, { categoria: m.categoria, contenido: m.contenido, memoria_id: m.memoria_id ?? undefined }).catch(() => null);
  }
  for (const e of leido.data.bitacora) {
    const proyecto = buscarPorId(datos.proyectos, e.proyecto_id);
    if (!proyecto) continue;
    const fila = { project_id: proyecto.id, kind: "resumen_llamada", author: "agente", session_id: sesion.id, content: e.texto };
    const { data: creada } = await sb.from("project_log").insert(fila).select("id").single();
    if (creada) {
      await registrar(ctx, {
        table_name: "project_log",
        row_id: (creada as { id: string }).id,
        operation: "crear",
        summary: `Bitácora de ${proyecto.name}: ${e.texto.slice(0, 80)}`,
        new_values: fila,
      });
    }
  }

  cierre.summary = leido.data.resumen;
  cierre.commitments = leido.data.compromisos.map((c) => ({
    texto: c.texto,
    fecha: c.fecha && esFecha(c.fecha) ? c.fecha : null,
  }));
  await sb.from("sessions").update(cierre).eq("id", sesion.id);
  if (sesion.kind === "onboarding") await sb.from("profiles").update({ onboarding_done: true }).eq("user_id", datos.perfil.user_id);
  return { ok: true, resumen: leido.data.resumen };
}
