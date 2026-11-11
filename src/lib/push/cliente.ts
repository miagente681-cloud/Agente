"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { destinoPushValido } from "./destinos";

/** Notificaciones push, lado del navegador. */

export type EstadoPush =
  | "no_soportado" // este navegador no tiene push (en iPhone: falta instalar la app)
  | "sin_permiso" // todavía no se pidió
  | "bloqueado" // la persona dijo que no
  | "activo";

export const esIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** ¿Está abierta como app instalada (desde la pantalla de inicio)? */
export const instalada = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

export async function estadoPush(): Promise<EstadoPush> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "no_soportado";
  }
  if (Notification.permission === "denied") return "bloqueado";
  if (Notification.permission !== "granted") return "sin_permiso";
  const registro = await navigator.serviceWorker.getRegistration();
  return (await registro?.pushManager.getSubscription()) ? "activo" : "sin_permiso";
}

function claveABytes(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const crudo = atob((base64url + relleno).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(crudo.length));
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
  return bytes;
}

function nombreDispositivo(): string {
  const ua = navigator.userAgent;
  const equipo = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Otro";
  const navegador = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [equipo, navegador].filter(Boolean).join(" · ");
}

/**
 * Pide permiso y suscribe este dispositivo. Tiene que llamarse desde un toque
 * de la persona (iOS no muestra el pedido de permiso de otra forma).
 */
export async function activarPush(clavePublica: string): Promise<{ ok: boolean; mensaje?: string }> {
  if ((await estadoPush()) === "no_soportado") {
    return {
      ok: false,
      mensaje: esIOS()
        ? "En iPhone las notificaciones solo funcionan con la app instalada en la pantalla de inicio."
        : "Este navegador no admite notificaciones push.",
    };
  }
  if (!clavePublica) return { ok: false, mensaje: "Falta configurar las claves de notificaciones en el servidor." };
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") {
    return { ok: false, mensaje: "Sin permiso no puedo avisarte. Se cambia en los ajustes del navegador o del sistema." };
  }
  try {
    const registro = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;
    const suscripcion =
      (await registro.pushManager.getSubscription()) ??
      (await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(clavePublica) }));
    const datos = suscripcion.toJSON();
    if (!destinoPushValido(datos.endpoint)) {
      await suscripcion.unsubscribe().catch(() => null);
      return { ok: false, mensaje: "Este navegador usa un servicio de notificaciones que la app no reconoce." };
    }
    const { error } = await supabaseBrowser()
      .from("push_subscriptions")
      .upsert(
        { endpoint: datos.endpoint, p256dh: datos.keys?.p256dh, auth: datos.keys?.auth, device_label: nombreDispositivo() },
        { onConflict: "endpoint" },
      );
    if (error) return { ok: false, mensaje: "No se pudo guardar la suscripción. Probá de nuevo." };
    return { ok: true };
  } catch {
    return { ok: false, mensaje: "No se pudo activar. Si cambiaste las claves del servidor, desactivá y volvé a activar." };
  }
}

export async function desactivarPush(): Promise<void> {
  const registro = await navigator.serviceWorker.getRegistration();
  const suscripcion = await registro?.pushManager.getSubscription();
  if (!suscripcion) return;
  await supabaseBrowser().from("push_subscriptions").delete().eq("endpoint", suscripcion.endpoint);
  await suscripcion.unsubscribe();
}
