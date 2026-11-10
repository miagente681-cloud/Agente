import "server-only";
import webpush from "web-push";
import type { EnviarPush } from "@/lib/programacion/tick";

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
  return async (suscripcion, carga) => {
    try {
      await webpush.sendNotification(
        { endpoint: suscripcion.endpoint, keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth } },
        JSON.stringify(carga),
        // Una llamada vieja no sirve: si el teléfono está apagado más de 10 minutos, se descarta.
        { TTL: 600, urgency: "high" },
      );
      return "ok";
    } catch (error) {
      const estado = (error as { statusCode?: number }).statusCode;
      // 404 y 410: el navegador dio de baja esa suscripción.
      return estado === 404 || estado === 410 ? "vencida" : "error";
    }
  };
}
