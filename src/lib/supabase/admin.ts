import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

let cliente: SupabaseClient | null | undefined;

/**
 * Cliente con la clave de servicio: saltea RLS. Solo para lo que el usuario no
 * puede hacer por sí mismo (programador de llamadas, contador de voz, borrar
 * la cuenta). Devuelve null si la clave no está cargada.
 */
export function supabaseAdmin(): SupabaseClient | null {
  if (cliente === undefined) {
    const clave = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
    cliente =
      clave && SUPABASE_URL
        ? createClient(SUPABASE_URL, clave, { auth: { persistSession: false, autoRefreshToken: false } })
        : null;
  }
  return cliente;
}
