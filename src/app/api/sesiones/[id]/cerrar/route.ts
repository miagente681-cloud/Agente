import { NextResponse, type NextRequest } from "next/server";
import { cerrarSesion } from "@/lib/agente/cierre";
import { prepararProveedores } from "@/lib/agente/claude/servidor";
import { frenarSiHaceFalta } from "@/lib/seguridad/frecuencia";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";

export const maxDuration = 120;

/** Termina una sesión: la marca como completada y genera resumen, compromisos y memorias. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });
  const admin = supabaseAdmin();
  const frenado = await frenarSiHaceFalta(usuario.id, "cerrar", admin);
  if (frenado) return frenado;
  const sb = await supabaseServer();
  // Si la sesión se hizo con Claude, el resumen también (dentro del margen del tope).
  const { proveedores } = await prepararProveedores(sb, { usuario, sesionId: id, admin });
  const resultado = await cerrarSesion({ sb, sesionId: id, proveedores });
  if (!resultado.ok) return NextResponse.json({ error: "No existe esa sesión" }, { status: 404 });
  return NextResponse.json(resultado);
}
