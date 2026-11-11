import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { MODELOS_POR_DEFECTO, topeGlobalDe } from "@/lib/agente/claude/config";
import { registrarUso } from "@/lib/agente/claude/presupuesto";
import { clienteClaude, hayClaveClaude } from "@/lib/agente/proveedores/indice";
import { frenarSiHaceFalta } from "@/lib/seguridad/frecuencia";
import { puedeUsarClaude } from "@/lib/seguridad/permitidos";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";

export type ResultadoPrueba =
  | { ok: true; modelo: string; ms: number }
  | { ok: false; motivo: "sin_configurar" | "no_permitido" | "clave" | "credito" | "limite" | "sobrecarga" | "sin_respuesta" | "otro"; mensaje: string };

const MENSAJES: Record<string, string> = {
  clave: "La clave no es válida o fue revocada. Creá otra en la consola de Claude y cargala en Vercel.",
  credito: "La cuenta no tiene crédito, o llegó al límite de gasto que pusiste en la consola.",
  limite: "Claude respondió que se pasó el límite de pedidos por minuto. Probá en un rato.",
  sobrecarga: "Claude está sobrecargado en este momento. Probá en un rato.",
  sin_respuesta: "No hubo respuesta de Claude a tiempo.",
  otro: "Claude respondió con un error.",
};

/**
 * Hace un pedido mínimo a Claude para comprobar la clave. Nunca devuelve la
 * clave ni parte de ella. Si anda, borra la marca de problema; si la clave no
 * sirve o no hay crédito, la deja puesta (así no se reintenta en cada mensaje).
 */
export async function POST() {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  if (!puedeUsarClaude(usuario.email)) {
    return NextResponse.json({ ok: false, motivo: "no_permitido", mensaje: "Claude no está habilitado para tu cuenta." } satisfies ResultadoPrueba);
  }
  const admin = supabaseAdmin();
  if (!hayClaveClaude() || !admin) {
    return NextResponse.json({
      ok: false,
      motivo: "sin_configurar",
      mensaje: !admin ? "Falta cargar SUPABASE_SERVICE_ROLE_KEY en Vercel." : "Falta cargar ANTHROPIC_API_KEY en Vercel.",
    } satisfies ResultadoPrueba);
  }
  const frenado = await frenarSiHaceFalta(usuario.id, "claude_probar", admin);
  if (frenado) return frenado;
  const sb = await supabaseServer();
  const { data } = await sb.from("profiles").select("user_id,timezone,agent_config").eq("user_id", usuario.id).maybeSingle();
  const perfil = data as { user_id: string; timezone: string; agent_config: Record<string, unknown> } | null;
  const modelo = MODELOS_POR_DEFECTO.chat;
  const inicio = Date.now();
  let resultado: ResultadoPrueba;
  try {
    const r = await clienteClaude().messages.create(
      {
        model: modelo,
        max_tokens: 16,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: "Respondé solo: ok" }],
      },
      { timeout: 20_000 },
    );
    resultado = { ok: true, modelo: r.model, ms: Date.now() - inicio };
    if (perfil) {
      await registrarUso(admin, {
        userId: usuario.id,
        topeGlobal: topeGlobalDe(),
        sesionId: null,
        modelo,
        uso: "fondo",
        zona: perfil.timezone,
        tokens: { entrada: r.usage.input_tokens, salida: r.usage.output_tokens, cache5m: 0, cache1h: 0, lectura: 0 },
      });
    }
  } catch (error) {
    let motivo: Exclude<ResultadoPrueba, { ok: true }>["motivo"] = "otro";
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) motivo = "clave";
    else if (error instanceof Anthropic.RateLimitError) motivo = "limite";
    else if (error instanceof Anthropic.APIConnectionError) motivo = "sin_respuesta";
    else if (error instanceof Anthropic.APIError) {
      const tipo = (error as { type?: string }).type;
      if (error.status === 402 || tipo === "billing_error" || /credit balance|usage limits/i.test(error.message)) motivo = "credito";
      else if (error.status === 529 || tipo === "overloaded_error") motivo = "sobrecarga";
    }
    resultado = { ok: false, motivo, mensaje: MENSAJES[motivo] };
  }

  if (perfil) {
    const config = { ...perfil.agent_config };
    if (resultado.ok) delete config.claude_problema;
    else if (resultado.motivo === "clave" || resultado.motivo === "credito") {
      config.claude_problema = { tipo: resultado.motivo, desde: new Date().toISOString() };
    }
    await sb.from("profiles").update({ agent_config: config }).eq("user_id", perfil.user_id);
  }
  return NextResponse.json(resultado);
}
