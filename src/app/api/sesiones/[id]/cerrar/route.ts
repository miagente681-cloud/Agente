import { NextResponse, type NextRequest } from "next/server";
import { cerrarSesion } from "@/lib/agente/cierre";
import { prepararProveedores } from "@/lib/agente/claude/servidor";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";

export const maxDuration = 120;

/** Termina una sesión: la marca como completada y genera resumen, compromisos y memorias. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await usuarioActual())) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });
  const sb = await supabaseServer();
  const { data: sesion } = await sb.from("sessions").select("providers_used").eq("id", id).maybeSingle();
  const { proveedores } = await prepararProveedores(sb, {
    sesionId: id,
    // Si la sesión se hizo con Claude, el resumen también, aunque se haya llegado al tope.
    sesionYaUsoClaude: ((sesion as { providers_used?: string[] } | null)?.providers_used ?? []).includes("claude"),
  });
  const resultado = await cerrarSesion({ sb, sesionId: id, proveedores });
  if (!resultado.ok) return NextResponse.json({ error: "No existe esa sesión" }, { status: 404 });
  return NextResponse.json(resultado);
}
