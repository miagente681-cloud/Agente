import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deshace un cambio del Agente usando lo que quedó en el registro de cambios.
 * Corre con la sesión del usuario (desde el navegador): RLS garantiza que solo
 * se toque lo propio.
 */

type FilaCambio = {
  id: string;
  table_name: string;
  row_id: string;
  operation: "crear" | "actualizar" | "archivar";
  old_values: Record<string, unknown> | null;
  undone_at: string | null;
};

const TABLAS = ["tasks", "projects", "areas", "memories", "project_log", "sessions", "call_routines"];

export async function deshacerCambio(sb: SupabaseClient, cambioId: string): Promise<{ ok: boolean; mensaje?: string }> {
  const { data } = await sb
    .from("change_log")
    .select("id,table_name,row_id,operation,old_values,undone_at")
    .eq("id", cambioId)
    .maybeSingle();
  const c = data as FilaCambio | null;
  if (!c || !TABLAS.includes(c.table_name)) return { ok: false, mensaje: "No se encontró ese cambio." };
  if (c.undone_at) return { ok: true };

  const ahora = new Date().toISOString();
  let error: unknown = null;

  if (c.operation === "crear") {
    // Lo que creó el Agente no se borra: se archiva (salvo una nota de bitácora,
    // que no tiene dónde archivarse).
    if (c.table_name === "tasks") {
      ({ error } = await sb.from("tasks").update({ archived_at: ahora }).or(`id.eq.${c.row_id},parent_id.eq.${c.row_id}`));
    } else if (c.table_name === "projects") {
      ({ error } = await sb.from("projects").update({ status: "archivado" }).eq("id", c.row_id));
    } else if (c.table_name === "project_log") {
      ({ error } = await sb.from("project_log").delete().eq("id", c.row_id));
    } else {
      ({ error } = await sb.from(c.table_name).update({ archived_at: ahora }).eq("id", c.row_id));
    }
  } else {
    const anteriores = c.old_values ?? {};
    if (!Object.keys(anteriores).length) return { ok: false, mensaje: "Este cambio no guardó el valor anterior." };
    let pedido = sb.from(c.table_name).update(anteriores);
    // Desarchivar una tarea trae de vuelta también sus subtareas.
    pedido =
      c.table_name === "tasks" && "archived_at" in anteriores
        ? pedido.or(`id.eq.${c.row_id},parent_id.eq.${c.row_id}`)
        : pedido.eq("id", c.row_id);
    ({ error } = await pedido);
  }
  if (error) return { ok: false, mensaje: "No se pudo deshacer. Probá de nuevo." };

  await sb.from("change_log").update({ undone_at: ahora }).eq("id", c.id);
  return { ok: true };
}
