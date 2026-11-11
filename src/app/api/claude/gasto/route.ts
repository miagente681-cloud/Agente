import { NextResponse } from "next/server";
import { configClaude, topeGlobalDe } from "@/lib/agente/claude/config";
import { gastoDelMes, mesDe } from "@/lib/agente/claude/presupuesto";
import { puedeUsarClaude } from "@/lib/seguridad/permitidos";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";

export type GastoClaude = {
  mes: string;
  propio: number;
  global: number;
  /** El tope de la persona (el del perfil, nunca más que el global). */
  tope: number;
  topeGlobal: number;
  desglose: { uso: string; model: string; total: number }[];
};

/**
 * Gasto de Claude del mes para el panel. Lo suma la base (sin límite de
 * filas) con la clave de servicio, que es la única que escribe el registro.
 */
export async function GET() {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const admin = supabaseAdmin();
  if (!admin || !puedeUsarClaude(usuario.email)) return NextResponse.json({ error: "No disponible" }, { status: 403 });
  const sb = await supabaseServer();
  const { data: perfil } = await sb.from("profiles").select("timezone,agent_config").eq("user_id", usuario.id).maybeSingle();
  const p = perfil as { timezone: string; agent_config: Record<string, unknown> } | null;
  if (!p) return NextResponse.json({ error: "Sin perfil" }, { status: 404 });
  const mes = mesDe(new Date(), p.timezone);
  const topeGlobal = topeGlobalDe();
  const [gasto, desglose] = await Promise.all([
    gastoDelMes(admin, usuario.id, mes),
    admin.rpc("gasto_claude_desglose", { p_user: usuario.id, p_mes: mes }),
  ]);
  const respuesta: GastoClaude = {
    mes,
    propio: Number.isFinite(gasto.propio) ? gasto.propio : 0,
    global: Number.isFinite(gasto.global) ? gasto.global : 0,
    tope: configClaude(p.agent_config, topeGlobal).topeUSD,
    topeGlobal,
    desglose: ((desglose.data ?? []) as { uso: string; model: string; total: number | string }[]).map((d) => ({
      uso: d.uso,
      model: d.model,
      total: Number(d.total),
    })),
  };
  return NextResponse.json(respuesta, { headers: { "Cache-Control": "no-store" } });
}
