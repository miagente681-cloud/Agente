"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Registra el service worker (necesario para instalar la app y para el push)
 * y atiende su pedido de abrir una página: cuando tocás la notificación de una
 * llamada con la app ya abierta y el navegador no deja cambiar de página desde
 * el service worker, la app se lleva sola a la llamada.
 */
export function RegistrarServiceWorker() {
  const router = useRouter();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Sin service worker la app funciona igual; solo no hay push ni modo sin conexión.
    });

    const alMensaje = (e: MessageEvent) => {
      const datos = e.data as { tipo?: unknown; ruta?: unknown } | null;
      if (datos?.tipo !== "abrir" || typeof datos.ruta !== "string") return;
      // Solo rutas de la propia app ("/algo", nunca "//otro-sitio").
      if (!datos.ruta.startsWith("/") || datos.ruta.startsWith("//")) return;
      if (window.location.pathname + window.location.search !== datos.ruta) router.push(datos.ruta);
    };
    navigator.serviceWorker.addEventListener("message", alMensaje);
    return () => navigator.serviceWorker.removeEventListener("message", alMensaje);
  }, [router]);

  return null;
}
