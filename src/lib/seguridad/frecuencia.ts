import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Límite de frecuencia por usuario en los endpoints que gastan (modelos,
 * Azure, push). Se cuenta en la base con una función atómica que solo puede
 * llamar la clave de servicio: funciona en Vercel aunque cada pedido corra en
 * una instancia distinta, y nadie se lo puede resetear desde el navegador.
 *
 * Cada límite se cambia con una variable LIMITE_<CLAVE> = "por minuto/por día",
 * por ejemplo LIMITE_TURNO="20/600".
 */
export const LIMITES = {
  turno: { porMinuto: 20, porDia: 600 },
  claude_probar: { porMinuto: 3, porDia: 20 },
  cerrar: { porMinuto: 10, porDia: 150 },
  voz_token: { porMinuto: 6, porDia: 60 },
  voz_uso: { porMinuto: 10, porDia: 2000 },
  push_probar: { porMinuto: 3, porDia: 20 },
} as const;
export type ClaveLimite = keyof typeof LIMITES;

export function limiteDe(clave: ClaveLimite, env: Record<string, string | undefined> = process.env) {
  const base = LIMITES[clave];
  const crudo = (env[`LIMITE_${clave.toUpperCase()}`] ?? "").trim();
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(crudo);
  if (!m) return { ...base };
  const porMinuto = Number(m[1]);
  const porDia = Number(m[2]);
  return porMinuto > 0 && porDia > 0 ? { porMinuto, porDia } : { ...base };
}

export type ResultadoLimite = { permitido: true } | { permitido: false; motivo: "minuto" | "dia" | "sin_servicio" };

export async function consumirLimite(
  admin: SupabaseClient | null,
  usuarioId: string,
  clave: ClaveLimite,
  env: Record<string, string | undefined> = process.env,
): Promise<ResultadoLimite> {
  // Sin la clave de servicio no se puede contar: se cierra (lo que gasta no anda).
  if (!admin) return { permitido: false, motivo: "sin_servicio" };
  const { porMinuto, porDia } = limiteDe(clave, env);
  const { data, error } = await admin.rpc("consumir_limite", {
    p_user: usuarioId,
    p_clave: clave,
    p_por_minuto: porMinuto,
    p_por_dia: porDia,
  });
  if (error) return { permitido: false, motivo: "sin_servicio" };
  const fila = (Array.isArray(data) ? data[0] : data) as { permitido: boolean; en_dia: number } | null;
  if (!fila || fila.permitido) return { permitido: true };
  return { permitido: false, motivo: fila.en_dia > porDia ? "dia" : "minuto" };
}

export const MENSAJE_LIMITE = {
  minuto: "Vas muy rápido: esperá un minuto y probá de nuevo.",
  dia: "Llegaste al límite de uso de hoy. Mañana se renueva.",
  sin_servicio: "Falta configurar la clave de servicio de Supabase en el servidor.",
} as const;

/**
 * Para usar al principio de un endpoint: devuelve la respuesta 429 (o 503 si
 * falta la clave de servicio) cuando no hay que atender el pedido, o null.
 */
export async function frenarSiHaceFalta(
  usuarioId: string,
  clave: ClaveLimite,
  admin: SupabaseClient | null = supabaseAdmin(),
): Promise<NextResponse | null> {
  const r = await consumirLimite(admin, usuarioId, clave);
  if (r.permitido) return null;
  if (r.motivo === "sin_servicio") {
    return NextResponse.json({ error: MENSAJE_LIMITE.sin_servicio, motivo: "sin_servicio" }, { status: 503 });
  }
  const segundos = r.motivo === "minuto" ? 60 - new Date().getUTCSeconds() : 3600;
  return NextResponse.json(
    { error: MENSAJE_LIMITE[r.motivo], motivo: "limite", ventana: r.motivo },
    { status: 429, headers: { "Retry-After": String(segundos) } },
  );
}
