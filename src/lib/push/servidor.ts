import "server-only";
import webpush from "web-push";
import type { EnviarPush, ResultadoEnvio } from "@/lib/programacion/tick";
import { destinoPushValido } from "./destinos";

/** Tiempo máximo de cada envío: una dirección lenta no puede trabar al programador. */
export const TIEMPO_MAXIMO_ENVIO_MS = 5000;

/**
 * Explicación corta de por qué falló un envío, para guardar y mostrar en
 * Configuración. Usa el código HTTP y el motivo que devuelve el servicio de
 * push (Apple manda, por ejemplo, `{"reason":"BadJwtToken"}`). Nunca incluye
 * la dirección del dispositivo ni las claves.
 */
export function detalleDeError(error: unknown): string {
  const e = (error ?? {}) as { statusCode?: number; body?: unknown; code?: string; message?: string };
  if (e.statusCode) {
    const cuerpo = typeof e.body === "string" ? e.body : "";
    let motivo = "";
    try {
      motivo = String((JSON.parse(cuerpo) as { reason?: unknown }).reason ?? "");
    } catch {
      motivo = cuerpo;
    }
    return `${e.statusCode} ${motivo}`.replace(/\s+/g, " ").trim().slice(0, 200);
  }
  if (e.code === "ETIMEDOUT" || /timeout/i.test(e.message ?? "")) return "sin respuesta del servicio de push";
  return String(e.code ?? e.message ?? "error desconocido").slice(0, 200);
}

/**
 * Envío de notificaciones push con las claves VAPID. Devuelve null si las
 * claves no están cargadas: el programador sigue funcionando y el aviso se ve
 * solo dentro de la app.
 */
export function emisorPush(): EnviarPush | null {
  const publica = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
  const privada = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  const contacto = (process.env.VAPID_SUBJECT ?? "").trim();
  if (!publica || !privada || !contacto) return null;
  try {
    webpush.setVapidDetails(contacto, publica, privada);
  } catch {
    return null; // Claves mal formadas: se trata como sin configurar.
  }
  return async (suscripcion, carga): Promise<ResultadoEnvio> => {
    // Se revisa otra vez antes de enviar: solo servicios de push de los navegadores.
    if (!destinoPushValido(suscripcion.endpoint)) return { estado: "error", detalle: "destino no permitido" };
    try {
      await webpush.sendNotification(
        { endpoint: suscripcion.endpoint, keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth } },
        JSON.stringify(carga),
        // Una llamada vieja no sirve: si el teléfono está apagado más de 10 minutos, se descarta.
        { TTL: 600, urgency: "high", timeout: TIEMPO_MAXIMO_ENVIO_MS },
      );
      return { estado: "ok" };
    } catch (error) {
      const estado = (error as { statusCode?: number }).statusCode;
      const detalle = detalleDeError(error);
      // 404 y 410: el navegador dio de baja esa suscripción.
      if (estado === 404 || estado === 410) return { estado: "vencida", detalle };
      // Sin datos de la persona: solo el servicio y el motivo.
      console.warn(`[push] falló un envío a ${new URL(suscripcion.endpoint).hostname}: ${detalle}`);
      return { estado: "error", detalle };
    }
  };
}
