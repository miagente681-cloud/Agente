import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hayClaveClaude, proveedoresEnOrden, type OpcionesClaude } from "../proveedores/indice";
import type { ProveedorLLM } from "../tipos";
import { emisorPush } from "@/lib/push/servidor";
import type { Suscripcion } from "@/lib/programacion/tick";
import { puedeUsarClaude } from "@/lib/seguridad/permitidos";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { destinoPushValido } from "@/lib/push/destinos";
import { configClaude, topeGlobalDe } from "./config";
import {
  evaluarPresupuesto,
  formatoUSD,
  gastoDelMes,
  mesDe,
  registrarUso,
  sesionUsoClaude,
  type EstadoPresupuesto,
} from "./presupuesto";

export const AVISO_TOPE = "Este mes ya usé todo el presupuesto de Claude; sigo con el modelo gratuito.";

type Perfil = { user_id: string; timezone: string; agent_config: Record<string, unknown> };

async function guardarConfig(sb: SupabaseClient, perfil: Perfil, cambios: Record<string, unknown>) {
  // Se vuelve a leer para no pisar algo que cambió mientras tanto.
  const { data } = await sb.from("profiles").select("agent_config").eq("user_id", perfil.user_id).maybeSingle();
  const actual = ((data as { agent_config?: Record<string, unknown> } | null)?.agent_config ?? perfil.agent_config) as Record<string, unknown>;
  await sb.from("profiles").update({ agent_config: { ...actual, ...cambios } }).eq("user_id", perfil.user_id);
}

export type UsuarioVerificado = { id: string; email?: string | null };

/**
 * Arma la lista de proveedores para una sesión. Claude entra solo si:
 * hay clave de Anthropic, hay clave de servicio de Supabase (el gasto lo
 * escribe y lo suma solo el servidor), el correo verificado de la persona está
 * en CLAUDE_USUARIOS_PERMITIDOS, no hubo un problema reciente con la clave o
 * el crédito, y no se llegó a su tope ni al global del despliegue.
 *
 * Nada de eso sale de datos que la persona pueda escribir desde el navegador:
 * el tope del perfil solo puede bajar el límite, y «la sesión ya usó Claude»
 * se mira en el registro de gasto, no en la sesión.
 */
export async function prepararProveedores(
  sb: SupabaseClient,
  p: {
    usuario: UsuarioVerificado;
    sesionId: string | null;
    ahora?: Date;
    /** Cliente con la clave de servicio; por defecto, el del entorno. */
    admin?: SupabaseClient | null;
  },
): Promise<{ proveedores: ProveedorLLM[]; avisoTope: string | null; presupuesto: EstadoPresupuesto | null }> {
  const ahora = p.ahora ?? new Date();
  const admin = p.admin === undefined ? supabaseAdmin() : p.admin;
  const { data } = await sb.from("profiles").select("user_id,timezone,agent_config").eq("user_id", p.usuario.id).maybeSingle();
  const perfil = data as Perfil | null;
  const agentConfig = perfil?.agent_config ?? {};
  if (!perfil || !admin || !hayClaveClaude() || !puedeUsarClaude(p.usuario.email)) {
    return { proveedores: proveedoresEnOrden(agentConfig.orden_proveedores), avisoTope: null, presupuesto: null };
  }

  const mes = mesDe(ahora, perfil.timezone);
  const topeGlobal = topeGlobalDe();
  const [gasto, yaUso] = await Promise.all([
    gastoDelMes(admin, p.usuario.id, mes),
    sesionUsoClaude(admin, p.usuario.id, p.sesionId),
  ]);
  const presupuesto = evaluarPresupuesto({
    hayClave: true,
    agentConfig,
    gastoMes: gasto.propio,
    gastoGlobal: gasto.global,
    topeGlobal,
    mes,
    ahora,
    sesionYaUsoClaude: yaUso,
  });
  if (presupuesto.avisarTope) await guardarConfig(sb, perfil, { claude_tope_avisado: mes });

  const opciones: OpcionesClaude = {
    modelos: configClaude(agentConfig, topeGlobal).modelos,
    async alUsar({ modelo, uso, tokens }) {
      const r = await registrarUso(admin, {
        userId: p.usuario.id,
        sesionId: p.sesionId,
        modelo,
        uso,
        tokens,
        zona: perfil.timezone,
        topeGlobal,
      });
      // Registro en el servidor para comprobar que el caché funciona (sin datos de la persona).
      console.info(
        `[claude] ${modelo} ${uso}: entrada ${tokens.entrada}, caché escrita ${tokens.cache5m + tokens.cache1h}, caché leída ${tokens.lectura}, salida ${tokens.salida}, ${formatoUSD(r.costo)}`,
      );
      if (!r.aviso80) return null;
      const texto = `Ya usaste el 80 % del presupuesto de Claude de este mes (${formatoUSD(r.aviso80.gasto)} de ${formatoUSD(r.aviso80.tope)}).`;
      await avisarPorPush(sb, texto);
      return texto;
    },
    async alProblema(tipo) {
      await guardarConfig(sb, perfil, { claude_problema: { tipo, desde: new Date().toISOString() } });
    },
  };
  return {
    proveedores: proveedoresEnOrden(agentConfig.orden_proveedores, presupuesto.disponible ? opciones : null),
    avisoTope: presupuesto.avisarTope ? AVISO_TOPE : null,
    presupuesto,
  };
}

async function avisarPorPush(sb: SupabaseClient, cuerpo: string) {
  const enviar = emisorPush();
  if (!enviar) return; // Sin claves de push el aviso queda solo dentro de la app.
  const { data } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth");
  for (const s of ((data ?? []) as Suscripcion[]).filter((x) => destinoPushValido(x.endpoint))) {
    await enviar(s, { titulo: "Presupuesto de Claude", cuerpo, url: "/configuracion", etiqueta: "claude-80" }).catch(() => null);
  }
}
