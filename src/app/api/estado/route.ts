import { NextResponse } from "next/server";
import { MODELOS_POR_DEFECTO } from "@/lib/agente/claude/config";
import { hayClaveClaude, NOMBRES_PROVEEDOR, proveedoresEnOrden } from "@/lib/agente/proveedores/indice";
import { integracionLista } from "@/lib/integraciones";
import { esAdministrador } from "@/lib/seguridad/permitidos";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { usuarioActual } from "@/lib/supabase/server";
import { cuposDe } from "@/lib/voz/cupo";

/**
 * Qué funciones están disponibles en este despliegue. Solo sí o no: nunca
 * valores. El detalle (proveedores, modelos, programador, cupos) es solo para
 * los correos de CLAUDE_USUARIOS_PERMITIDOS; el resto recibe lo justo para que
 * la app funcione.
 */
export async function GET() {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const proveedores = proveedoresEnOrden(undefined, { modelos: MODELOS_POR_DEFECTO });
  const basico = {
    detalle: false,
    agente: proveedores.length > 0,
    azure: integracionLista("azure"),
    push: integracionLista("push"),
    // La clave pública VAPID es pública por diseño: el navegador la necesita para suscribirse.
    vapid: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  };
  if (!esAdministrador(usuario.email)) {
    return NextResponse.json({ ...basico, claude: false, proveedores: [], cron: false, servicio: false });
  }

  let usoVoz: { stt_seconds: number; tts_chars: number } | null = null;
  const admin = supabaseAdmin();
  if (admin && basico.azure) {
    const { data } = await admin.rpc("uso_voz_global", { p_month: new Date().toISOString().slice(0, 7) + "-01" });
    const fila = (Array.isArray(data) ? data[0] : data) as { stt_seconds: number | string; tts_chars: number | string } | null;
    if (fila) usoVoz = { stt_seconds: Number(fila.stt_seconds), tts_chars: Number(fila.tts_chars) };
  }
  return NextResponse.json({
    ...basico,
    detalle: true,
    // Para mostrar qué está configurado: Claude aparece si hay clave, sin mirar el presupuesto.
    proveedores: proveedores.map((p) => ({ id: p.id, nombre: NOMBRES_PROVEEDOR[p.id] ?? p.id, modelo: p.modelo() })),
    claude: hayClaveClaude() && Boolean(admin),
    cron: integracionLista("cron"),
    servicio: integracionLista("servicio"),
    cupos: cuposDe(process.env),
    usoVoz,
  });
}
