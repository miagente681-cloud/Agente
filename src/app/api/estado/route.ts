import { NextResponse } from "next/server";
import { NOMBRES_PROVEEDOR, proveedoresEnOrden } from "@/lib/agente/proveedores/indice";
import { integracionLista } from "@/lib/integraciones";
import { usuarioActual } from "@/lib/supabase/server";

/** Qué funciones están disponibles en este despliegue. Solo sí o no: nunca valores. */
export async function GET() {
  if (!(await usuarioActual())) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const proveedores = proveedoresEnOrden().map((p) => ({
    id: p.id,
    nombre: NOMBRES_PROVEEDOR[p.id] ?? p.id,
    modelo: p.modelo(),
  }));
  return NextResponse.json({
    agente: proveedores.length > 0,
    proveedores,
    azure: integracionLista("azure"),
    push: integracionLista("push"),
    cron: integracionLista("cron"),
    servicio: integracionLista("servicio"),
    vapid: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  });
}
