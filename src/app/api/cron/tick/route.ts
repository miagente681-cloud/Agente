import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { correrTick } from "@/lib/programacion/tick";
import { emisorPush } from "@/lib/push/servidor";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const huella = (s: string) => createHash("sha256").update(s).digest();

/**
 * El programador: lo llama pg_cron de Supabase una vez por minuto. No usa la
 * sesión de nadie (el proxy no lo intercepta): se protege con CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  const secreto = (process.env.CRON_SECRET ?? "").trim();
  const admin = supabaseAdmin();
  if (!secreto || !admin) {
    return NextResponse.json({ error: "Falta configurar CRON_SECRET o la clave de servicio" }, { status: 503 });
  }
  const recibido = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Se comparan huellas del mismo largo, en tiempo constante.
  if (!timingSafeEqual(huella(recibido), huella(secreto))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const resumen = await correrTick({ admin, ahora: new Date(), enviar: emisorPush() });
  return NextResponse.json({ ok: true, ...resumen });
}
