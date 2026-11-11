import { NextResponse } from "next/server";
import { MODELOS_POR_DEFECTO } from "@/lib/agente/claude/config";
import { hayClaveClaude, NOMBRES_PROVEEDOR, proveedoresEnOrden } from "@/lib/agente/proveedores/indice";
import { integracionLista } from "@/lib/integraciones";
import { usuarioActual } from "@/lib/supabase/server";
import { cuposDe } from "@/lib/voz/cupo";

/** Qué funciones están disponibles en este despliegue. Solo sí o no: nunca valores. */
export async function GET() {
  if (!(await usuarioActual())) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  // Para mostrar qué está configurado: Claude aparece si hay clave, sin mirar el presupuesto.
  const proveedores = proveedoresEnOrden(undefined, { modelos: MODELOS_POR_DEFECTO }).map((p) => ({
    id: p.id,
    nombre: NOMBRES_PROVEEDOR[p.id] ?? p.id,
    modelo: p.modelo(),
  }));
  return NextResponse.json({
    agente: proveedores.length > 0,
    proveedores,
    claude: hayClaveClaude(),
    azure: integracionLista("azure"),
    push: integracionLista("push"),
    cron: integracionLista("cron"),
    servicio: integracionLista("servicio"),
    vapid: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
    cupos: cuposDe(process.env),
  });
}
