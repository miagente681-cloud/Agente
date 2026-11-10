import { NextResponse, type NextRequest } from "next/server";
import { cerrarSesion } from "@/lib/agente/cierre";
import { proveedoresEnOrden } from "@/lib/agente/proveedores/indice";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";

export const maxDuration = 120;

/** Termina una sesión: la marca como completada y genera resumen, compromisos y memorias. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await usuarioActual())) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });
  const sb = await supabaseServer();
  const { data: perfil } = await sb.from("profiles").select("agent_config").maybeSingle();
  const config = (perfil?.agent_config ?? {}) as Record<string, unknown>;
  const resultado = await cerrarSesion({
    sb,
    sesionId: id,
    proveedores: proveedoresEnOrden(config.orden_proveedores),
  });
  if (!resultado.ok) return NextResponse.json({ error: "No existe esa sesión" }, { status: 404 });
  return NextResponse.json(resultado);
}
