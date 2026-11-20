import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { frenarSiHaceFalta } from "@/lib/seguridad/frecuencia";
import { usuarioActual } from "@/lib/supabase/server";

const Cuerpo = z.object({
  evento: z.enum(["conectada", "cierre", "caida", "sin_sesion", "sin_ajustes", "sin_audio", "respaldo"]),
  detalle: z.string().max(300).optional(),
});

/**
 * La llamada en vivo pasa entre el navegador y el servicio de voz: si algo
 * falla ahí, el servidor no se entera. La pantalla avisa acá lo que pasó
 * (se conectó, se cortó y con qué código, cayó al motor por turnos) y queda
 * en los registros del servidor, para poder diagnosticar sin tener el
 * teléfono a mano. No se guarda en la base ni lleva nada de lo conversado.
 */
export async function POST(request: NextRequest) {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const leido = Cuerpo.safeParse(await request.json().catch(() => null));
  if (!leido.success) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  const frenado = await frenarSiHaceFalta(usuario.id, "voz_uso");
  if (frenado) return frenado;
  // Una sola línea y sin caracteres de control: el detalle lo escribe el navegador.
  const detalle = (leido.data.detalle ?? "").replace(/[^\x20-\x7e -ɏ]/g, " ").trim();
  console.info(`[vivo] ${usuario.id.slice(0, 8)} ${leido.data.evento}${detalle ? `: ${detalle}` : ""}`);
  return NextResponse.json({ ok: true });
}
