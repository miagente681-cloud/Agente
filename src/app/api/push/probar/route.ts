import { NextResponse } from "next/server";
import { destinoPushValido } from "@/lib/push/destinos";
import { emisorPush } from "@/lib/push/servidor";
import type { Suscripcion } from "@/lib/programacion/tick";
import { frenarSiHaceFalta } from "@/lib/seguridad/frecuencia";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";

/** Manda una notificación de prueba a los dispositivos del usuario. */
export async function POST() {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  const enviar = emisorPush();
  if (!enviar) return NextResponse.json({ ok: false, motivo: "sin_configurar" });
  const frenado = await frenarSiHaceFalta(usuario.id, "push_probar");
  if (frenado) return frenado;
  const sb = await supabaseServer();
  const { data } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth");
  // Solo destinos de servicios de push reales (también lo controla la base al guardar).
  const suscripciones = ((data ?? []) as Suscripcion[]).filter((s) => destinoPushValido(s.endpoint));
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
