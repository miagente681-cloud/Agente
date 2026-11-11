import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { frenarSiHaceFalta } from "@/lib/seguridad/frecuencia";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { usuarioActual } from "@/lib/supabase/server";

// El navegador reporta cada medio minuto; se acepta un poco más por si se atrasa.
const Cuerpo = z.object({ segundos: z.number().int().min(0).max(300) });

/** Suma segundos de reconocimiento de Azure al contador del mes. */
export async function POST(request: NextRequest) {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const leido = Cuerpo.safeParse(await request.json().catch(() => null));
  if (!leido.success) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false });
  const frenado = await frenarSiHaceFalta(usuario.id, "voz_uso", admin);
  if (frenado) return frenado;
  if (leido.data.segundos > 0) {
    await admin.rpc("sumar_uso_voz", { p_user: usuario.id, p_stt: leido.data.segundos, p_tts: 0 });
  }
  return NextResponse.json({ ok: true });
}
