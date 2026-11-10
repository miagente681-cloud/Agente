import { NextResponse } from "next/server";
import { integracionLista } from "@/lib/integraciones";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";
import { cuposDe, evaluarCupo } from "@/lib/voz/cupo";
import { VOCES, VOZ_POR_DEFECTO, type RespuestaToken } from "@/lib/voz/tipos";

const responder = (r: RespuestaToken) => NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });

/**
 * Entrega un token de Azure Speech de corta duración. La clave nunca sale del
 * servidor. Si el cupo gratuito del mes se agotó, deja de entregar: la llamada
 * sigue con la voz del navegador o por texto.
 */
export async function POST() {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const admin = supabaseAdmin();
  if (!integracionLista("azure") || !admin) return responder({ azure: false, motivo: "sin_configurar" });

  const mes = new Date().toISOString().slice(0, 7) + "-01";
  const { data: uso } = await admin
    .from("voice_usage")
    .select("stt_seconds,tts_chars")
    .eq("user_id", usuario.id)
    .eq("month", mes)
    .maybeSingle();
  const cupo = evaluarCupo(uso as { stt_seconds: number; tts_chars: number } | null, cuposDe(process.env));
  if (cupo.agotado) return responder({ azure: false, motivo: "agotado" });

  const region = (process.env.AZURE_SPEECH_REGION ?? "").trim();
  const base = (process.env.AZURE_SPEECH_TOKEN_URL ?? "").trim() || `https://${region}.api.cognitive.microsoft.com`;
  let token = "";
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/sts/v1.0/issueToken`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": (process.env.AZURE_SPEECH_KEY ?? "").trim(), "Content-Length": "0" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) token = await r.text();
  } catch {
    // Se informa abajo como error.
  }
  if (!token) return responder({ azure: false, motivo: "error" });

  const sb = await supabaseServer();
  const { data: perfil } = await sb.from("profiles").select("agent_config").maybeSingle();
  const elegida = (perfil?.agent_config as Record<string, unknown> | undefined)?.voz;
  const voz = VOCES.some((v) => v.id === elegida) ? (elegida as string) : VOZ_POR_DEFECTO;
  return responder({ azure: true, token, region, voz, aviso: cupo.aviso, porcentaje: cupo.porcentaje });
}
