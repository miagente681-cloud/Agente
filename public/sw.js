/* Service worker de MiAgente.
 * - Página de "sin conexión" cuando falla una navegación.
 * - Notificaciones push de llamadas (las envía el programador desde la fase 6).
 * No cachea datos ni páginas de la app: la información personal no queda en caché.
 */
const CACHE = "miagente-v1";
const OFFLINE_URL = "/sin-conexion.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { cuerpo: event.data ? event.data.text() : "" };
  }
  const titulo = datos.titulo || "MiAgente";
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: datos.cuerpo || "",
      icon: "/iconos/icono-192.png",
      badge: "/iconos/insignia-96.png",
      tag: datos.etiqueta || "miagente",
      renotify: true,
      requireInteraction: Boolean(datos.persistente),
      data: { url: datos.url || "/hoy" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let destino = new URL(event.notification.data?.url || "/hoy", self.location.origin);
  // Solo páginas de la propia app.
  if (destino.origin !== self.location.origin) destino = new URL("/hoy", self.location.origin);
  event.waitUntil(abrirEnLaApp(destino));
});

/**
 * Lleva a la página del aviso (por ejemplo, la llamada). Si la app ya está
 * abierta, la trae al frente y cambia de página; si no, la abre ahí.
 * No todos los navegadores dejan cambiar de página desde el service worker
 * (WindowClient.navigate): en ese caso se le pide a la propia app que lo haga
 * (ver components/registrar-sw.tsx).
 */
async function abrirEnLaApp(destino) {
  const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const ventana = ventanas.find((v) => "focus" in v);
  if (!ventana) return self.clients.openWindow(destino.href);
  const enfocada = (await ventana.focus().catch(() => null)) || ventana;
  if (typeof enfocada.navigate === "function") {
    try {
      if (await enfocada.navigate(destino.href)) return;
    } catch {
      // Sigue con el mensaje a la app.
    }
  }
  enfocada.postMessage({ tipo: "abrir", ruta: destino.pathname + destino.search });
}
