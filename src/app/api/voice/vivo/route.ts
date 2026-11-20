import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { leerInstantanea, type Sesion } from "@/lib/agente/datos";
import { definiciones } from "@/lib/agente/herramientas";
import { frenarSiHaceFalta } from "@/lib/seguridad/frecuencia";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";
import { ajustesVivo, APERTURA, configVivo, pedirTokenVivo, sistemaVivo, vozVivoDe } from "@/lib/voz/vivo/servidor";
import type { RespuestaSesionViva } from "@/lib/voz/vivo/tipos";

const Cuerpo = z.object({
  sesionId: z.uuid(),
  /** El Agente abre la conversación (llamadas y entrevista inicial). */
  inicio: z.boolean().optional(),
  sensibilidad: z.enum(["alta", "normal", "baja", "apagada"]).optional(),
});

const CERRADAS = ["completada", "perdida", "reprogramada"];
const responder = (r: RespuestaSesionViva) => NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });

/**
 * Prepara una conexión de llamada en vivo: arma las instrucciones con el
 * estado actual y lo ya conversado, y entrega un token de un solo uso con todo
 * eso fijado. La clave de Gemini no sale del servidor. Se llama al atender y
 * cada vez que hay que renovar la conexión (el servicio las corta cada tanto).
 */
export async function POST(request: NextRequest) {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const leido = Cuerpo.safeParse(await request.json().catch(() => null));
  if (!leido.success) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  const config = configVivo();
  const admin = supabaseAdmin();
  // Sin la clave de servicio no se puede contar el uso: no se entrega nada que gaste.
  if (!config || !admin) return responder({ vivo: false, motivo: "sin_configurar" });
  const frenado = await frenarSiHaceFalta(usuario.id, "voz_vivo", admin);
  if (frenado) return responder({ vivo: false, motivo: "limite" });

  const sb = await supabaseServer();
  // RLS: si la sesión es de otra persona, simplemente no aparece.
  const { data } = await sb.from("sessions").select("*").eq("id", leido.data.sesionId).maybeSingle();
  const sesion = data as Sesion | null;
  if (!sesion) return NextResponse.json({ error: "No existe esa sesión" }, { status: 404 });
  if (CERRADAS.includes(sesion.status)) return NextResponse.json({ error: "Esa sesión ya terminó" }, { status: 409 });

  const ahora = new Date();
  let consulta = sb
    .from("messages")
    .select("role,content,created_at")
    .eq("session_id", sesion.id)
    .order("created_at", { ascending: false })
    .limit(60);
  if (sesion.history_summary_until) consulta = consulta.gt("created_at", sesion.history_summary_until);
  const [datos, previos] = await Promise.all([leerInstantanea(sb, sesion.id), consulta]);
  const mensajes = ((previos.data ?? []) as { role: string; content: string | null; created_at: string }[]).reverse();

  if (!sesion.started_at || sesion.status !== "en_curso") {
    const inicio = { status: "en_curso", started_at: sesion.started_at ?? ahora.toISOString() };
    await sb.from("sessions").update(inicio).eq("id", sesion.id);
    Object.assign(sesion, inicio);
  }

  const ajustes = ajustesVivo({
    modelo: config.modelo,
    sistema: sistemaVivo({ sesion, datos, ahora, previos: mensajes }),
    herramientas: definiciones(),
    voz: vozVivoDe(datos.perfil.agent_config),
    sensibilidad: leido.data.sensibilidad ?? "normal",
  });
  const token = await pedirTokenVivo(config, ajustes, ahora);
  if (!token.ok) {
    // Queda en los registros para diagnosticar (modelo mal escrito, cupo, clave). No trae la clave.
    console.warn(`[vivo] no se pudo pedir el token (${config.modelo}): ${token.estado} ${token.detalle}`);
    return responder({ vivo: false, motivo: "error" });
  }

  // Abre el Agente solo si todavía no se habló nada: una reconexión no vuelve a saludar.
  const abre = Boolean(leido.data.inicio) && !mensajes.length;
  if (abre) await sb.from("messages").insert({ session_id: sesion.id, role: "sistema", content: APERTURA });
  if (!(sesion.providers_used ?? []).includes("gemini")) {
    await admin
      .from("sessions")
      .update({ providers_used: [...(sesion.providers_used ?? []), "gemini"] })
      .eq("id", sesion.id)
      .eq("user_id", usuario.id);
  }
  return responder({ vivo: true, url: token.url, ajustes, modelo: config.modelo, apertura: abre ? APERTURA : null });
}
