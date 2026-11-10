import { NextResponse } from "next/server";
import { emisorPush } from "@/lib/push/servidor";
import type { Suscripcion } from "@/lib/programacion/tick";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";

/** Manda una notificación de prueba a los dispositivos del usuario. */
export async function POST() {
  if (!(await usuarioActual())) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const enviar = emisorPush();
  if (!enviar) return NextResponse.json({ ok: false, motivo: "sin_configurar" });
  const sb = await supabaseServer();
  const { data } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth");
  const suscripciones = (data ?? []) as Suscripcion[];
  if (!suscripciones.length) return NextResponse.json({ ok: false, motivo: "sin_dispositivos" });
  let enviadas = 0;
  for (const s of suscripciones) {
    const r = await enviar(s, {
      titulo: "MiAgente",
      cuerpo: "Así te voy a avisar cuando sea la hora de una llamada.",
      url: "/configuracion",
      etiqueta: "prueba",
    });
    if (r === "ok") enviadas++;
    if (r === "vencida") await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
  }
  return NextResponse.json({ ok: enviadas > 0, enviadas, motivo: enviadas ? undefined : "fallo" });
}
