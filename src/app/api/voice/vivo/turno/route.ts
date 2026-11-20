import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prepararProveedores } from "@/lib/agente/claude/servidor";
import { leerInstantanea, type Sesion } from "@/lib/agente/datos";
import { ejecutarHerramienta, validarLlamada, type Contexto } from "@/lib/agente/herramientas";
import { completar } from "@/lib/agente/runner";
import { partesEnZona } from "@/lib/programacion/horarios";
import { frenarSiHaceFalta } from "@/lib/seguridad/frecuencia";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";
import type { RespuestaViva } from "@/lib/voz/vivo/protocolo";
import { configVivo } from "@/lib/voz/vivo/servidor";
import type { ResultadoTurnoVivo } from "@/lib/voz/vivo/tipos";

// Un informe pide un párrafo al modelo liviano antes de responder.
export const maxDuration = 60;

const Cuerpo = z
  .object({
    sesionId: z.uuid(),
    /** Lo que dijo la persona desde el último guardado (como lo transcribió el servicio). */
    usuario: z.string().trim().min(1).max(4000).optional(),
    /** Lo que dijo el Agente desde el último guardado. */
    agente: z.string().trim().min(1).max(8000).optional(),
    llamadas: z
      .array(z.object({ id: z.string().min(1).max(100), nombre: z.string().min(1).max(100), argumentos: z.unknown() }))
      .min(1)
      .max(10)
      .optional(),
  })
  .refine((c) => c.usuario || c.agente || c.llamadas, "No hay nada para guardar");

const CERRADAS = ["completada", "perdida", "reprogramada"];
const SIN_EJECUTAR = "No se ejecutó porque otra llamada del mismo mensaje era inválida. Repetila.";

/**
 * En una llamada en vivo la conversación pasa entre el navegador y el servicio
 * de voz. Acá se guarda lo hablado (para la transcripción, el resumen y las
 * memorias) y se aplican las herramientas que pide el Agente, con el mismo
 * registro de cambios y «Deshacer» que en el chat. Las herramientas corren con
 * la sesión de la persona (RLS): no pueden tocar nada que ella no pueda.
 */
export async function POST(request: NextRequest) {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const leido = Cuerpo.safeParse(await request.json().catch(() => null));
  if (!leido.success) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  const cuerpo = leido.data;
  const admin = supabaseAdmin();
  const frenado = await frenarSiHaceFalta(usuario.id, "vivo_turno", admin);
  if (frenado) return frenado;
  const sb = await supabaseServer();
  const { data } = await sb.from("sessions").select("*").eq("id", cuerpo.sesionId).maybeSingle();
  const sesion = data as Sesion | null;
  if (!sesion) return NextResponse.json({ error: "No existe esa sesión" }, { status: 404 });
  if (CERRADAS.includes(sesion.status)) return NextResponse.json({ error: "Esa sesión ya terminó" }, { status: 409 });

  // created_at explícito y siempre creciente, como en el chat: varios mensajes
  // del mismo milisegundo tienen que conservar el orden.
  const { data: ultimo } = await sb
    .from("messages")
    .select("created_at")
    .eq("session_id", sesion.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let reloj = Math.max(Date.now(), ultimo ? new Date((ultimo as { created_at: string }).created_at).getTime() + 1 : 0);
  const guardar = async (fila: Record<string, unknown>): Promise<string | null> => {
    const { data: creada } = await sb
      .from("messages")
      .insert({ session_id: sesion.id, ...fila, created_at: new Date(reloj++).toISOString() })
      .select("id")
      .single();
    return (creada as { id: string } | null)?.id ?? null;
  };
  const modelo = { provider: "gemini", model: configVivo(process.env, { aunqueNoEsteDisponible: true })?.modelo ?? null };
  const resultado: ResultadoTurnoVivo = { respuestas: [], cambios: [], terminar: false };

  if (cuerpo.usuario) await guardar({ role: "usuario", content: cuerpo.usuario });
  const llamadas = cuerpo.llamadas ?? [];
  if (!llamadas.length) {
    if (cuerpo.agente) await guardar({ role: "agente", content: cuerpo.agente, ...modelo });
    return NextResponse.json(resultado);
  }

  // Se valida todo antes de aplicar nada: si una llamada viene mal no se
  // ejecuta ninguna, así el reintento del modelo no duplica cambios.
  const problemas = llamadas.map((l) => validarLlamada(l.nombre, l.argumentos));
  if (problemas.some(Boolean)) {
    if (cuerpo.agente) await guardar({ role: "agente", content: cuerpo.agente, ...modelo });
    resultado.respuestas = llamadas.map(
      (l, i): RespuestaViva => ({ id: l.id, nombre: l.nombre, resultado: { error: problemas[i] ?? SIN_EJECUTAR } }),
    );
    return NextResponse.json(resultado);
  }

  const datos = await leerInstantanea(sb, sesion.id);
  const ctx: Contexto = {
    sb,
    sesionId: sesion.id,
    hoy: partesEnZona(new Date(), datos.perfil.timezone).fecha,
    datos,
    cambios: [],
    async redactar(sistema, entrada) {
      const { proveedores } = await prepararProveedores(sb, { usuario, sesionId: sesion.id, admin });
      return completar(proveedores, { liviano: true, uso: "fondo", sistema, mensajes: [{ rol: "usuario", texto: entrada }] });
    },
  };
  ctx.mensajeId = await guardar({
    role: "agente",
    content: cuerpo.agente ?? null,
    tool_calls: llamadas.map((l) => ({ id: l.id, nombre: l.nombre, argumentos: l.argumentos ?? {} })),
    ...modelo,
  });
  for (const l of llamadas) {
    const r = await ejecutarHerramienta(ctx, l.nombre, l.argumentos);
    await guardar({ role: "herramienta", tool_result: { id: l.id, nombre: l.nombre, resultado: r.resultado } });
    resultado.respuestas.push({ id: l.id, nombre: l.nombre, resultado: r.resultado });
  }
  resultado.cambios = ctx.cambios;
  resultado.terminar = Boolean(ctx.terminar);
  return NextResponse.json(resultado);
}
