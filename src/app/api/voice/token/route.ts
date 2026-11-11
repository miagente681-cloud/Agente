import { NextResponse } from "next/server";
import { integracionLista } from "@/lib/integraciones";
import { frenarSiHaceFalta } from "@/lib/seguridad/frecuencia";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";
import { cuposDe, evaluarCupo, minimoPorTokenDe } from "@/lib/voz/cupo";
import { VOCES, VOZ_POR_DEFECTO, type RespuestaToken } from "@/lib/voz/tipos";

const responder = (r: RespuestaToken) => NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });

/**
 * Entrega un token de Azure Speech de corta duración. La clave nunca sale del
 * servidor. El cupo gratuito es uno solo para todo el despliegue: si se agotó,
 * deja de entregar y la llamada sigue con la voz del navegador o por texto.
 * Cada token entregado descuenta un mínimo del cupo, aunque después el
 * navegador no informe nada.
 */
export async function POST() {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const admin = supabaseAdmin();
  if (!integracionLista("azure") || !admin) return responder({ azure: false, motivo: "sin_configurar" });
  const frenado = await frenarSiHaceFalta(usuario.id, "voz_token", admin);
  if (frenado) return frenado;

  const mes = new Date().toISOString().slice(0, 7) + "-01";
  const { data: uso, error } = await admin.rpc("uso_voz_global", { p_month: mes });
  if (error) return responder({ azure: false, motivo: "error" });
  const fila = (Array.isArray(uso) ? uso[0] : uso) as { stt_seconds: number | string; tts_chars: number | string } | null;
  const total = { stt_seconds: Number(fila?.stt_seconds ?? 0), tts_chars: Number(fila?.tts_chars ?? 0) };
  const cupo = evaluarCupo(total, cuposDe(process.env));
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

  // El mínimo se descuenta antes de entregar el token.
  const minimo = minimoPorTokenDe(process.env);
  await admin.rpc("sumar_uso_voz", { p_user: usuario.id, p_stt: minimo.sttSegundos, p_tts: minimo.ttsCaracteres });

  const sb = await supabaseServer();
  const { data: perfil } = await sb.from("profiles").select("agent_config").eq("user_id", usuario.id).maybeSingle();
  const elegida = (perfil?.agent_config as Record<string, unknown> | undefined)?.voz;
  const voz = VOCES.some((v) => v.id === elegida) ? (elegida as string) : VOZ_POR_DEFECTO;
  return responder({ azure: true, token, region, voz, aviso: cupo.aviso, porcentaje: cupo.porcentaje });
}
