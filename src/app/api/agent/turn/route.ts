import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Sesion } from "@/lib/agente/datos";
import { prepararProveedores } from "@/lib/agente/claude/servidor";
import { correrTurno, resumirSiHaceFalta } from "@/lib/agente/runner";
import { frenarSiHaceFalta } from "@/lib/seguridad/frecuencia";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";

// Un turno puede encadenar varias idas y vueltas con el modelo.
export const maxDuration = 120;

const Cuerpo = z
  .object({
    sesionId: z.uuid().optional(),
    texto: z.string().trim().min(1).max(4000).optional(),
    /** El Agente abre la conversación (llamadas y entrevista inicial). */
    inicio: z.boolean().optional(),
    tipo: z.enum(["chat", "onboarding"]).optional(),
    canal: z.enum(["voz", "texto"]).optional(),
    /** Con qué se va a leer la respuesta en voz alta; "azure" suma al contador mensual. */
    voz: z.enum(["azure", "navegador"]).optional(),
  })
  .refine((c) => c.texto || c.inicio, "Falta el mensaje");

const CERRADAS = ["completada", "perdida", "reprogramada"];

/** Un turno con el Agente. Responde por SSE: texto en streaming y un evento por cada cambio. */
export async function POST(request: NextRequest) {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const leido = Cuerpo.safeParse(await request.json().catch(() => null));
  if (!leido.success) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  const cuerpo = leido.data;
  const admin = supabaseAdmin();
  const frenado = await frenarSiHaceFalta(usuario.id, "turno", admin);
  if (frenado) return frenado;
  const sb = await supabaseServer();

  let sesion: Sesion | null = null;
  if (cuerpo.sesionId) {
    // RLS: si la sesión es de otra persona, simplemente no aparece.
    const { data } = await sb.from("sessions").select("*").eq("id", cuerpo.sesionId).maybeSingle();
    sesion = data as Sesion | null;
    if (!sesion) return NextResponse.json({ error: "No existe esa sesión" }, { status: 404 });
    if (CERRADAS.includes(sesion.status)) {
      return NextResponse.json({ error: "Esa sesión ya terminó" }, { status: 409 });
    }
  } else {
    const { data } = await sb
      .from("sessions")
      .insert({
        kind: cuerpo.tipo ?? "chat",
        channel: cuerpo.canal ?? "texto",
        status: "en_curso",
        started_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    sesion = data as Sesion | null;
    if (!sesion) return NextResponse.json({ error: "No se pudo crear la sesión" }, { status: 500 });
  }

  const { proveedores, avisoTope } = await prepararProveedores(sb, { usuario, sesionId: sesion.id, admin });
  const laSesion = sesion;

  const codificador = new TextEncoder();
  const flujo = new ReadableStream<Uint8Array>({
    async start(control) {
      const enviar = (evento: unknown) => control.enqueue(codificador.encode(`data: ${JSON.stringify(evento)}\n\n`));
      let textoFinal = "";
      try {
        enviar({ tipo: "sesion", id: laSesion.id });
        const turno = correrTurno({
          sb,
          admin,
          sesion: laSesion,
          proveedores,
          entrada: { texto: cuerpo.texto, inicio: cuerpo.inicio },
          avisoTope: avisoTope ?? undefined,
          voz: laSesion.channel === "voz" || Boolean(cuerpo.voz),
          senal: request.signal,
        });
        for await (const evento of turno) {
          if (evento.tipo === "fin") textoFinal = evento.texto;
          enviar(evento);
        }
      } catch {
        if (!request.signal.aborted) {
          enviar({ tipo: "error", mensaje: "Algo falló al responder. Probá de nuevo; tu mensaje quedó guardado." });
          enviar({ tipo: "fin", texto: "", proveedor: null });
        }
      }
      try {
        control.close();
      } catch {
        // El navegador ya cortó la conexión.
      }
      // Trabajo que no tiene que demorar la respuesta.
      try {
        // Lo que se lee en voz alta con Azure suma al cupo. Además, cada token
        // entregado ya descontó un mínimo (ver /api/voice/token).
        if (cuerpo.voz === "azure" && textoFinal) {
          await admin?.rpc("sumar_uso_voz", { p_user: usuario.id, p_stt: 0, p_tts: textoFinal.length });
        }
        await resumirSiHaceFalta(sb, laSesion, proveedores, admin);
      } catch {
        // Si falla, el próximo turno lo vuelve a intentar.
      }
    },
  });

  return new Response(flujo, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
