import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer, usuarioActual } from "@/lib/supabase/server";

// Orden que respeta las referencias entre tablas.
const TABLAS = [
  "change_log", "messages", "project_log", "memories", "tasks", "projects", "areas",
  "sessions", "call_routines", "availability_windows", "reminders", "push_subscriptions",
];
const NINGUNO = "00000000-0000-0000-0000-000000000000";

/**
 * Borra todos los datos de quien lo pide. Con la clave de servicio se borra
 * también la cuenta (y con ella todo, en cascada). Sin esa clave se borran las
 * filas una tabla a la vez con la sesión del usuario, y la cuenta queda vacía.
 */
export async function POST() {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });

  const admin = supabaseAdmin();
  if (admin) {
    const { error } = await admin.auth.admin.deleteUser(usuario.id);
    if (!error) return NextResponse.json({ ok: true, cuenta: true });
  }

  const sb = await supabaseServer();
  for (const tabla of TABLAS) {
    // RLS limita el borrado a las filas propias; el filtro es solo porque la API exige uno.
    const { error } = await sb.from(tabla).delete().neq("id", NINGUNO);
    if (error) return NextResponse.json({ error: `No se pudo borrar ${tabla}` }, { status: 500 });
  }
  await sb
    .from("profiles")
    .update({ name: null, agent_config: {}, onboarding_done: false })
    .eq("user_id", usuario.id);
  return NextResponse.json({ ok: true, cuenta: false });
}
